"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SpectrumChoices, SpectrumDatasetView, SpectrumTechnique, SpectrumUploadView } from "@chemdft/schemas";
import { confirmSpectrum, resolveSpectrum, uploadSpectrum } from "@/lib/experimental-spectra-api";
import {
  ACQUISITION_FIELDS,
  TECHNIQUES,
  TECHNIQUE_LABEL,
  X_UNITS_BY_TECHNIQUE,
  Y_OPTIONS_BY_TECHNIQUE,
  conventionalInversion,
  evidenceAccepted,
  evidenceLabel,
  evidenceTone,
  importButtonState,
  needText,
  parseNumber,
  suppliedText,
  xUnitText,
  yUnitText,
  type EvidenceKind,
} from "@/lib/experimental-spectra";
import { ExperimentalSpectrumChart } from "./experimental-spectrum-chart";

/** Window event the Explorer, Guided navigation and toolbars use to open the spectrum import dialog. */
export const OPEN_IMPORT_SPECTRUM_EVENT = "chemdft:open-import-spectrum";

type Phase = "choose" | "analyzing" | "preview" | "importing";
type Metadata = NonNullable<SpectrumChoices["metadata"]>;

interface Draft {
  xIndex: number | null;
  yIndex: number | null;
  yErrorIndex: number | null;
  xUnit: string;
  yKey: string;
  excludeInvalid: boolean;
  instrument: string;
  sample: string;
  displayName: string;
  meta: Record<string, string>;
}

const emptyDraft: Draft = { xIndex: null, yIndex: null, yErrorIndex: null, xUnit: "", yKey: "", excludeInvalid: false, instrument: "", sample: "", displayName: "", meta: {} };
const NUMERIC_META = new Set(["path_length_cm", "resolution_cm1", "excitation_wavelength_nm", "integration_time_s", "bandwidth_nm"]);
const ENUM_META: Record<string, string[]> = { phase: ["GAS", "LIQUID", "SOLUTION", "SOLID", "OTHER"], sampling_mode: ["TRANSMISSION", "ATR", "GAS_CELL", "DRIFTS", "OTHER"] };

function buildChoices(draft: Draft): SpectrumChoices {
  const choices: SpectrumChoices = { exclude_invalid_rows: draft.excludeInvalid };
  if (draft.xIndex !== null) choices.x_index = draft.xIndex;
  if (draft.yIndex !== null) choices.y_index = draft.yIndex;
  if (draft.yErrorIndex !== null) choices.y_error_index = draft.yErrorIndex;
  if (draft.xUnit) choices.x_unit = draft.xUnit as NonNullable<SpectrumChoices["x_unit"]>;
  if (draft.yKey) {
    const [quantity, unit] = draft.yKey.split("|");
    choices.y_quantity = quantity as NonNullable<SpectrumChoices["y_quantity"]>;
    choices.y_unit = unit as NonNullable<SpectrumChoices["y_unit"]>;
  }
  const metadata: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(draft.meta)) {
    const text = raw.trim();
    if (!text) continue;
    if (NUMERIC_META.has(key)) { const value = parseNumber(text); if (value !== null && value > 0) metadata[key] = value; }
    else if (key === "accumulations") { const value = parseNumber(text); if (value !== null && Number.isInteger(value) && value > 0) metadata[key] = value; }
    else metadata[key] = text;
  }
  if (Object.keys(metadata).length) choices.metadata = metadata as Metadata;
  if (draft.instrument.trim()) choices.instrument = draft.instrument.trim();
  if (draft.sample.trim()) choices.sample = draft.sample.trim();
  if (draft.displayName.trim()) choices.display_name = draft.displayName.trim();
  return choices;
}

function draftFrom(view: SpectrumUploadView, previous: Draft): Draft {
  const choice = view.latest_preview.body.choice;
  return {
    ...previous,
    xIndex: choice?.x_index ?? previous.xIndex,
    yIndex: choice?.y_index ?? previous.yIndex,
    yErrorIndex: choice?.y_error_index ?? previous.yErrorIndex,
  };
}

export function ImportSpectrumDialog({
  projectId,
  open,
  onClose,
  onImported,
  initialTechnique = "IR",
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onImported: (dataset: SpectrumDatasetView) => void;
  initialTechnique?: SpectrumTechnique;
}) {
  const [phase, setPhase] = useState<Phase>("choose");
  const [technique, setTechnique] = useState<SpectrumTechnique>(initialTechnique);
  const [view, setView] = useState<SpectrumUploadView | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [dirty, setDirty] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busy = phase === "analyzing" || phase === "importing" || updating;

  const reset = useCallback(() => {
    setPhase("choose"); setView(null); setFileName(null); setDraft(emptyDraft); setDirty(false); setError(null); setUpdating(false);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => reset(), 0);
    return () => window.clearTimeout(timer);
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) { if (event.key === "Escape" && !busy) onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  async function analyze(file: File) {
    setFileName(file.name); setError(null); setView(null); setPhase("analyzing"); setDraft(emptyDraft); setDirty(false);
    try {
      const output = await uploadSpectrum({ projectId, file, technique });
      setView(output); setDraft(draftFrom(output, emptyDraft)); setPhase("preview");
      window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
    } catch (cause) {
      setPhase("choose");
      setError(cause instanceof Error ? cause.message : "The file could not be analysed.");
    }
  }

  async function apply(next: Draft) {
    if (!view) return;
    setDraft(next); setUpdating(true); setError(null);
    try {
      const output = await resolveSpectrum({ projectId, uploadId: view.id, choices: buildChoices(next) });
      setView(output); setDraft(draftFrom(output, next)); setDirty(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The preview could not be updated.");
    } finally {
      setUpdating(false);
    }
  }

  async function confirm() {
    if (!view) return;
    setPhase("importing"); setError(null);
    try {
      const dataset = await confirmSpectrum({ projectId, uploadId: view.id, previewSha256: view.latest_preview.preview_sha256 });
      window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
      onImported(dataset);
    } catch (cause) {
      setPhase("preview");
      setError(cause instanceof Error ? cause.message : "The import could not be completed.");
    }
  }

  const body = view?.latest_preview.body ?? null;
  const gate = importButtonState(body);
  const importEnabled = gate.enabled && !dirty && !busy;
  const trace = useMemo(() => (body?.display ? [{ id: "raw", label: "Parsed from the file (as supplied)", x: body.display.x, y: body.display.y, style: "raw" as const }] : []), [body]);

  if (!open) return null;
  const xOptions = X_UNITS_BY_TECHNIQUE[technique];
  const yOptions = Y_OPTIONS_BY_TECHNIQUE[technique];
  const activeTechnique = (view?.technique ?? technique) as SpectrumTechnique;

  return (
    <div className="import-dialog-backdrop" data-testid="import-spectrum-backdrop">
      <div className="import-dialog xspec-import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-spectrum-title" data-testid="import-spectrum-dialog">
        <header className="import-dialog-head">
          <div>
            <h2 id="import-spectrum-title">Import experimental spectrum</h2>
            <p>Bring in a measured IR/FTIR, Raman or UV/Vis spectrum from a plain-text file. ChemDFT shows exactly what it read, asks you to confirm every unit the file does not state, and only then stores it. The imported data are never edited afterwards.</p>
          </div>
          <button type="button" className="import-close-btn" onClick={onClose} disabled={busy} aria-label="Close import dialog" data-testid="import-spectrum-close">×</button>
        </header>

        {error ? <p className="import-error" role="alert" data-testid="import-spectrum-error">{error}</p> : null}

        {phase === "choose" ? (
          <div className="import-choose">
            <fieldset className="xspec-technique" disabled={busy}>
              <legend>Technique</legend>
              {TECHNIQUES.map((item) => (
                <label key={item} className={technique === item ? "is-active" : undefined}>
                  <input type="radio" name="spectrum-technique" value={item} checked={technique === item} onChange={() => setTechnique(item)} data-testid={`spectrum-technique-${item}`} />
                  {TECHNIQUE_LABEL[item]}
                </label>
              ))}
            </fieldset>
            <label className="import-file-pick">
              <span>Choose a spectrum file</span>
              <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,.dat,.asc,text/plain,text/csv" data-testid="spectrum-file" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void analyze(file); }} />
            </label>
            <ul className="import-scope">
              <li>CSV, TSV, TXT or whitespace-separated columns (UTF-8, UTF-16 or Windows-1252), up to 200 000 points</li>
              <li>Units are never guessed: a unit the file does not state must be confirmed by you before anything is stored</li>
              <li>Vendor binary formats, JCAMP-DX, archives and URLs are not accepted; the file is never executed</li>
            </ul>
          </div>
        ) : null}

        {phase === "analyzing" ? (
          <div className="import-analyzing" role="status" data-testid="import-spectrum-analyzing">
            <div className="import-progress" aria-hidden="true"><span /></div>
            <p>Analysing {fileName ?? "file"} in an isolated parser. Nothing is stored as a spectrum until you confirm.</p>
          </div>
        ) : null}

        {(phase === "preview" || phase === "importing") && view && body ? (
          <div className="xspec-preview" data-testid="import-spectrum-preview">
            <section className="xspec-file-facts" aria-label="File">
              <h3>{view.source.original_name} · {TECHNIQUE_LABEL[activeTechnique]}</h3>
              <dl>
                <div><dt>Points</dt><dd data-testid="spectrum-preview-points">{body.point_count.toLocaleString()}</dd></div>
                <div><dt>Format</dt><dd>{[body.source.delimiter?.toLowerCase(), body.source.decimal === "," ? "decimal comma" : null, body.source.encoding, body.source.orientation === "ROWS" ? "row-oriented" : null].filter(Boolean).join(" · ") || "not recognised"}</dd></div>
                <div><dt>Size</dt><dd>{view.source.size_bytes.toLocaleString()} bytes</dd></div>
                <div><dt>SHA-256</dt><dd className="xspec-hash" title={view.source.sha256}>{view.source.sha256.slice(0, 16)}…</dd></div>
                {body.x ? <div><dt>x range in file</dt><dd>{body.x.min} – {body.x.max} ({body.x.direction_in_file.toLowerCase()})</dd></div> : null}
              </dl>
              <label className="xspec-field">
                <span>Name</span>
                <input type="text" value={draft.displayName} maxLength={160} placeholder={view.source.original_name.replace(/\.[^.]+$/, "")} onChange={(event) => { setDraft({ ...draft, displayName: event.currentTarget.value }); setDirty(true); }} data-testid="spectrum-display-name" />
              </label>
            </section>

            {trace.length ? (
              <ExperimentalSpectrumChart
                traces={trace}
                xLabel={axisLabel(body.x?.label_in_file, "x", body.x?.unit ? xUnitText(body.x.unit) : null)}
                yLabel={axisLabel(body.y?.label_in_file, "signal", body.y?.unit ? yUnitText(body.y.unit) : null)}
                inverted={body.x?.unit ? conventionalInversion(activeTechnique, body.x.unit) : false}
                height={240}
                testIdPrefix="spectrum-preview"
                ariaLabel="Raw preview of the parsed spectrum"
                description="The columns parsed from the uploaded file, drawn exactly as supplied before anything is stored."
              />
            ) : null}

            {body.columns.length > 2 || body.needs.includes("column_roles") ? (
              <section className="xspec-columns" aria-label="Columns" data-testid="spectrum-columns">
                <h4>Which columns are x and y?</h4>
                <table className="xspec-table">
                  <thead><tr><th>Column</th><th>Label in file</th><th>Range</th><th>x</th><th>signal</th><th>uncertainty</th></tr></thead>
                  <tbody>
                    {body.columns.map((column) => (
                      <tr key={column.index}>
                        <td>{column.index + 1}</td>
                        <td>{column.label ?? <em>none</em>}</td>
                        <td>{column.min ?? "—"} … {column.max ?? "—"}</td>
                        {(["x", "y", "e"] as const).map((role) => {
                          const current = role === "x" ? draft.xIndex : role === "y" ? draft.yIndex : draft.yErrorIndex;
                          return (
                            <td key={role}>
                              <input type="radio" name={`role-${role}`} aria-label={`Column ${column.index + 1} as ${role === "e" ? "uncertainty" : role}`} checked={current === column.index} data-testid={`spectrum-col-${role}-${column.index}`}
                                onChange={() => void apply({ ...draft, xIndex: role === "x" ? column.index : draft.xIndex, yIndex: role === "y" ? column.index : draft.yIndex, yErrorIndex: role === "e" ? column.index : draft.yErrorIndex })} disabled={busy} />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}

            <section className="xspec-units" aria-label="Units" data-testid="spectrum-units">
              <h4>Units</h4>
              <div className="xspec-unit-row">
                <label>
                  <span>x axis</span>
                  <select value={draft.xUnit || body.x?.unit || ""} onChange={(event) => void apply({ ...draft, xUnit: event.currentTarget.value })} disabled={busy} data-testid="spectrum-x-unit">
                    <option value="" disabled>Choose the x unit…</option>
                    {xOptions.map((unit) => <option key={unit} value={unit}>{xUnitText(unit)}</option>)}
                  </select>
                </label>
                <EvidenceLine kind="x" evidence={(body.x?.unit_evidence ?? "NONE") as EvidenceKind} text={body.x?.unit_evidence_text ?? body.proposals.x?.evidence ?? ""} proposal={body.proposals.x} confirmed={Boolean(body.x?.unit)} />
              </div>
              <div className="xspec-unit-row">
                <label>
                  <span>signal</span>
                  <select value={draft.yKey || (body.y?.quantity && body.y.unit ? `${body.y.quantity}|${body.y.unit}` : "")} onChange={(event) => void apply({ ...draft, yKey: event.currentTarget.value })} disabled={busy} data-testid="spectrum-y-unit">
                    <option value="" disabled>Choose what the signal measures…</option>
                    {yOptions.map((option) => <option key={`${option.quantity}|${option.unit}`} value={`${option.quantity}|${option.unit}`}>{option.label}</option>)}
                  </select>
                </label>
                <EvidenceLine kind="y" evidence={(body.y?.unit_evidence ?? "NONE") as EvidenceKind} text={body.y?.unit_evidence_text ?? body.proposals.y?.evidence ?? ""} proposal={body.proposals.y} confirmed={Boolean(body.y?.unit)} />
              </div>
              {body.needs.length ? <ul className="xspec-needs" role="status" data-testid="spectrum-needs">{body.needs.map((need) => <li key={need}>{needText(need)}</li>)}</ul> : null}
            </section>

            <details className="xspec-metadata" open={ACQUISITION_FIELDS.some((f) => f.techniques.includes(activeTechnique) && body.acquisition[f.key as keyof typeof body.acquisition]?.status === "AS_REPORTED_IN_FILE")}>
              <summary>Instrument, sample and acquisition metadata</summary>
              <p className="xspec-note">Values found in the file are shown as reported. Anything missing stays <strong>Not supplied</strong>; ChemDFT never fills it in. You may enter values you know.</p>
              <div className="xspec-meta-grid">
                {ACQUISITION_FIELDS.filter((f) => f.techniques.includes(activeTechnique)).map((field) => {
                  const reported = suppliedText(body.acquisition[field.key as keyof typeof body.acquisition]);
                  const options = ENUM_META[field.key];
                  return (
                    <label key={field.key} className="xspec-field" data-testid={`spectrum-meta-${field.key}`}>
                      <span>{field.label}</span>
                      {options ? (
                        <select value={draft.meta[field.key] ?? ""} onChange={(event) => { setDraft({ ...draft, meta: { ...draft.meta, [field.key]: event.currentTarget.value } }); setDirty(true); }}>
                          <option value="">— not entered —</option>
                          {options.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ").toLowerCase()}</option>)}
                        </select>
                      ) : (
                        <input type="text" value={draft.meta[field.key] ?? ""} placeholder={reported.tone === "none" ? "Not supplied" : reported.text} onChange={(event) => { setDraft({ ...draft, meta: { ...draft.meta, [field.key]: event.currentTarget.value } }); setDirty(true); }} />
                      )}
                      <small className={`xspec-supplied xspec-supplied-${reported.tone}`}>{reported.text}</small>
                    </label>
                  );
                })}
                <label className="xspec-field"><span>Instrument</span><input type="text" value={draft.instrument} maxLength={200} placeholder={suppliedText(body.instrument).text} onChange={(event) => { setDraft({ ...draft, instrument: event.currentTarget.value }); setDirty(true); }} /><small className={`xspec-supplied xspec-supplied-${suppliedText(body.instrument).tone}`}>{suppliedText(body.instrument).text}</small></label>
                <label className="xspec-field"><span>Sample</span><input type="text" value={draft.sample} maxLength={200} placeholder={suppliedText(body.sample).text} onChange={(event) => { setDraft({ ...draft, sample: event.currentTarget.value }); setDirty(true); }} /><small className={`xspec-supplied xspec-supplied-${suppliedText(body.sample).tone}`}>{suppliedText(body.sample).text}</small></label>
              </div>
            </details>

            {body.diagnostics.length ? (
              <ul className="xspec-diagnostics" aria-label="Diagnostics" data-testid="spectrum-diagnostics">
                {body.diagnostics.map((d, index) => (
                  <li key={`${d.code}-${index}`} data-tone={d.severity}>
                    <strong>{d.code.replaceAll("_", " ").toLowerCase()}</strong> {d.message}{d.line ? ` (line ${d.line})` : ""}
                    {d.code === "INVALID_VALUES_IN_SERIES" ? <button type="button" className="xspec-link-btn" onClick={() => void apply({ ...draft, excludeInvalid: true })} data-testid="spectrum-exclude-invalid">Exclude these rows and show the result</button> : null}
                  </li>
                ))}
              </ul>
            ) : null}

            <footer className="xspec-confirm">
              <p className="xspec-note" data-testid="spectrum-confirm-note">
                {dirty ? "Your entries are not applied yet. Update the preview so what you confirm is exactly what is stored." : importEnabled ? "This will store the spectrum as raw EXPERIMENTAL data with the units and evidence shown. It will not be edited; processing always creates new versions." : gate.reason}
              </p>
              <div className="xspec-confirm-actions">
                {dirty ? <button type="button" className="import-secondary-btn" onClick={() => void apply(draft)} disabled={busy} data-testid="spectrum-update-preview">Update preview</button> : null}
                <button type="button" className="import-primary-btn" disabled={!importEnabled} onClick={() => void confirm()} data-testid="spectrum-import-confirm">{phase === "importing" ? "Importing…" : "Import experimental spectrum"}</button>
              </div>
            </footer>
            <p className="xspec-hash-line" data-testid="spectrum-preview-hash">Preview {view.latest_preview.preview_sha256.slice(0, 16)}… · import is bound to exactly this preview</p>
          </div>
        ) : null}

        <footer className="import-dialog-foot">
          {phase === "preview" ? <button type="button" className="import-secondary-btn" onClick={reset} disabled={busy} data-testid="spectrum-choose-another">Choose another file</button> : null}
          <button type="button" className="import-secondary-btn" onClick={onClose} disabled={busy} data-testid="spectrum-cancel">{phase === "preview" ? "Close without importing" : "Cancel"}</button>
        </footer>
      </div>
    </div>
  );
}

/** The file's own label wins; the confirmed unit is added only when the label does not already carry one. */
function axisLabel(labelInFile: string | null | undefined, fallback: string, unit: string | null): string {
  const label = labelInFile?.trim() || fallback;
  if (!unit) return `${label} (unit not confirmed)`;
  return /[([].*[)\]]\s*$/.test(label) ? label : `${label} (${unit})`;
}

function EvidenceLine({ kind, evidence, text, proposal, confirmed }: {
  kind: "x" | "y";
  evidence: EvidenceKind;
  text: string;
  proposal: { unit: string | null; quantity: string | null; level: string; evidence: string } | null | undefined;
  confirmed: boolean;
}) {
  const tone = evidenceTone(evidence);
  return (
    <div className={`xspec-evidence xspec-evidence-${tone}`} data-testid={`spectrum-evidence-${kind}`} data-evidence={evidence}>
      <strong>{evidenceLabel(evidence)}</strong>
      {text ? <span>{text}</span> : null}
      {!confirmed && proposal && proposal.unit ? <span className="xspec-suggestion">Suggestion: {kind === "x" ? xUnitText(proposal.unit) : yUnitText(proposal.unit)} — not accepted until you choose it. {proposal.evidence}</span> : null}
      {!confirmed && !evidenceAccepted(evidence) ? <span className="xspec-required">Required before import</span> : null}
    </div>
  );
}
