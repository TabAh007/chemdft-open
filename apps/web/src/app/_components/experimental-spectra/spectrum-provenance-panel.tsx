"use client";

import type { SpectrumDatasetView, SpectrumComparisonView } from "@chemdft/schemas";
import { ACQUISITION_FIELDS, authorityText, evidenceLabel, opLabel, suppliedText, xUnitText, yUnitText, type EvidenceKind } from "@/lib/experimental-spectra";

const short = (hash: string | null | undefined) => (hash ? `${hash.slice(0, 12)}…` : "—");

/** Where every number on screen came from: source file, units and how they were established, metadata as reported, and each processing step. */
export function SpectrumProvenancePanel({ dataset, all, comparisons }: { dataset: SpectrumDatasetView; all: SpectrumDatasetView[]; comparisons: SpectrumComparisonView[] }) {
  const authority = authorityText(dataset);
  const chain = [...dataset.lineage.map((id) => all.find((item) => item.id === id)).filter((item): item is SpectrumDatasetView => Boolean(item)), dataset];
  const root = chain[0]!;
  const record = dataset.transform ?? null;
  const peaks = dataset.peak_set ?? null;
  return (
    <div className="xspec-provenance" data-testid="spectrum-provenance-panel">
      <section aria-label="Authority">
        <h3>Authority</h3>
        <p><span className="xspec-badge" data-tone={authority.tone} data-testid="spectrum-authority-chip">{authority.label}</span> {authority.detail}</p>
        <dl className="xspec-facts">
          <div><dt>Dataset</dt><dd className="xspec-hash">{dataset.id}</dd></div>
          <div><dt>Source class</dt><dd>{dataset.source_class}</dd></div>
          <div><dt>Processing state</dt><dd>{dataset.state}</dd></div>
          <div><dt>Provenance record</dt><dd className="xspec-hash">{dataset.provenance_record_id}</dd></div>
          <div><dt>Created</dt><dd>{new Date(dataset.created_at).toLocaleString()}</dd></div>
        </dl>
      </section>

      <section aria-label="Units and how they were established">
        <h3>Units and evidence</h3>
        <table className="xspec-table" data-testid="spectrum-unit-evidence">
          <thead><tr><th>Axis</th><th>Quantity and unit</th><th>Evidence</th><th>Detail</th></tr></thead>
          <tbody>
            {[{ id: "x", axis: dataset.x }, { id: "y", axis: dataset.y }].map(({ id, axis }) => (
              <tr key={id}>
                <td>{id === "x" ? "x" : "signal"}{axis.label_in_file ? ` · “${axis.label_in_file}” in file` : ""}</td>
                <td>{axis.quantity ?? "—"} · {id === "x" ? xUnitText(axis.definition.unit.code) : yUnitText(axis.definition.unit.code)}{dataset.representation === "RELATIVE" && id === "y" ? " (relative)" : ""}</td>
                <td data-testid={`spectrum-provenance-evidence-${id}`}>{evidenceLabel(axis.unit_evidence as EvidenceKind)}</td>
                <td>{axis.unit_evidence_text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {dataset.source ? (
        <section aria-label="Source file">
          <h3>Source file (immutable)</h3>
          <dl className="xspec-facts" data-testid="spectrum-source-facts">
            <div><dt>Name</dt><dd>{dataset.source.original_name}</dd></div>
            <div><dt>SHA-256</dt><dd className="xspec-hash">{dataset.source.sha256}</dd></div>
            <div><dt>Size</dt><dd>{dataset.source.size_bytes.toLocaleString()} bytes</dd></div>
            <div><dt>Layout</dt><dd>{[dataset.source.delimiter, dataset.source.decimal === "," ? "decimal comma" : "decimal point", dataset.source.encoding, dataset.source.newline, dataset.source.orientation].filter(Boolean).join(" · ")}</dd></div>
            <div><dt>Original axis direction</dt><dd>{dataset.source.original_axis_direction} (stored in file order; never re-sorted)</dd></div>
            <div><dt>Parser</dt><dd>{dataset.source.parser_name} {dataset.source.parser_version} · {dataset.source.worker_version}</dd></div>
            <div><dt>Confirmed preview</dt><dd className="xspec-hash">{dataset.source.preview_sha256}</dd></div>
          </dl>
        </section>
      ) : (
        <section aria-label="Raw data">
          <h3>Derived from</h3>
          <p>Raw data: <strong>{root.name}</strong> (<span className="xspec-hash">{short(root.arrays_sha256)}</span>). Open that dataset for the source file, parser and confirmed preview.</p>
        </section>
      )}

      <section aria-label="Metadata">
        <h3>Instrument, sample and acquisition</h3>
        <p className="xspec-note">As reported in the file or entered by a person; anything else is <strong>Not supplied</strong>. Nothing is inferred.</p>
        <table className="xspec-table" data-testid="spectrum-metadata-table">
          <tbody>
            {ACQUISITION_FIELDS.filter((f) => f.techniques.includes(dataset.technique)).map((f) => {
              const entry = suppliedText(dataset.acquisition?.[f.key as keyof NonNullable<typeof dataset.acquisition>] as never);
              return <tr key={f.key} data-testid={`spectrum-meta-row-${f.key}`}><th scope="row">{f.label}</th><td data-tone={entry.tone}>{entry.text}</td></tr>;
            })}
            <tr><th scope="row">Instrument</th><td>{suppliedText(dataset.instrument).text}</td></tr>
            <tr><th scope="row">Sample</th><td>{suppliedText(dataset.sample).text}</td></tr>
          </tbody>
        </table>
        {dataset.metadata_verbatim.length ? (
          <details><summary>{dataset.metadata_verbatim.length} header lines read from the file (verbatim, inert text)</summary>
            <ul className="xspec-verbatim">{dataset.metadata_verbatim.map((m) => <li key={`${m.line}-${m.key}`}><code>{m.line}</code> {m.key}: {m.value}</li>)}</ul>
          </details>
        ) : null}
      </section>

      <section aria-label="Processing history">
        <h3>Processing history</h3>
        <ol className="xspec-history" data-testid="spectrum-history">
          {chain.map((item, index) => (
            <li key={item.id} data-testid={`spectrum-history-${index}`}>
              <strong>{index === 0 ? "Raw measurement" : item.kind === "PEAKS" ? "Peak detection" : opLabel(item.transform?.op ?? "")}</strong>
              <span>{item.name}</span>
              <span className="xspec-hash" title={item.arrays_sha256 ?? undefined}>{item.kind === "PEAKS" ? `record ${short(item.peak_set?.record_sha256)}` : `data ${short(item.arrays_sha256)}`}</span>
              {item.transform ? <span>{item.transform.library} {item.transform.library_version}</span> : null}
            </li>
          ))}
        </ol>
      </section>

      {record ? (
        <section aria-label="Transform record">
          <h3>This transform</h3>
          <dl className="xspec-facts" data-testid="spectrum-transform-record">
            <div><dt>Operation</dt><dd>{opLabel(record.op)}</dd></div>
            <div><dt>Library</dt><dd>{record.library} {record.library_version}</dd></div>
            <div><dt>Input data</dt><dd className="xspec-hash">{record.input.artifact_sha256}</dd></div>
            <div><dt>Output data</dt><dd className="xspec-hash">{record.output.artifact_sha256}</dd></div>
            <div><dt>Record</dt><dd className="xspec-hash">{record.record_sha256}</dd></div>
          </dl>
          <h4>Parameters you chose</h4>
          <ul className="xspec-params">{record.parameters.map((p) => <li key={p.key}><code>{p.key}</code> = {String(p.value)}</li>)}</ul>
          <h4>Values derived from them</h4>
          <ul className="xspec-params">{record.resolved.map((p) => <li key={p.key}><code>{p.key}</code> = {String(p.value)}</li>)}</ul>
          {record.warnings.length ? <ul className="xspec-diagnostics" data-testid="spectrum-transform-warnings">{record.warnings.map((w) => <li key={w.code} data-tone="warning"><strong>{w.code.replaceAll("_", " ").toLowerCase()}</strong> {w.message}</li>)}</ul> : null}
          <details><summary>Computing environment</summary><ul className="xspec-params">{record.environment.map((p) => <li key={p.key}><code>{p.key}</code> = {String(p.value)}</li>)}</ul></details>
        </section>
      ) : null}

      {peaks ? (
        <section aria-label="Peak detection record">
          <h3>This peak set</h3>
          <p className="xspec-note">{peaks.algorithm}. {peaks.library} {peaks.library_version}. Peaks are algorithm output, not measurements.</p>
          <ul className="xspec-params">{peaks.parameters.map((p) => <li key={p.key}><code>{p.key}</code> = {String(p.value)}</li>)}</ul>
          <ul className="xspec-params">{peaks.resolved.map((p) => <li key={p.key}><code>{p.key}</code> = {String(p.value)}</li>)}</ul>
          {peaks.warnings.length ? <ul className="xspec-diagnostics">{peaks.warnings.map((w) => <li key={w.code} data-tone="warning"><strong>{w.code.replaceAll("_", " ").toLowerCase()}</strong> {w.message}</li>)}</ul> : null}
        </section>
      ) : null}

      {comparisons.length ? (
        <section aria-label="Comparisons">
          <h3>Comparisons made with this spectrum</h3>
          <ul className="xspec-params" data-testid="spectrum-provenance-comparisons">{comparisons.map((c) => <li key={c.id}>{c.calculated.label} · {c.scaling.mode === "UNSCALED" ? "unscaled" : `scale ${c.scaling.factor}`} · ±{c.tolerance} · record <span className="xspec-hash">{short(c.record_sha256)}</span></li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}
