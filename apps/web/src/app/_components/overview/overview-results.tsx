"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Locale } from "@chemdft/i18n";
import { AppIcon } from "@chemdft/ui";
import { getResearchOverview } from "@/lib/workflows-api";
import { resultListRows, selectionHref, type ResultListRow } from "@/lib/overview-model";
import { jobsHref } from "@/lib/overview-view";
import { projectPath } from "@/lib/routes";
import { parseUtc } from "@/lib/timestamps";
import styles from "./overview.module.css";

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; rows: ResultListRow[]; total: number; truncated: boolean };

function when(value: string): string {
  const time = parseUtc(value);
  return time === null ? "—" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(time);
}

function Links({ row, locale, projectId }: { row: ResultListRow; locale: Locale; projectId: string }) {
  return (
    <p className={styles.resultLinks}>
      <Link href={selectionHref(locale, projectId, { kind: "calculation", id: row.calculationId, projectId })}>Calculation</Link>
      {row.resultId ? <Link href={selectionHref(locale, projectId, { kind: "calculationResult", id: row.resultId, projectId, sourceId: row.calculationId })}>Result</Link> : null}
      {row.structureVersionId && row.structureId ? <Link href={selectionHref(locale, projectId, { kind: "structureVersion", id: row.structureVersionId, projectId, sourceId: row.structureId })}>Structure</Link> : null}
      <time dateTime={row.updatedAt}>{when(row.updatedAt)}</time>
    </p>
  );
}

/**
 * What has already been calculated or verified? The latest published result is featured with its stored quantity,
 * level of theory, structure version and the server's own standing and verification wording. Every other calculation
 * (failed, pending or older) is its own line: a failed job never alters another calculation's published result, and
 * no value is ever shown that a stored record does not carry.
 */
export function OverviewResults({ projectId, locale }: { projectId: string; locale: Locale }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("chemdft:workspace-items-changed", refresh);
    return () => window.removeEventListener("chemdft:workspace-items-changed", refresh);
  }, []);
  useEffect(() => {
    let active = true;
    getResearchOverview(projectId)
      .then((overview) => { if (active) setLoad({ status: "ready", rows: resultListRows(overview.rows, 5), total: overview.total_calculations, truncated: Boolean(overview.truncated) }); })
      .catch(() => { if (active) setLoad({ status: "error" }); });
    return () => { active = false; };
  }, [projectId, revision]);

  const { latest, others } = useMemo(() => {
    if (load.status !== "ready") return { latest: null, others: [] as ResultListRow[] };
    const featured = load.rows.find((row) => row.kind === "result") ?? null;
    return { latest: featured, others: load.rows.filter((row) => row !== featured) };
  }, [load]);

  return (
    <section className={styles.panel} aria-labelledby="overview-results-title" data-testid="overview-results">
      <div className={styles.panelHead}>
        <h2 id="overview-results-title">Results &amp; provenance</h2>
        <span className={styles.panelLinks}>
          <Link className={styles.panelLink} href={projectPath(locale, projectId, "results")}><span>Results</span><AppIcon icon="arrow-right" /></Link>
          <Link className={styles.panelLink} href={jobsHref(locale, projectId)}><span>Jobs</span><AppIcon icon="arrow-right" /></Link>
        </span>
      </div>
      {load.status === "loading" ? <p className={styles.muted} role="status">Reading calculation records…</p> : null}
      {load.status === "error" ? (
        <div role="alert" className={styles.inlineError}>
          <p>Calculation records could not be loaded.</p>
          <button type="button" className="bp6-button bp6-small" onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      ) : null}
      {load.status === "ready" && load.rows.length === 0 ? <p className={styles.muted}>No calculations or published results yet.</p> : null}
      {latest ? (
        <div className={styles.featured} data-calculation-id={latest.calculationId} data-kind="result">
          <div className={styles.resultHead}>
            <p className={styles.kicker}>Latest published result</p>
            <span className={styles.resultState} data-kind="result">Published</span>
          </div>
          <h3>{latest.task}</h3>
          {latest.headline ? <p className={styles.resultValue}>{latest.headline.text}<small>{latest.headline.label}</small></p> : null}
          <p className={styles.resultMeta}>{latest.level} · {latest.engine}</p>
          {latest.structure ? <p className={styles.resultMeta}>Structure: {latest.structure}</p> : null}
          <p className={styles.resultMeta}>Standing: {latest.standing}</p>
          <p className={styles.verification} data-verified={latest.verification === "Independently verified" || undefined}>Validation: {latest.verification}</p>
          <Links row={latest} locale={locale} projectId={projectId} />
        </div>
      ) : null}
      {others.length ? (
        <>
          {latest ? <h3 className={styles.subKicker}>Other calculations</h3> : null}
          <ol className={styles.results}>
            {others.map((row) => (
              <li key={row.key} data-kind={row.kind} data-calculation-id={row.calculationId}>
                <div className={styles.resultHead}>
                  <strong>{row.task}</strong>
                  <span className={styles.resultState} data-kind={row.kind}>{row.kind === "result" ? "Published" : row.kind === "failed" ? "Failed" : row.state}</span>
                </div>
                {row.kind === "result" ? <p className={styles.resultMeta}>{row.level} · {row.standing} · {row.verification}</p> : <p className={styles.resultMeta}>{row.level} · {row.engine}</p>}
                {row.failure ? <p className={styles.resultFailure}>{row.failure}</p> : null}
                <Links row={row} locale={locale} projectId={projectId} />
              </li>
            ))}
          </ol>
        </>
      ) : null}
      {load.status === "ready" && (load.truncated || load.total > load.rows.length) ? <p className={styles.caption}>Showing the {load.rows.length} most recent of {load.total} calculations.</p> : null}
    </section>
  );
}
