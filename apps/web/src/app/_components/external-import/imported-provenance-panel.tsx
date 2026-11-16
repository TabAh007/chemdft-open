"use client";

import type { ExternalImportDetail } from "@chemdft/schemas";
import {
  IMPORTED_RESULT_TITLE,
  asEnergy,
  asExcitations,
  asOrbitals,
  asThermochemistry,
  methodBasisDisplay,
  programDisplay,
  type ImportedResultType,
} from "@/lib/imported-results";

function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

/** Advanced provenance: everything needed to trace an imported value back to the exact source text. */
export function ImportedProvenancePanel({ detail }: { detail: ExternalImportDetail }) {
  const record = detail.import_record;
  const preview = record.preview;
  const job = preview.job;
  const jobRow = detail.jobs?.[0];
  const conversions = new Set<string>();
  const energy = asEnergy(detail.results)?.payload;
  if (energy) conversions.add(energy.scf_energy.conversion);
  const orbitals = asOrbitals(detail.results)?.payload;
  if (orbitals) conversions.add(orbitals.conversion);
  const excitations = asExcitations(detail.results)?.payload;
  if (excitations) Object.values(excitations.energy_conversion).forEach((value) => conversions.add(value));
  const thermo = asThermochemistry(detail.results)?.payload;
  if (thermo) {
    [thermo.zero_point_energy_hartree, thermo.enthalpy_hartree, thermo.gibbs_free_energy_hartree, thermo.entropy_hartree_per_k].forEach((q) => conversions.add(q.conversion));
  }

  return (
    <div className="imported-provenance" data-testid="imported-provenance-panel">
      <header className="imported-section-head">
        <div>
          <h2>Provenance</h2>
          <p>Every imported value is tied to the immutable source file, the parser build and the exact preview you confirmed.</p>
        </div>
        <span className="import-chip import-chip--imported">Imported · {programDisplay(preview.program)}</span>
      </header>

      <section aria-label="Source file">
        <h3>Source file</h3>
        <dl className="imported-facts">
          <div><dt>Filename (sanitized)</dt><dd data-testid="prov-filename">{record.source.original_name}</dd></div>
          <div><dt>Size</dt><dd data-testid="prov-size">{record.source.size_bytes.toLocaleString()} bytes</dd></div>
          <div><dt>Source SHA-256</dt><dd><code data-testid="prov-source-sha">{record.source.sha256}</code></dd></div>
          <div><dt>Media class</dt><dd>{record.source.media_class} · immutable</dd></div>
          <div><dt>Uploaded</dt><dd>{formatTime(record.source.uploaded_at)}</dd></div>
        </dl>
      </section>

      <section aria-label="Program and parser">
        <h3>Program and parser</h3>
        <dl className="imported-facts">
          <div><dt>Engine / version</dt><dd data-testid="prov-engine">{programDisplay(preview.program)} (as reported by the output)</dd></div>
          <div><dt>Parser</dt><dd data-testid="prov-parser">{preview.parser.name} {preview.parser.version}</dd></div>
          <div><dt>Parser commit</dt><dd><code data-testid="prov-parser-commit">{preview.parser.commit}</code></dd></div>
          <div><dt>Parser wheel SHA-256</dt><dd><code>{preview.parser.wheel_sha256}</code></dd></div>
          <div><dt>Importer version</dt><dd>{record.importer_version}</dd></div>
          <div><dt>Normalization version</dt><dd data-testid="prov-normalization">{preview.normalization_version}</dd></div>
          <div><dt>Conversion identifiers</dt><dd data-testid="prov-conversions">{conversions.size > 0 ? Array.from(conversions).join(", ") : "none applied"}</dd></div>
          <div><dt>Parse timestamp</dt><dd data-testid="prov-parse-time">{formatTime(record.parse_timestamp)}</dd></div>
        </dl>
      </section>

      <section aria-label="Job evidence">
        <h3>Job and validation evidence</h3>
        <dl className="imported-facts">
          <div><dt>Job type</dt><dd data-testid="prov-job-type">{job?.job_type ?? jobRow?.source_job_type ?? "—"}</dd></div>
          <div><dt>Method</dt><dd>{job ? `${methodBasisDisplay(job.method)} (${job.method.status.toLowerCase()})` : "—"}</dd></div>
          <div><dt>Basis</dt><dd>{job ? `${methodBasisDisplay(job.basis)} (${job.basis.status.toLowerCase()})` : "—"}</dd></div>
          <div><dt>Charge / multiplicity</dt><dd>{job ? `${job.charge ?? "—"} / ${job.multiplicity ?? "—"}` : "—"}</dd></div>
          <div><dt>Termination</dt><dd data-testid="prov-termination">{job ? `${job.termination.status} — ${job.termination.evidence}` : "—"}</dd></div>
          <div><dt>SCF convergence</dt><dd>{job ? `${job.convergence.scf.status} — ${job.convergence.scf.evidence}` : "—"}</dd></div>
          <div><dt>Optimization</dt><dd>{job ? `${job.convergence.optimization.status} — ${job.convergence.optimization.evidence}` : "—"}</dd></div>
          <div><dt>Job line range</dt><dd>{job ? `lines ${job.line_range[0]}–${job.line_range[1]}` : "—"}</dd></div>
        </dl>
      </section>

      <section aria-label="Preview binding">
        <h3>Preview and confirmation</h3>
        <dl className="imported-facts">
          <div><dt>Preview SHA-256</dt><dd><code data-testid="prov-preview-sha">{record.preview_sha256}</code></dd></div>
          <div><dt>Confirmed</dt><dd data-testid="prov-confirmed-at">{formatTime(record.confirmation?.confirmed_at)}</dd></div>
          <div><dt>Confirmed preview SHA-256</dt><dd><code>{record.confirmation?.preview_sha256 ?? "—"}</code></dd></div>
        </dl>
      </section>

      <section aria-label="Source locators">
        <h3>Imported records and source locators</h3>
        <table className="spectro-table imported-locators" data-testid="prov-locators">
          <thead>
            <tr><th>Record</th><th>Source attributes</th><th>Source locator (lines)</th><th>Payload SHA-256</th></tr>
          </thead>
          <tbody>
            {(detail.results ?? []).map((result) => (
              <tr key={result.id}>
                <td>{IMPORTED_RESULT_TITLE[result.result_type as ImportedResultType] ?? result.result_type}</td>
                <td>{result.source_attributes.join(", ")}</td>
                <td>
                  {Object.entries(result.source_locators).map(([key, locator]) => `${key}: ${locator.line_start}–${locator.line_end}`).join("; ") || "—"}
                </td>
                <td><code>{result.payload_sha256.slice(0, 16)}…</code></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="imported-note">
          Authority: IMPORTED · producer VALIDATED_IMPORT_PIPELINE · verification UNVERIFIED. Not a ChemDFT engine result.
        </p>
      </section>
    </div>
  );
}
