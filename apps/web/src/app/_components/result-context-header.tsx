"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { defaultLocale, isLocale } from "@chemdft/i18n";
import type { OverviewRow, ResearchOverview } from "@chemdft/schemas";
import { ActionButton, StatusTag } from "@chemdft/ui";

import { compareHref, jobsHref, resultContextModel } from "@/lib/overview-view";
import { projectPath } from "@/lib/routes";
import { getResearchOverview } from "@/lib/workflows-api";

// One bulk overview per project serves every open result tab; refreshed when project items change.
const overviews = new Map<string, { at: number; request: Promise<ResearchOverview> }>();
const MAX_AGE_MS = 15_000;

function loadOverview(projectId: string, force = false): Promise<ResearchOverview> {
  const cached = overviews.get(projectId);
  if (!force && cached && Date.now() - cached.at < MAX_AGE_MS) return cached.request;
  const request = getResearchOverview(projectId);
  overviews.set(projectId, { at: Date.now(), request });
  request.catch(() => overviews.delete(projectId));
  return request;
}

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "missing" } | { status: "ready"; row: OverviewRow };

/**
 * RW-3.2 result context: the primary stored quantity with its unit, task, engine, level of theory,
 * structure and the server's current standing for one calculation. Read-only; values are the stored ones.
 */
export function ResultContextHeader({ projectId, calculationId, resultId, onOpenResult }: {
  projectId: string;
  calculationId: string;
  /** The result being viewed; absent when a calculation record is open. */
  resultId?: string | undefined;
  /** Offered on a calculation record that has a published result. */
  onOpenResult?: ((resultId: string) => void) | undefined;
}) {
  const current = useLocale();
  const locale = isLocale(current) ? current : defaultLocale;
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("chemdft:workspace-items-changed", refresh);
    return () => window.removeEventListener("chemdft:workspace-items-changed", refresh);
  }, []);

  useEffect(() => {
    let alive = true;
    loadOverview(projectId, revision > 0)
      .then((overview) => {
        if (!alive) return;
        const row = overview.rows.find((item) => item.calculation_id === calculationId);
        setLoad(row ? { status: "ready", row } : { status: "missing" });
      })
      .catch((cause: unknown) => {
        if (alive) setLoad({ status: "error", message: cause instanceof Error ? cause.message : "Result context could not be loaded." });
      });
    return () => { alive = false; };
  }, [projectId, calculationId, revision]);

  if (load.status === "loading") return <div className="result-context" role="status" data-testid="result-context-loading">Loading result context…</div>;
  if (load.status === "error") return <div className="result-context" role="alert" data-testid="result-context-error">{load.message}</div>;
  if (load.status === "missing") {
    return <div className="result-context" role="note" data-testid="result-context-missing">
      This calculation is not in the project results overview (it may be older than the overview window).{" "}
      <Link href={projectPath(locale, projectId, "results")}>Open Results</Link>
    </div>;
  }
  const { row } = load;
  const model = resultContextModel(row);
  const viewingOtherResult = resultId && row.result_id && row.result_id !== resultId;
  return (
    <section className="result-context" aria-label="Result context" data-testid="result-context" data-standing={model.standing}>
      <div className="result-context-primary">
        <span className="result-context-task">{model.task}</span>
        {model.quantity ? (
          <span className="result-context-quantity" data-testid="result-context-quantity">
            <strong title={`Full value: ${model.quantity.full}`}>{model.quantity.text}</strong> <span>{model.quantity.label}</span>
          </span>
        ) : row.result_id ? (
          <span className="result-context-quantity muted">No scalar quantity is stored for this result type; see the viewer below.</span>
        ) : (
          <span className="result-context-quantity muted">No published result · calculation {model.state}</span>
        )}
      </div>
      <dl className="result-context-facts">
        <div><dt>Engine</dt><dd>{model.engine}</dd></div>
        <div><dt>Method / basis</dt><dd>{model.level}</dd></div>
        <div><dt>Charge / 2S+1</dt><dd>{model.chargeMultiplicity}</dd></div>
        {model.structure ? <div><dt>Input structure</dt><dd>{model.structure}</dd></div> : null}
        <div>
          <dt>Standing</dt>
          <dd>
            {model.standing === "current" ? <StatusTag intent="success">Current</StatusTag> : <span className={model.standing === "none" ? "result-context-none" : "result-context-historical"}>{model.standingText}</span>}
            <span className="result-context-verification"> · {model.verification}</span>
          </dd>
        </div>
      </dl>
      {model.failure ? <p className="result-context-failure" role="note">{model.failure}</p> : null}
      {viewingOtherResult ? <p className="result-context-historical" role="note">This result is not the calculation&apos;s current published result.</p> : null}
      <div className="result-context-actions">
        {model.analyses.length > 0 ? <span className="result-context-analyses" aria-label="Analyses available from stored data">{model.analyses.map((label) => <span key={label} className="result-context-chip">{label}</span>)}</span> : null}
        <span className="result-context-spacer" />
        {!resultId && row.result_id && onOpenResult ? <ActionButton small intent="primary" icon="eye-open" text="Open result" onClick={() => onOpenResult(row.result_id!)} data-testid="result-context-open-result" /> : null}
        <Link href={projectPath(locale, projectId, "results")} data-testid="result-context-results">All results</Link>
        {row.result_id ? <Link href={compareHref(locale, projectId, [row.result_id])} data-testid="result-context-compare">Compare…</Link> : null}
        {row.job_id ? <Link href={jobsHref(locale, projectId)}>Job</Link> : null}
      </div>
    </section>
  );
}
