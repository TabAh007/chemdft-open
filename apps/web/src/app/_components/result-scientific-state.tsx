"use client";

import { useEffect, useState } from "react";
import type { CalculationResult } from "@chemdft/schemas";

import { getResult } from "@/lib/structure-workspace-api";
import { ScientificStateStrip } from "./scientific-state-strip";
import styles from "./scientific-state.module.css";

/**
 * Scientific-state strip for views that receive only a result id (spectra, thermochemistry).
 * Reads the server's effective state; if it cannot be read, nothing is asserted as current.
 */
export function ResultScientificState({ projectId, resultId }: { projectId: string; resultId: string }) {
  const [state, setState] = useState<{ id: string; result: CalculationResult | null; failed: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    getResult(projectId, resultId)
      .then((result) => { if (alive) setState({ id: resultId, result, failed: false }); })
      .catch(() => { if (alive) setState({ id: resultId, result: null, failed: true }); });
    return () => { alive = false; };
  }, [projectId, resultId]);

  const current = state?.id === resultId ? state : null;
  if (!current) return <div className={`${styles.strip} ${styles.uncertain}`} role="status" data-testid="scientific-state-loading">Reading current scientific state…</div>;
  if (current.failed || !current.result) {
    return <div className={`${styles.strip} ${styles.uncertain}`} role="alert" data-testid="scientific-state-unavailable">
      Current scientific state could not be verified. This result is not presented as currently authoritative; reload to retry.
    </div>;
  }
  return <ScientificStateStrip projectId={projectId} resultId={resultId} result={current.result} />;
}
