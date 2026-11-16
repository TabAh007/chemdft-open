"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CalculatedSourceView, SpectrumArraysView, SpectrumComparisonInput, SpectrumComparisonView, SpectrumDatasetView } from "@chemdft/schemas";
import { createSpectrumComparison, listComparisonSources, listSpectrumComparisons } from "@/lib/experimental-spectra-api";
import {
  CANDIDATE_ONLY_STATEMENT,
  GATED_MAE_STATEMENT,
  axisUnitText,
  conventionalInversion,
  formatDelta,
  formatPosition,
  maxNormalized,
  metricRows,
  parseNumber,
  peakLinkStatement,
  scalingText,
  comparisonHeadline,
  pairForCalculated,
  pairForPeak,
  sourceTitle,
  xUnitText,
  yUnitText,
  phaseText,
} from "@/lib/experimental-spectra";
import { ExperimentalSpectrumChart, type ChartPeak, type ChartStick } from "./experimental-spectrum-chart";
import { SpectrumModeLinkViewer } from "./spectrum-mode-link-viewer";

const EV_CM1 = 8065.54429;

/** Calculated positions arrive in cm⁻¹ (vibrations) or eV (excitations); the chart draws them on the experimental axis unit. */
function toChartX(value: number, from: "cm^-1" | "eV", chartUnit: string): number {
  const wavenumber = from === "eV" ? value * EV_CM1 : value;
  if (chartUnit === "cm^-1") return wavenumber;
  if (chartUnit === "um") return 1e4 / wavenumber;
  if (chartUnit === "nm") return 1e7 / wavenumber;
  if (chartUnit === "eV") return wavenumber / EV_CM1;
  return wavenumber;
}

const SUGGESTED_TOLERANCE: Record<string, { value: string; text: string }> = {
  "cm^-1": { value: "20", text: "20 cm⁻¹ (a starting value; you decide)" },
  eV: { value: "0.2", text: "0.2 eV (a starting value; you decide)" },
  nm: { value: "15", text: "15 nm (a starting value; you decide)" },
};

export function SpectrumComparePanel({
  projectId,
  dataset,
  peakSets,
  arrays,
  onNeedPeaks,
  persistenceKey,
}: {
  projectId: string;
  dataset: SpectrumDatasetView;
  peakSets: SpectrumDatasetView[];
  arrays: SpectrumArraysView | null;
  onNeedPeaks: () => void;
  persistenceKey: string;
}) {
  const technique = dataset.technique;
  const vibrational = technique !== "UVVIS";
  const xUnit = dataset.x.definition.unit.code;
  const [sources, setSources] = useState<CalculatedSourceView[] | null>(null);
  const [saved, setSaved] = useState<SpectrumComparisonView[]>([]);
  const [sourceKey, setSourceKey] = useState("");
  const [peakSetId, setPeakSetId] = useState(peakSets[0]?.id ?? "");
  const [axis, setAxis] = useState<"cm^-1" | "eV" | "nm">(vibrational ? "cm^-1" : "eV");
  const [tolerance, setTolerance] = useState(SUGGESTED_TOLERANCE[vibrational ? "cm^-1" : "eV"]!.value);
  const [scalingMode, setScalingMode] = useState<"UNSCALED" | "USER_FACTOR">("UNSCALED");
  const [factor, setFactor] = useState("");
  const [minIntensity, setMinIntensity] = useState("0.01");
  const [minF, setMinF] = useState("0");
  const [bands, setBands] = useState<Array<{ lo: string; hi: string }>>([]);
  const [similarity, setSimilarity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<SpectrumComparisonView | null>(null);
  const [selectedMode, setSelectedMode] = useState<number | null>(null);
  const [selectedPeak, setSelectedPeak] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [available, previous] = await Promise.all([
        listComparisonSources({ projectId, technique }),
        listSpectrumComparisons({ projectId, experimentalDatasetId: dataset.id }),
      ]);
      setSources(available.sources);
      setSaved(previous.comparisons);
      setSourceKey((current) => current || (available.sources[0] ? `${available.sources[0].kind}:${available.sources[0].id}` : ""));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Comparison sources could not be loaded.");
    }
  }, [projectId, technique, dataset.id]);

  useEffect(() => { queueMicrotask(() => void refresh()); }, [refresh]);
  useEffect(() => { queueMicrotask(() => setPeakSetId((current) => (peakSets.some((p) => p.id === current) ? current : (peakSets[0]?.id ?? "")))); }, [peakSets]);

  const source = sources?.find((item) => `${item.kind}:${item.id}` === sourceKey) ?? null;
  const experimentalPhase = dataset.acquisition?.phase;
  const phaseNotice = useMemo(() => {
    const value = experimentalPhase && experimentalPhase.status !== "NOT_SUPPLIED" ? String(experimentalPhase.value) : null;
    if (!source) return null;
    if (!value) return { tone: "warning", text: "The experimental sample phase was not supplied, so a phase or sample mismatch with the calculation cannot be judged (UNKNOWN)." };
    if (source.phase === "UNKNOWN") return { tone: "warning", text: `The phase of the external calculation is not known; the experiment is ${value}.` };
    if (["LIQUID", "SOLUTION", "SOLID"].includes(value) && source.phase === "GAS") return { tone: "warning", text: `The experiment is ${value} but the calculation is an isolated gas-phase molecule. Intermolecular interactions and solvent shift positions and intensities, so differences are not evidence about the calculation alone.` };
    return { tone: "info", text: `Experiment: ${value}; calculation: ${source.phase === "GAS" ? "gas phase" : source.phase}.` };
  }, [experimentalPhase, source]);

  async function run() {
    if (!source || !peakSetId) return;
    const tol = parseNumber(tolerance);
    if (tol === null || tol <= 0) { setError("Enter a positive matching tolerance."); return; }
    const input: Omit<SpectrumComparisonInput, "idempotency_key"> = {
      experimental_dataset_id: dataset.id,
      peak_set_dataset_id: peakSetId,
      calculated: { kind: source.kind, id: source.id },
      tolerance: tol,
      axis,
      min_relative_intensity: parseNumber(minIntensity) ?? 0.01,
      min_oscillator_strength: parseNumber(minF) ?? 0,
      scaling: scalingMode === "USER_FACTOR" ? { mode: "USER_FACTOR", factor: parseNumber(factor) ?? 0 } : { mode: "UNSCALED" },
      // The generated schema types a bounded array as a fixed-length tuple; the server accepts 0–16 bands.
      bands: bands.flatMap((band) => { const lo = parseNumber(band.lo), hi = parseNumber(band.hi); return lo && hi && lo < hi ? [{ lo_nm: lo, hi_nm: hi }] : []; }) as unknown as NonNullable<SpectrumComparisonInput["bands"]>,
      ...(similarity && vibrational && dataset.x_min !== null && dataset.x_max !== null ? { similarity: { lorentzian_fwhm_cm1: 16, window_cm1: [dataset.x_min, dataset.x_max] as [number, number], step_cm1: 1 } } : {}),
    };
    setBusy(true); setError(null);
    try {
      const result = await createSpectrumComparison({ projectId, input });
      setComparison(result); setSelectedMode(null); setSelectedPeak(null);
      window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The comparison could not be created.");
    } finally {
      setBusy(false);
    }
  }

  const chosenComparison = comparison;
  const trace = useMemo(() => (arrays ? [{ id: "experimental", label: `Experimental · ${dataset.name} (each curve scaled by its own maximum)`, x: arrays.x.slice(), y: maxNormalized(arrays.y.slice()), style: "processed" as const }] : []), [arrays, dataset.name]);
  const chartPeaks: ChartPeak[] = useMemo(() => {
    if (!chosenComparison) return [];
    const peaks = peakSets.find((p) => p.id === chosenComparison.peak_set_dataset_id)?.peak_set?.peaks ?? [];
    const top = Math.max(...(arrays?.y.map(Math.abs) ?? [1]), 1e-12);
    return peaks.map((peak, i) => {
      const pair = pairForPeak(chosenComparison, i);
      return { index: i, x: peak.x, y: peak.y / top, label: peak.x.toFixed(vibrational ? 0 : 1), matched: pair ? (pair.status === "AMBIGUOUS_CANDIDATE" ? "ambiguous" : "matched") : "unmatched" } as ChartPeak;
    });
  }, [chosenComparison, peakSets, arrays, vibrational]);
  const sticks: ChartStick[] = useMemo(() => {
    if (!chosenComparison) return [];
    const uv = chosenComparison.technique === "UVVIS";
    const from = uv ? "eV" : "cm^-1";
    const rows = [
      ...chosenComparison.pairs.map((p) => ({ index: p.calculated_index, source: p.calculated_position_source, compared: p.calculated_position, rel: p.relative_intensity_calculated ?? p.calculated_oscillator_strength, status: p.status === "AMBIGUOUS_CANDIDATE" ? "ambiguous" as const : "matched" as const })),
      ...chosenComparison.unmatched_calculated.map((u) => ({ index: u.calculated_index, source: u.calculated_position_source, compared: u.calculated_position, rel: u.relative_intensity_calculated ?? u.calculated_oscillator_strength, status: "unmatched" as const })),
    ];
    const top = Math.max(...rows.map((r) => r.rel ?? 0), 0);
    return rows.map((r) => ({
      id: r.index,
      x: toChartX(uv ? r.source : r.compared, from, xUnit),
      relative: r.rel !== null && top > 0 ? r.rel / top : 0.35,
      label: `${uv ? "state" : "mode"} ${r.index + 1}`,
      status: r.status,
    }));
  }, [chosenComparison, xUnit]);

  function selectMode(index: number) {
    setSelectedMode(index);
    const pair = chosenComparison ? pairForCalculated(chosenComparison, index) : null;
    setSelectedPeak(pair ? pair.experimental_peak_index : null);
  }
  function selectPeak(index: number) {
    setSelectedPeak(index);
    const pair = chosenComparison ? pairForPeak(chosenComparison, index) : null;
    if (pair) setSelectedMode(pair.calculated_index);
  }

  if (peakSets.length === 0) {
    return (
      <div className="xspec-empty" data-testid="spectrum-compare-needs-peaks">
        <h3>Detect peaks first</h3>
        <p>A comparison pairs the peaks detected on this version with the modes or states of a calculation. Detect peaks, then return here.</p>
        <button type="button" className="import-primary-btn" onClick={onNeedPeaks} data-testid="spectrum-compare-go-peaks">Go to peak detection</button>
      </div>
    );
  }

  return (
    <div className="xspec-compare" data-testid="spectrum-compare-panel">
      <section className="xspec-section-static" aria-label="Comparison setup">
        <h3>Compare with a calculation</h3>
        <p className="xspec-note">{vibrational ? "Experimental peaks are matched to calculated modes by position only. Calculated and experimental intensities are different quantities and are shown for orientation, not compared." : "Experimental band positions are matched to calculated excited states, and oscillator strengths are compared only where the measured quantity is an absolute cross section or molar absorptivity."}</p>
        {sources === null ? <p role="status">Loading calculated and imported sources…</p> : sources.length === 0 ? (
          <p className="xspec-empty-inline" data-testid="spectrum-compare-no-sources">No {vibrational ? "vibrational" : "excited-state"} calculation or imported result is available in this project yet. Run or import one, then compare.</p>
        ) : (
          <div className="xspec-form">
            <label className="xspec-field"><span>Calculated or imported source</span>
              <select value={sourceKey} onChange={(event) => setSourceKey(event.currentTarget.value)} data-testid="spectrum-compare-source">
                {sources.map((item) => <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>{sourceTitle(item)}</option>)}
              </select>
            </label>
            <label className="xspec-field"><span>Experimental peak set</span>
              <select value={peakSetId} onChange={(event) => setPeakSetId(event.currentTarget.value)} data-testid="spectrum-compare-peakset">
                {peakSets.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.peak_set?.peak_count ?? 0} peaks</option>)}
              </select>
            </label>
            {!vibrational ? (
              <label className="xspec-field"><span>Comparison axis</span>
                <select value={axis} onChange={(event) => { const next = event.currentTarget.value as "cm^-1" | "eV" | "nm"; setAxis(next); setTolerance(SUGGESTED_TOLERANCE[next]!.value); }} data-testid="spectrum-compare-axis">
                  <option value="eV">eV</option><option value="nm">nm</option><option value="cm^-1">cm⁻¹</option>
                </select>
              </label>
            ) : null}
            <label className="xspec-field"><span>Matching tolerance (±{axisUnitText(axis)})</span>
              <input type="text" inputMode="decimal" value={tolerance} onChange={(event) => setTolerance(event.currentTarget.value)} data-testid="spectrum-compare-tolerance" />
              <small>Suggested starting point: {SUGGESTED_TOLERANCE[axis]!.text}. Matches depend on this gate; sensitivity is reported.</small>
            </label>
            {vibrational ? (
              <fieldset className="xspec-field xspec-scaling">
                <legend>Frequency scaling</legend>
                <label><input type="radio" name="scaling" checked={scalingMode === "UNSCALED"} onChange={() => setScalingMode("UNSCALED")} data-testid="spectrum-compare-unscaled" /> Unscaled (calculated frequencies as computed)</label>
                <label><input type="radio" name="scaling" checked={scalingMode === "USER_FACTOR"} onChange={() => setScalingMode("USER_FACTOR")} data-testid="spectrum-compare-user-scale" /> Apply my factor</label>
                {scalingMode === "USER_FACTOR" ? <input type="text" inputMode="decimal" value={factor} placeholder="e.g. 0.96" onChange={(event) => setFactor(event.currentTarget.value)} data-testid="spectrum-compare-factor" aria-label="Scale factor" /> : null}
                <small>No literature factor is ever applied for you. A factor you enter is stored with the comparison.</small>
              </fieldset>
            ) : null}
            {vibrational ? (
              <label className="xspec-field"><span>Ignore calculated modes weaker than (fraction of the strongest)</span>
                <input type="text" inputMode="decimal" value={minIntensity} onChange={(event) => setMinIntensity(event.currentTarget.value)} data-testid="spectrum-compare-min-intensity" /></label>
            ) : (
              <>
                <label className="xspec-field"><span>Ignore states with oscillator strength below</span>
                  <input type="text" inputMode="decimal" value={minF} onChange={(event) => setMinF(event.currentTarget.value)} data-testid="spectrum-compare-min-f" /></label>
                <div className="xspec-bands">
                  <strong>Bands for an oscillator-strength comparison (wavelength limits, nm)</strong>
                  {bands.map((band, index) => (
                    <div key={index} className="xspec-inline-fields">
                      <input type="text" value={band.lo} placeholder="from" aria-label={`Band ${index + 1} from`} onChange={(event) => setBands(bands.map((b, i) => (i === index ? { ...b, lo: event.currentTarget.value } : b)))} data-testid={`spectrum-band-lo-${index}`} />
                      <input type="text" value={band.hi} placeholder="to" aria-label={`Band ${index + 1} to`} onChange={(event) => setBands(bands.map((b, i) => (i === index ? { ...b, hi: event.currentTarget.value } : b)))} data-testid={`spectrum-band-hi-${index}`} />
                      <button type="button" className="xspec-link-btn" onClick={() => setBands(bands.filter((_, i) => i !== index))}>remove</button>
                    </div>
                  ))}
                  <button type="button" className="import-secondary-btn" onClick={() => setBands([...bands, { lo: "", hi: "" }])} data-testid="spectrum-band-add">Add a band</button>
                </div>
              </>
            )}
            {vibrational && arrays ? <label className="xspec-check"><input type="checkbox" checked={similarity} onChange={(event) => setSimilarity(event.currentTarget.checked)} data-testid="spectrum-compare-similarity" /> Also compute a display-only curve similarity (16 cm⁻¹ Lorentzian, normalised; never a validation score)</label> : null}
            {source ? <p className="xspec-note">{sourceTitle(source)} · {phaseText(source)} · {source.item_count} {vibrational ? "modes" : "states"}{source.has_intensities ? "" : " · no intensities reported"}</p> : null}
            {phaseNotice ? <p className="xspec-phase-notice" data-tone={phaseNotice.tone} role="status" data-testid="spectrum-compare-phase">{phaseNotice.text}</p> : null}
            {error ? <p className="import-error" role="alert" data-testid="spectrum-compare-error">{error}</p> : null}
            <button type="button" className="import-primary-btn" onClick={() => void run()} disabled={busy || !source || (scalingMode === "USER_FACTOR" && parseNumber(factor) === null)} data-testid="spectrum-compare-run">{busy ? "Comparing…" : "Compare"}</button>
          </div>
        )}
        {saved.length ? (
          <div className="xspec-saved" data-testid="spectrum-compare-saved">
            <strong>Saved comparisons</strong>
            <ul>{saved.map((item) => (
              <li key={item.id}><button type="button" className="xspec-link-btn" onClick={() => { setComparison(item); setSelectedMode(null); setSelectedPeak(null); }}>{item.calculated.label} · {scalingText(item)} · ±{item.tolerance} {axisUnitText(item.axis)}</button></li>
            ))}</ul>
          </div>
        ) : null}
      </section>

      {chosenComparison ? (
        <section className="xspec-result" aria-label="Comparison result" data-testid="spectrum-comparison-result">
          <header>
            <h3>Comparison result</h3>
            <span className="xspec-badge" data-tone="derived">DERIVED · COMPARISON TRANSFORM</span>
          </header>
          <p className="xspec-headline" data-testid="spectrum-comparison-headline">{comparisonHeadline(chosenComparison)}</p>
          <p className="xspec-statement" data-testid="spectrum-candidate-statement">{CANDIDATE_ONLY_STATEMENT}</p>
          <ul className="xspec-chips" aria-label="Context">
            <li>{scalingText(chosenComparison)}</li>
            <li>{chosenComparison.calculated.kind === "IMPORTED_RESULT" ? "Imported source" : "ChemDFT calculation"}</li>
            <li>Experimental phase: {chosenComparison.experimental_phase.status === "NOT_SUPPLIED" ? "not supplied" : String(chosenComparison.experimental_phase.value)}</li>
            <li>Axis: {axisUnitText(chosenComparison.axis)}</li>
          </ul>
          {chosenComparison.diagnostics.length ? (
            <ul className="xspec-diagnostics" aria-label="Diagnostics" data-testid="spectrum-comparison-diagnostics">
              {chosenComparison.diagnostics.map((d, i) => <li key={`${d.code}-${i}`} data-tone={d.severity}><strong>{d.code.replaceAll("_", " ").toLowerCase()}</strong> {d.message}</li>)}
            </ul>
          ) : null}

          <ExperimentalSpectrumChart
            traces={trace}
            xLabel={`${dataset.x.definition.label} (${xUnitText(xUnit)})`}
            yLabel={`Relative (${yUnitText(dataset.y.definition.unit.code)}, scaled)`}
            inverted={conventionalInversion(technique, xUnit)}
            peaks={chartPeaks}
            selectedPeak={selectedPeak}
            onSelectPeak={selectPeak}
            sticks={sticks}
            selectedStick={selectedMode}
            onSelectStick={selectMode}
            stickCaption="Calculated sticks show relative strength for orientation only; they are not a measured intensity. Peak markers: green = candidate match, amber = ambiguous, grey = unmatched."
            height={340}
            testIdPrefix="spectrum-compare"
            ariaLabel="Experimental spectrum with calculated candidates"
            description="Experimental spectrum drawn with detected peaks and calculated modes or states."
          />
          {selectedPeak !== null ? <p className="xspec-statement" data-testid="spectrum-peak-statement" role="status">{peakLinkStatement(chosenComparison, selectedPeak)}</p> : null}

          <div className="xspec-metrics" data-testid="spectrum-metrics">
            {metricRows(chosenComparison).map((row) => (
              <div key={row.id} className="xspec-metric" data-testid={`spectrum-metric-${row.id}`}>
                <dt>{row.label}</dt><dd>{row.value}</dd>{row.hint ? <small>{row.hint}</small> : null}
              </div>
            ))}
          </div>
          <p className="xspec-statement xspec-warning-text" data-testid="spectrum-mae-note">{GATED_MAE_STATEMENT}</p>
          <table className="xspec-table" aria-label="Tolerance sensitivity" data-testid="spectrum-sensitivity">
            <thead><tr><th>Tolerance</th><th>Matched</th><th>MAE</th><th>RMSE</th><th>Bias</th></tr></thead>
            <tbody>{chosenComparison.metrics.tolerance_sensitivity.map((row) => (
              <tr key={row.tolerance}><td>±{row.tolerance} {axisUnitText(chosenComparison.axis)}</td><td>{row.matched}</td><td>{row.mae === null ? "—" : row.mae.toFixed(2)}</td><td>{row.rmse === null ? "—" : row.rmse.toFixed(2)}</td><td>{row.signed_bias === null ? "—" : row.signed_bias.toFixed(2)}</td></tr>
            ))}</tbody>
          </table>

          <h4>Candidate pairs (Δ = experimental − calculated)</h4>
          <table className="xspec-table" data-testid="spectrum-delta-table">
            <thead><tr><th>Calculated</th><th>Calculated position</th><th>Experimental peak</th><th>Δ</th><th>Status</th><th>Rel. intensity (calc / exp)</th></tr></thead>
            <tbody>
              {chosenComparison.pairs.map((pair) => (
                <tr key={pair.calculated_index} aria-selected={pair.calculated_index === selectedMode} onClick={() => selectMode(pair.calculated_index)} data-testid={`spectrum-pair-${pair.calculated_index}`} data-status={pair.status}>
                  <td><button type="button" onClick={(event) => { event.stopPropagation(); selectMode(pair.calculated_index); }}>{vibrational ? "Mode" : "State"} {pair.calculated_index + 1}</button></td>
                  <td>{formatPosition(pair.calculated_position, chosenComparison.axis)}{pair.calculated_position !== pair.calculated_position_source && vibrational ? ` (from ${pair.calculated_position_source.toFixed(1)})` : ""}</td>
                  <td>{formatPosition(pair.experimental_position, chosenComparison.axis)}</td>
                  <td>{formatDelta(pair.delta, chosenComparison.axis)}</td>
                  <td><span className="xspec-status" data-status={pair.status}>{pair.status.replace("_", " ")}</span></td>
                  <td>{pair.relative_intensity_calculated === null ? "—" : pair.relative_intensity_calculated.toFixed(2)} / {pair.relative_intensity_experimental === null ? "—" : pair.relative_intensity_experimental.toFixed(2)}</td>
                </tr>
              ))}
              {chosenComparison.pairs.length === 0 ? <tr><td colSpan={6}>No candidate pairs inside the tolerance.</td></tr> : null}
            </tbody>
          </table>
          <div className="xspec-unmatched">
            <div data-testid="spectrum-unmatched-calculated">
              <h4>Unmatched calculated ({chosenComparison.unmatched_calculated.length})</h4>
              <ul>{chosenComparison.unmatched_calculated.map((u) => <li key={u.calculated_index}><button type="button" className="xspec-link-btn" onClick={() => selectMode(u.calculated_index)}>{vibrational ? "mode" : "state"} {u.calculated_index + 1} · {formatPosition(u.calculated_position, chosenComparison.axis)}</button> <span className="xspec-status" data-status={u.status}>UNMATCHED CALCULATED</span></li>)}</ul>
            </div>
            <div data-testid="spectrum-unmatched-experimental">
              <h4>Unmatched experimental ({chosenComparison.unmatched_experimental.length})</h4>
              <ul>{chosenComparison.unmatched_experimental.map((u) => <li key={u.experimental_peak_index}><button type="button" className="xspec-link-btn" onClick={() => selectPeak(u.experimental_peak_index)}>{formatPosition(u.experimental_position, chosenComparison.axis)}</button> <span className="xspec-status" data-status={u.status}>UNMATCHED EXPERIMENTAL</span></li>)}</ul>
            </div>
          </div>

          {chosenComparison.bands.length ? (
            <div data-testid="spectrum-bands">
              <h4>Band oscillator strengths</h4>
              <table className="xspec-table">
                <thead><tr><th>Band (nm)</th><th>f calculated (sum)</th><th>f experimental</th><th>Range with limits moved ±10 %</th><th>Notes</th></tr></thead>
                <tbody>{chosenComparison.bands.map((band) => (
                  <tr key={`${band.lo_nm}-${band.hi_nm}`}>
                    <td>{band.label} · {band.lo_nm}–{band.hi_nm}</td>
                    <td>{band.f_calculated_sum.toPrecision(3)} ({band.calculated_states_in_band.length} states)</td>
                    <td>{band.experimental ? band.experimental.f.toPrecision(3) : "not available"}</td>
                    <td>{band.limit_sensitivity ? `${band.limit_sensitivity.f_min.toPrecision(3)} – ${band.limit_sensitivity.f_max.toPrecision(3)}` : "—"}</td>
                    <td>{band.notes.map((n) => <div key={n.code} data-tone={n.severity}>{n.message}</div>)}</td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="xspec-note">Integrated over a linear wavenumber axis (cm⁻¹) between the limits shown; never over wavelength. A ratio of two such sums is not an agreement score.</p>
            </div>
          ) : null}

          {chosenComparison.similarity ? (
            <div className="xspec-similarity" data-testid="spectrum-similarity">
              <h4>Curve similarity <span className="xspec-badge" data-tone="display">DISPLAY ONLY</span></h4>
              {chosenComparison.similarity.computed ? <p>Pearson r = {chosenComparison.similarity.pearson_r?.toFixed(3)}, cosine = {chosenComparison.similarity.cosine?.toFixed(3)} on {chosenComparison.similarity.grid_points} grid points. {chosenComparison.similarity.note}</p> : <p>Not computed ({chosenComparison.similarity.reason}).</p>}
            </div>
          ) : null}
          <p className="xspec-statement" data-testid="spectrum-intensity-statement">{chosenComparison.intensity_statement}</p>
          <p className="xspec-hash-line">Record {chosenComparison.record_sha256.slice(0, 16)}… · worker {chosenComparison.worker_version}</p>

          {vibrational ? (
            <SpectrumModeLinkViewer
              projectId={projectId}
              source={chosenComparison.calculated}
              comparison={chosenComparison}
              selectedIndex={selectedMode ?? chosenComparison.pairs[0]?.calculated_index ?? 0}
              onSelectIndex={selectMode}
              persistenceKey={persistenceKey}
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
