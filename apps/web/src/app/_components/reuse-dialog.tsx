"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import type { Locale } from "@chemdft/i18n";
import type { ReusePlan } from "@chemdft/schemas";
import { ActionButton } from "@chemdft/ui";

import { calculationWorkspacePath } from "@/lib/job-view";
import { getReusePlan, submitReuse } from "@/lib/workflows-api";
import styles from "./reuse-dialog.module.css";

const OUTCOME_TEXT = { PASS: "Pass", WARNING: "Warning", FAIL: "Blocks reuse" } as const;

/**
 * Reuse the settings of an earlier calculation. The server re-checks structure identity, charge,
 * multiplicity, method, basis and engine capability; confirming creates a NEW calculation through
 * the ordinary submission route. The earlier calculation and its result are never changed.
 */
export function ReuseDialog({ projectId, locale, calculationId, onClose }: {
  projectId: string; locale: Locale; calculationId: string; onClose: () => void;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [plan, setPlan] = useState<ReusePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    let alive = true;
    getReusePlan(projectId, calculationId)
      .then((value) => { if (alive) setPlan(value); })
      .catch((cause: unknown) => { if (alive) setError(cause instanceof Error ? cause.message : "The reuse plan could not be loaded."); });
    return () => { alive = false; };
  }, [projectId, calculationId]);

  async function confirm() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const created = await submitReuse(projectId, plan);
      router.push(calculationWorkspacePath(locale, projectId, created.calculation.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The new calculation could not be created.");
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={title} onClose={onClose} data-testid="reuse-dialog">
      <h2 id={title}>Reuse calculation settings</h2>
      {plan === null && error === null ? <p role="status">Checking the stored specification…</p> : null}
      {error ? <p role="alert" className={styles.fail} data-testid="reuse-error">{error}</p> : null}
      {plan ? (
        <>
          <dl className={styles.facts}>
            <dt>Task</dt><dd>{plan.task ?? "—"}</dd>
            <dt>Engine</dt><dd>{plan.engine ?? "—"}</dd>
            <dt>Method / basis</dt><dd>{[plan.method, plan.basis].filter(Boolean).join(" / ") || "—"}</dd>
            <dt>Charge · multiplicity</dt><dd>{plan.charge ?? "?"} · {plan.multiplicity ?? "?"}</dd>
            <dt>Source calculation</dt><dd>{plan.source_state} · {plan.source_calculation_id.slice(0, 8)}</dd>
          </dl>
          <table className={styles.checks} data-testid="reuse-checks">
            <caption className="screen-reader-only">Checks run against the stored records</caption>
            <thead><tr><th scope="col">Check</th><th scope="col">Outcome</th><th scope="col">Detail</th></tr></thead>
            <tbody>
              {plan.checks.map((check) => (
                <tr key={check.check_id} data-outcome={check.outcome}>
                  <td className={styles.mono}>{check.check_id}</td>
                  <td className={check.outcome === "FAIL" ? styles.fail : check.outcome === "WARNING" ? styles.warn : styles.pass}>{OUTCOME_TEXT[check.outcome]}</td>
                  <td>{check.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.note}>{plan.notice}</p>
        </>
      ) : null}
      <div className={styles.actions}>
        <ActionButton small text="Cancel" onClick={() => dialog.current?.close()} data-testid="reuse-cancel" />
        <ActionButton small intent="primary" icon="duplicate" text={busy ? "Creating…" : "Create new calculation"}
          disabled={!plan?.can_reuse || busy} onClick={() => void confirm()} data-testid="reuse-confirm" />
      </div>
    </dialog>
  );
}
