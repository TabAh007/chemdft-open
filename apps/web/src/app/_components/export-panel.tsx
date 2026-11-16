"use client";

import { useEffect, useId, useState } from "react";
import type { CalculationExportCatalog } from "@chemdft/schemas";

import { downloadCalculationExport, getExportCatalog, type ExportFormatKey } from "@/lib/analysis-api";
import { saveBlob } from "@/lib/download";
import { archiveClassLabel, exportMenuModel } from "@/lib/export-view";
import styles from "./scientific-state.module.css";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; catalog: CalculationExportCatalog };

/**
 * Export of the stored evidence behind one calculation. The catalog (what can honestly be exported,
 * and why not) comes from the API; nothing is offered that the stored data cannot support.
 */
export function ExportPanel({ projectId, calculationId }: { projectId: string; calculationId: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const heading = useId();

  useEffect(() => {
    let alive = true;
    getExportCatalog(projectId, calculationId)
      .then((catalog) => { if (alive) setLoad({ status: "ready", catalog }); })
      .catch((cause: unknown) => {
        if (alive) setLoad({ status: "error", message: cause instanceof Error ? cause.message : "Export options could not be loaded." });
      });
    return () => { alive = false; };
  }, [projectId, calculationId]);

  async function run(format: ExportFormatKey, variant?: string) {
    const key = `${format}:${variant ?? ""}`;
    setBusy(key);
    setNotice(null);
    try {
      const file = await downloadCalculationExport({ projectId, calculationId, format, variant });
      saveBlob(file.blob, file.filename);
      setNotice({ tone: "ok", text: `Saved ${file.filename}.` });
    } catch (cause) {
      setNotice({ tone: "error", text: cause instanceof Error ? cause.message : "Export failed." });
    } finally {
      setBusy(null);
    }
  }

  if (load.status === "loading") return <div className={styles.inspector} role="status">Loading export options…</div>;
  if (load.status === "error") return <div className={styles.inspector} role="alert" data-testid="export-error">{load.message}</div>;
  const model = exportMenuModel(load.catalog);
  return (
    <div className={styles.inspector} data-testid="export-panel" aria-labelledby={heading}>
      <h4 id={heading}>Export stored evidence</h4>
      {model.historicalNotice ? <p className={styles.warn} role="note" data-testid="export-historical-notice">{model.historicalNotice}</p> : null}
      {model.groups.map((group) => (
        <section key={group.key} className={styles.exportGroup} aria-label={group.title} data-testid={`export-group-${group.key}`}>
          <h5 className={styles.exportGroupTitle}>{group.title}</h5>
          <p className={styles.muted}>{group.description}</p>
          <ul className={styles.exportList}>
            {group.entries.map(({ option, help }) => (
              <li key={option.format} className={styles.exportRow} data-testid={`export-${option.format}`} data-available={option.available ? "true" : "false"}>
                <div className={styles.exportName}>{option.label} <span className={styles.muted}>.{option.file_extension}</span></div>
                {option.available ? (
                  <>
                    <div className={styles.muted}>{help}</div>
                    {option.format === "reproducibility-bundle" ? (option.variants ?? []).map((variant) => {
                      const archiveClass = archiveClassLabel(variant.key);
                      return (
                        <p key={variant.key} className={styles.archiveClass} data-testid="export-archive-class" data-class={variant.key}>
                          <strong className={archiveClass.reproducible ? styles.archiveReproducible : styles.archiveProvenance}>{archiveClass.text}</strong>
                          {variant.detail ? <span> — {variant.detail}</span> : null}
                        </p>
                      );
                    }) : null}
                    <div className={styles.exportActions}>
                      {(option.variants ?? []).length === 0 ? (
                        <button type="button" className={styles.exportButton} disabled={busy !== null}
                          onClick={() => void run(option.format)} data-testid={`export-run-${option.format}`}>
                          {busy === `${option.format}:` ? "Preparing…" : "Download"}
                        </button>
                      ) : (option.variants ?? []).map((variant) => (
                        <button key={variant.key} type="button" className={styles.exportButton} disabled={busy !== null}
                          title={variant.detail ?? undefined}
                          onClick={() => void run(option.format, variant.key)} data-testid={`export-run-${option.format}-${variant.key}`}>
                          {busy === `${option.format}:${variant.key}` ? "Preparing…" : option.format === "reproducibility-bundle" ? `Download ${archiveClassLabel(variant.key).text.toLowerCase()}` : variant.label}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className={styles.muted} data-testid={`export-reason-${option.format}`}>Not available — {option.unsupported_reason}</div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div role="status" aria-live="polite" data-testid="export-status" className={notice?.tone === "error" ? styles.warn : styles.muted}>
        {notice?.text ?? ""}
      </div>
    </div>
  );
}
