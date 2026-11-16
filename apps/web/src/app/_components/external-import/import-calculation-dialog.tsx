"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExternalImportDetail, ExternalImportView } from "@chemdft/schemas";
import { confirmExternalImport, uploadExternalImport } from "@/lib/external-import-api";
import { programDisplay } from "@/lib/imported-results";
import { ImportPreviewPanel } from "./import-preview-panel";

/** Window event the Explorer, Guided navigation and toolbars use to open the import dialog. */
export const OPEN_IMPORT_CALCULATION_EVENT = "chemdft:open-import-calculation";

type Phase = "choose" | "analyzing" | "preview" | "importing";

type StepState = "pending" | "active" | "done" | "failed";

function steps(phase: Phase, view: ExternalImportView | null): Array<{ id: string; label: string; state: StepState; detail?: string }> {
  const analyzing = phase === "analyzing";
  const have = Boolean(view);
  const rejected = view?.preview.status === "REJECTED";
  const detected = Boolean(view?.preview.program.engine);
  return [
    { id: "upload", label: "Upload", state: have ? "done" : analyzing ? "active" : "pending", ...(view ? { detail: `${view.source.size_bytes.toLocaleString()} bytes` } : {}) },
    {
      id: "detect",
      label: "Detect",
      state: have ? (detected ? "done" : "failed") : analyzing ? "active" : "pending",
      ...(view ? { detail: detected ? programDisplay(view.preview.program) : "Not recognised" } : {}),
    },
    {
      id: "parse",
      label: "Parse",
      state: have ? (rejected ? "failed" : "done") : analyzing ? "active" : "pending",
      ...(view ? { detail: rejected ? "Rejected" : "Validated" } : {}),
    },
    { id: "preview", label: "Preview", state: have ? (rejected ? "failed" : "done") : "pending" },
  ];
}

export function ImportCalculationDialog({
  projectId,
  open,
  onClose,
  onImported,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onImported: (detail: ExternalImportDetail) => void;
}) {
  const [phase, setPhase] = useState<Phase>("choose");
  const [view, setView] = useState<ExternalImportView | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busy = phase === "analyzing" || phase === "importing";

  const reset = useCallback(() => {
    setPhase("choose");
    setView(null);
    setFileName(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => reset(), 0);
    return () => window.clearTimeout(timer);
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  async function analyze(file: File) {
    setFileName(file.name);
    setError(null);
    setView(null);
    setPhase("analyzing");
    try {
      const output = await uploadExternalImport({ projectId, file });
      setView(output);
      setPhase("preview");
      window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
    } catch (cause) {
      setPhase("choose");
      setError(cause instanceof Error ? cause.message : "The file could not be analysed.");
    }
  }

  async function confirm() {
    if (!view) return;
    setPhase("importing");
    setError(null);
    try {
      const detail = await confirmExternalImport({ projectId, importId: view.id, previewSha256: view.preview_sha256 });
      window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
      onImported(detail);
    } catch (cause) {
      setPhase("preview");
      setError(cause instanceof Error ? cause.message : "The import could not be completed.");
    }
  }

  if (!open) return null;

  return (
    <div className="import-dialog-backdrop" data-testid="import-dialog-backdrop">
      <div className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title" data-testid="import-calculation-dialog">
        <header className="import-dialog-head">
          <div>
            <h2 id="import-dialog-title">Import calculation</h2>
            <p>Bring in a finished Gaussian or ORCA output. ChemDFT reads the file&apos;s own text, validates it and shows a preview before anything is imported.</p>
          </div>
          <button type="button" className="import-close-btn" onClick={onClose} disabled={busy} aria-label="Close import dialog" data-testid="import-dialog-close">
            ×
          </button>
        </header>

        <ol className="import-steps" aria-label="Import progress" data-testid="import-steps">
          {steps(phase, view).map((step, index) => (
            <li key={step.id} data-testid={`import-step-${step.id}`} data-state={step.state}>
              <span className="import-step-index" aria-hidden="true">{step.state === "done" ? "✓" : step.state === "failed" ? "!" : index + 1}</span>
              <span className="import-step-label">{step.label}</span>
              {step.detail ? <span className="import-step-detail">{step.detail}</span> : null}
            </li>
          ))}
        </ol>

        {error ? (
          <p className="import-error" role="alert" data-testid="import-error">
            {error}
          </p>
        ) : null}

        {phase === "choose" ? (
          <div className="import-choose">
            <label className="import-file-pick">
              <span>Choose an output file</span>
              <input
                ref={inputRef}
                type="file"
                data-testid="import-calculation-file"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void analyze(file);
                }}
              />
            </label>
            <ul className="import-scope">
              <li>Gaussian 09 / 16 and ORCA 5.x / 6.0.x / 6.1.x plain-text outputs</li>
              <li>One completed job per file; unconverged, truncated or multi-job outputs are rejected</li>
              <li>Archives, compressed files and URLs are not accepted; the file is never executed</li>
            </ul>
          </div>
        ) : null}

        {phase === "analyzing" ? (
          <div className="import-analyzing" role="status" data-testid="import-analyzing">
            <div className="import-progress" aria-hidden="true"><span /></div>
            <p>Analysing {fileName ?? "file"} in an isolated parser. The file is not executed and no scientific record is created yet.</p>
          </div>
        ) : null}

        {(phase === "preview" || phase === "importing") && view ? (
          <ImportPreviewPanel
            view={view}
            importing={phase === "importing"}
            onImport={view.preview.status === "READY" ? () => void confirm() : undefined}
          />
        ) : null}

        <footer className="import-dialog-foot">
          {phase === "preview" ? (
            <button type="button" className="import-secondary-btn" onClick={reset} data-testid="import-choose-another">
              Choose another file
            </button>
          ) : null}
          <button type="button" className="import-secondary-btn" onClick={onClose} disabled={busy} data-testid="import-cancel">
            {phase === "preview" ? "Close without importing" : "Cancel"}
          </button>
        </footer>
      </div>
    </div>
  );
}
