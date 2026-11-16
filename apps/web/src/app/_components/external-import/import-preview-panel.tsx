"use client";

import type { ExternalImportView, ImportItem } from "@chemdft/schemas";
import {
  IMPORT_STATE_ORDER,
  IMPORT_STATE_TITLE,
  IMPORTED_RESULT_TITLE,
  groupImportItems,
  methodBasisDisplay,
  programDisplay,
  shortHash,
  type ImportedResultType,
} from "@/lib/imported-results";

const TERMINATION_TEXT = {
  COMPLETED: "Terminated normally",
  INCOMPLETE: "Incomplete (truncated)",
  ERROR_TERMINATION: "Error termination",
} as const;

const SCF_TEXT = { CONVERGED: "Converged", NOT_CONVERGED: "Not converged", UNKNOWN: "Not established" } as const;
const OPT_TEXT = { CONVERGED: "Converged", NOT_CONVERGED: "Not converged", NOT_REQUESTED: "Not requested" } as const;

export function ImportPreviewPanel({
  view,
  onImport,
  importing = false,
  confirmationNote,
}: {
  view: ExternalImportView;
  /** Absent once the import is confirmed (or when the preview is rejected). */
  onImport?: (() => void) | undefined;
  importing?: boolean;
  confirmationNote?: string | undefined;
}) {
  const preview = view.preview;
  const job = preview.job;
  const groups = groupImportItems(preview.items);
  const rejected = preview.status === "REJECTED";
  const diagnostics = preview.diagnostics ?? [];
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  const rejections = diagnostics.filter((item) => item.severity === "reject");
  const parsedTypes = (preview.results ?? []).map((item) => IMPORTED_RESULT_TITLE[item.result_type as ImportedResultType] ?? item.result_type);

  return (
    <section className="import-preview" data-testid="import-preview" data-preview-status={preview.status} aria-label="Import preview">
      <header className="import-preview-head">
        <div>
          <h3>{rejected ? "File cannot be imported" : "Preview — nothing has been imported yet"}</h3>
          <p>
            {rejected
              ? "ChemDFT validated the file's own text and rejected it. The uploaded source is kept unchanged as a record."
              : "Review exactly what ChemDFT found. Importing creates immutable records labelled Imported; no result is recomputed."}
          </p>
        </div>
        <span className={`import-chip import-chip--${rejected ? "reject" : "ok"}`} data-testid="import-preview-status">
          {rejected ? "Rejected" : "Ready to import"}
        </span>
      </header>

      {rejected ? (
        <div className="import-reject-box" role="alert" data-testid="import-rejection">
          <strong>Why it was rejected</strong>
          <ul>
            {(rejections.length > 0 ? rejections : diagnostics).map((item, index) => (
              <li key={`${item.code}-${index}`}>
                <code>{item.code}</code> {item.message}
                {item.line ? <span className="import-line"> (line {item.line})</span> : null}
              </li>
            ))}
            {diagnostics.length === 0 ? <li>The file did not pass ChemDFT validation.</li> : null}
          </ul>
          <p>
            Supported: plain-text Gaussian 09/16 and ORCA 5.x/6.0.x/6.1.x outputs of one completed job. Archives, URLs, binary files,
            truncated outputs, unconverged calculations and multi-job outputs are not importable.
          </p>
        </div>
      ) : null}

      <dl className="import-summary" data-testid="import-summary">
        <div><dt>Program</dt><dd data-testid="import-program">{programDisplay(preview.program)}</dd></div>
        <div><dt>Job type</dt><dd data-testid="import-job-type">{job?.job_type ?? "—"}</dd></div>
        <div>
          <dt>Method</dt>
          <dd data-testid="import-method" data-status={job?.method.status ?? "UNKNOWN"}>
            {job ? methodBasisDisplay(job.method) : "UNKNOWN"}
            {job && job.method.status !== "ESTABLISHED" ? <em className="import-status-note">{job.method.status.toLowerCase()}</em> : null}
          </dd>
        </div>
        <div>
          <dt>Basis</dt>
          <dd data-testid="import-basis" data-status={job?.basis.status ?? "UNKNOWN"}>
            {job ? methodBasisDisplay(job.basis) : "UNKNOWN"}
            {job && job.basis.status !== "ESTABLISHED" ? <em className="import-status-note">{job.basis.status.toLowerCase()}</em> : null}
          </dd>
        </div>
        <div><dt>Charge</dt><dd data-testid="import-charge">{job?.charge ?? "—"}</dd></div>
        <div><dt>Multiplicity</dt><dd data-testid="import-multiplicity">{job?.multiplicity ?? "—"}</dd></div>
        <div>
          <dt>Termination</dt>
          <dd data-testid="import-termination">{job ? TERMINATION_TEXT[job.termination.status] : "—"}</dd>
        </div>
        <div>
          <dt>SCF convergence</dt>
          <dd data-testid="import-scf">{job ? SCF_TEXT[job.convergence.scf.status] : "—"}</dd>
        </div>
        <div>
          <dt>Optimization</dt>
          <dd data-testid="import-optimization">{job ? OPT_TEXT[job.convergence.optimization.status] : "—"}</dd>
        </div>
        <div>
          <dt>Parsed results</dt>
          <dd data-testid="import-parsed-types">{parsedTypes.length > 0 ? parsedTypes.join(" · ") : "None"}</dd>
        </div>
        <div><dt>Warnings</dt><dd data-testid="import-warning-count">{warnings.length}</dd></div>
        <div>
          <dt>Source file</dt>
          <dd>{view.source.original_name} · {view.source.size_bytes.toLocaleString()} bytes</dd>
        </div>
        <div className="import-summary-hash">
          <dt>Source SHA-256</dt>
          <dd><code data-testid="import-source-sha">{view.source.sha256}</code></dd>
        </div>
        <div className="import-summary-hash">
          <dt>Preview SHA-256</dt>
          <dd><code data-testid="import-preview-sha" title="Importing is bound to exactly this preview">{shortHash(view.preview_sha256, 16)}</code></dd>
        </div>
      </dl>

      <div className="import-groups">
        {IMPORT_STATE_ORDER.map((state) => (groups[state].length === 0 ? null : (
          <ImportGroup key={state} state={state} items={groups[state]} />
        )))}
      </div>

      {warnings.length > 0 ? (
        <details className="import-diagnostics" data-testid="import-warnings">
          <summary>Warnings ({warnings.length})</summary>
          <ul>
            {warnings.map((item, index) => (
              <li key={`${item.code}-${index}`}><code>{item.code}</code> {item.message}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {!rejected ? (
        <footer className="import-preview-foot">
          {confirmationNote ? <p className="import-confirmed" data-testid="import-confirmed">{confirmationNote}</p> : null}
          {onImport ? (
            <>
              <p>
                Importing records an <strong>Imported</strong> calculation with the source file as immutable evidence. Imported values keep
                the program&apos;s own numbers and are not ChemDFT engine results.
              </p>
              <button type="button" className="import-primary-btn" data-testid="import-confirm-button" disabled={importing} onClick={onImport}>
                {importing ? "Importing…" : "Import calculation"}
              </button>
            </>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}

function ImportGroup({ state, items }: { state: ImportItem["state"]; items: ImportItem[] }) {
  return (
    <section className={`import-group import-group--${state.toLowerCase()}`} data-testid={`import-group-${state}`} aria-label={IMPORT_STATE_TITLE[state]}>
      <h4>
        {IMPORT_STATE_TITLE[state]} <span className="import-group-count">{items.length}</span>
      </h4>
      <ul>
        {items.map((item) => (
          <li key={item.id} data-testid={`import-item-${item.id}`} data-state={item.state}>
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
