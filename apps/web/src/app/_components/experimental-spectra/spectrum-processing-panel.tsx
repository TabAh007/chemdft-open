"use client";

import { useMemo, useState } from "react";
import type { SpectrumDatasetView, SpectrumPeakParameters, SpectrumTransformInput } from "@chemdft/schemas";
import { createSpectrumPeaks, createSpectrumTransform } from "@/lib/experimental-spectra-api";
import { opLabel, parseNumber, suggestBaseline, suggestSmoothing, xUnitText } from "@/lib/experimental-spectra";

type Params = NonNullable<SpectrumTransformInput["parameters"]>;
const BASELINES = [
  { id: "baseline.arpls", label: "arPLS (asymmetric reweighted penalized least squares)", help: "Stiffness length: how smooth the baseline is, in the unit of the x axis. Larger = stiffer." },
  { id: "baseline.snip", label: "SNIP (statistics-sensitive clipping)", help: "Half-window: the widest feature that is clipped away, in the unit of the x axis." },
  { id: "baseline.imodpoly", label: "Modified polynomial", help: "Polynomial order. Cannot follow a wiggly baseline and may flare at the edges." },
  { id: "baseline.offset", label: "Constant offset", help: "Subtract one constant: a percentile of the signal (0 = the minimum) or a value you enter." },
] as const;

/**
 * Every control here is an explicit request. Nothing is applied automatically, no method is the default, and a result is always a NEW
 * version that keeps its parameters, library versions and hashes. Pre-filled numbers are starting points taken from the data.
 */
export function SpectrumProcessingPanel({
  projectId,
  dataset,
  peakWidths,
  onCreated,
  sections = ["baseline", "smooth", "normalize", "other", "peaks"],
}: {
  projectId: string;
  dataset: SpectrumDatasetView;
  /** Detected peaks of this version (if any), used only to suggest starting parameters. */
  peakWidths: NonNullable<SpectrumDatasetView["peak_set"]>["peaks"] | null;
  onCreated: (created: SpectrumDatasetView) => void;
  sections?: Array<"baseline" | "smooth" | "normalize" | "other" | "peaks">;
}) {
  const show = (name: "baseline" | "smooth" | "normalize" | "other" | "peaks") => sections.includes(name);
  const suggestions = useMemo(() => suggestBaseline(dataset, peakWidths), [dataset, peakWidths]);
  const smoothSuggestion = useMemo(() => suggestSmoothing(dataset, peakWidths), [dataset, peakWidths]);
  const step = ((dataset.x_max ?? 1) - (dataset.x_min ?? 0)) / Math.max(dataset.point_count - 1, 1);
  const unit = xUnitText(dataset.x.definition.unit.code);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baselineMethod, setBaselineMethod] = useState<string>("");
  const [baselineValue, setBaselineValue] = useState("");
  const [offsetMode, setOffsetMode] = useState<"percentile" | "value">("percentile");
  const [smoothWindow, setSmoothWindow] = useState("");
  const [polyorder, setPolyorder] = useState("3");
  const [edgeMode, setEdgeMode] = useState("interp");
  const [normalizeRange, setNormalizeRange] = useState({ lo: "", hi: "" });
  const [crop, setCrop] = useState({ lo: "", hi: "" });
  const [resampleStep, setResampleStep] = useState("");
  const [sigma, setSigma] = useState("8");
  const [minDistance, setMinDistance] = useState("");
  const [polarity, setPolarity] = useState("");

  const isTransmittance = dataset.y.quantity === "TRANSMITTANCE";
  const windowValue = parseNumber(smoothWindow);
  const windowPoints = windowValue && step > 0 ? Math.max(Math.round(windowValue / step), 3) : null;
  const oddWindow = windowPoints === null ? null : windowPoints % 2 === 1 ? windowPoints : windowPoints + 1;
  const order = parseNumber(polyorder);
  const smoothProblem = windowValue === null ? "Enter a window width." : order === null || !Number.isInteger(order) || order < 1 ? "The polynomial order must be a whole number ≥ 1." : oddWindow !== null && oddWindow <= order ? `A window of ${oddWindow} points is too short for polynomial order ${order}; widen the window or lower the order.` : null;

  async function run(label: string, action: () => Promise<SpectrumDatasetView>) {
    setBusy(label); setError(null);
    try {
      const created = await action();
      window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
      onCreated(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The operation could not be completed.");
    } finally {
      setBusy(null);
    }
  }
  const transform = (input: Omit<SpectrumTransformInput, "idempotency_key">, label: string) => run(label, () => createSpectrumTransform({ projectId, datasetId: dataset.id, input }));

  function baselineParams(): Params | null {
    const value = parseNumber(baselineValue);
    if (baselineMethod === "baseline.arpls") return value && value > 0 ? { stiffness_length_x: value } : null;
    if (baselineMethod === "baseline.snip") return value && value > 0 ? { half_window_x: value } : null;
    if (baselineMethod === "baseline.imodpoly") return value !== null && Number.isInteger(value) && value >= 1 && value <= 10 ? { poly_order: value } : null;
    if (baselineMethod === "baseline.offset") {
      if (value === null) return null;
      return offsetMode === "percentile" ? (value >= 0 && value <= 100 ? { percentile: value } : null) : { value };
    }
    return null;
  }
  const baselineReady = baselineParams() !== null;
  const selectedBaseline = BASELINES.find((item) => item.id === baselineMethod);
  const suggestion = baselineMethod === "baseline.arpls" ? suggestions.arpls : baselineMethod === "baseline.snip" ? suggestions.snip : null;

  function peakParameters(): SpectrumPeakParameters | null {
    const s = parseNumber(sigma);
    if (s === null || s <= 0) return null;
    const out: SpectrumPeakParameters = { prominence_sigma: s };
    const distance = parseNumber(minDistance);
    if (minDistance.trim() && (distance === null || distance <= 0)) return null;
    if (distance) out.min_distance_x = distance;
    if (polarity) out.polarity = polarity as NonNullable<SpectrumPeakParameters["polarity"]>;
    return out;
  }

  return (
    <div className="xspec-processing" data-testid="spectrum-processing-panel">
      <p className="xspec-note">Each action below creates a <strong>new version</strong> from <strong>{dataset.name}</strong>. The version you are working from is never changed, and nothing is applied until you press a button.</p>
      {error ? <p className="import-error" role="alert" data-testid="spectrum-processing-error">{error}</p> : null}

      {show("baseline") ? <details className="xspec-section" open>
        <summary>Baseline correction</summary>
        <div className="xspec-form">
          <label className="xspec-field"><span>Method</span>
            <select value={baselineMethod} onChange={(event) => { setBaselineMethod(event.currentTarget.value); setBaselineValue(""); }} data-testid="proc-baseline-method">
              <option value="">Choose a method… (none is applied by default)</option>
              {BASELINES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          {selectedBaseline ? (
            <>
              <p className="xspec-note">{selectedBaseline.help}</p>
              {baselineMethod === "baseline.offset" ? (
                <label className="xspec-field"><span>Offset given as</span>
                  <select value={offsetMode} onChange={(event) => setOffsetMode(event.currentTarget.value as "percentile" | "value")} data-testid="proc-offset-mode">
                    <option value="percentile">percentile of the signal (0–100)</option>
                    <option value="value">a value in signal units</option>
                  </select>
                </label>
              ) : null}
              <label className="xspec-field"><span>{baselineMethod === "baseline.arpls" ? `Stiffness length (${unit})` : baselineMethod === "baseline.snip" ? `Half-window (${unit})` : baselineMethod === "baseline.imodpoly" ? "Polynomial order (1–10)" : offsetMode === "percentile" ? "Percentile" : "Value"}</span>
                <input type="text" inputMode="decimal" value={baselineValue} onChange={(event) => setBaselineValue(event.currentTarget.value)} data-testid="proc-baseline-value" />
              </label>
              {suggestion ? <p className="xspec-suggestion-line">Starting point from this spectrum: <button type="button" className="xspec-link-btn" onClick={() => setBaselineValue(String(suggestion.value))} data-testid="proc-baseline-use-suggestion">use {suggestion.value} {unit}</button> — {suggestion.basis}. Parameter choice matters more than method; inspect the result.</p> : null}
              {baselineMethod === "baseline.imodpoly" ? <p className="xspec-suggestion-line">A polynomial order of 3–5 is a common starting point; check the edges.</p> : null}
            </>
          ) : null}
          <button type="button" className="import-primary-btn" disabled={!baselineReady || busy !== null} onClick={() => { const params = baselineParams(); if (params) void transform({ op: baselineMethod as SpectrumTransformInput["op"], parameters: params }, "baseline"); }} data-testid="proc-baseline-create">
            {busy === "baseline" ? "Creating…" : "Create baseline-corrected version"}
          </button>
        </div>
      </details> : null}

      {show("smooth") ? <details className="xspec-section">
        <summary>Smoothing (Savitzky–Golay)</summary>
        <div className="xspec-form">
          <label className="xspec-field"><span>Window width ({unit})</span>
            <input type="text" inputMode="decimal" value={smoothWindow} onChange={(event) => setSmoothWindow(event.currentTarget.value)} data-testid="proc-smooth-window" />
          </label>
          <label className="xspec-field"><span>Polynomial order</span>
            <input type="text" inputMode="numeric" value={polyorder} onChange={(event) => setPolyorder(event.currentTarget.value)} data-testid="proc-smooth-order" />
          </label>
          <label className="xspec-field"><span>Edge handling</span>
            <select value={edgeMode} onChange={(event) => setEdgeMode(event.currentTarget.value)} data-testid="proc-smooth-mode">
              {["interp", "mirror", "nearest", "wrap", "constant"].map((mode) => <option key={mode} value={mode}>{mode}{mode === "interp" ? " (recommended)" : ""}</option>)}
            </select>
          </label>
          <p className="xspec-suggestion-line">Starting point: <button type="button" className="xspec-link-btn" onClick={() => setSmoothWindow(String(smoothSuggestion.value))} data-testid="proc-smooth-use-suggestion">use {smoothSuggestion.value} {unit}</button> — {smoothSuggestion.basis}. The window is rounded up to an odd number of points{oddWindow ? ` (now ${oddWindow} points)` : ""}.</p>
          {smoothProblem && smoothWindow ? <p className="import-error" role="status" data-testid="proc-smooth-problem">{smoothProblem}</p> : null}
          <p className="xspec-note">If the window is large compared with the narrowest band, the result will warn how much peak height it removes. Smoothing never replaces the data it was made from.</p>
          <button type="button" className="import-primary-btn" disabled={smoothProblem !== null || busy !== null} onClick={() => void transform({ op: "smooth.savgol", parameters: { window_x: windowValue!, polyorder: order!, mode: edgeMode as NonNullable<Params["mode"]> } }, "smooth")} data-testid="proc-smooth-create">
            {busy === "smooth" ? "Creating…" : "Create smoothed version"}
          </button>
        </div>
      </details> : null}

      {show("normalize") ? <details className="xspec-section">
        <summary>Normalization</summary>
        <div className="xspec-form">
          <p className="xspec-note">A normalized version is a <strong>relative</strong> representation. It is never treated as a measured intensity, and the original units stay with the version it came from.</p>
          <div className="xspec-button-row">
            <button type="button" className="import-secondary-btn" disabled={busy !== null} onClick={() => void transform({ op: "normalize.max", parameters: { target: 1 } }, "normalize")} data-testid="proc-normalize-max-1">Maximum = 1</button>
            <button type="button" className="import-secondary-btn" disabled={busy !== null} onClick={() => void transform({ op: "normalize.max", parameters: { target: 100 } }, "normalize")} data-testid="proc-normalize-max-100">Maximum = 100</button>
          </div>
          <div className="xspec-inline-fields">
            <label className="xspec-field"><span>Area between ({unit})</span><input type="text" value={normalizeRange.lo} onChange={(event) => setNormalizeRange({ ...normalizeRange, lo: event.currentTarget.value })} placeholder="from" data-testid="proc-area-lo" /></label>
            <label className="xspec-field"><span>and</span><input type="text" value={normalizeRange.hi} onChange={(event) => setNormalizeRange({ ...normalizeRange, hi: event.currentTarget.value })} placeholder="to" data-testid="proc-area-hi" /></label>
            <button type="button" className="import-secondary-btn" disabled={busy !== null || parseNumber(normalizeRange.lo) === null || parseNumber(normalizeRange.hi) === null} onClick={() => void transform({ op: "normalize.area", parameters: { x_range: [parseNumber(normalizeRange.lo)!, parseNumber(normalizeRange.hi)!], target: 1 } }, "normalize")} data-testid="proc-normalize-area">Area = 1</button>
          </div>
        </div>
      </details> : null}

      {show("other") ? <details className="xspec-section">
        <summary>Crop, resample{isTransmittance ? ", transmittance → absorbance" : ""}</summary>
        <div className="xspec-form">
          <div className="xspec-inline-fields">
            <label className="xspec-field"><span>Keep {unit} from</span><input type="text" value={crop.lo} onChange={(event) => setCrop({ ...crop, lo: event.currentTarget.value })} data-testid="proc-crop-lo" /></label>
            <label className="xspec-field"><span>to</span><input type="text" value={crop.hi} onChange={(event) => setCrop({ ...crop, hi: event.currentTarget.value })} data-testid="proc-crop-hi" /></label>
            <button type="button" className="import-secondary-btn" disabled={busy !== null || parseNumber(crop.lo) === null || parseNumber(crop.hi) === null} onClick={() => void transform({ op: "crop", parameters: { x_min: parseNumber(crop.lo)!, x_max: parseNumber(crop.hi)! } }, "crop")} data-testid="proc-crop-create">Crop</button>
          </div>
          <div className="xspec-inline-fields">
            <label className="xspec-field"><span>Resample to a regular step ({unit})</span><input type="text" value={resampleStep} onChange={(event) => setResampleStep(event.currentTarget.value)} data-testid="proc-resample-step" /></label>
            <button type="button" className="import-secondary-btn" disabled={busy !== null || (parseNumber(resampleStep) ?? 0) <= 0} onClick={() => void transform({ op: "resample.linear", parameters: { step: parseNumber(resampleStep)! } }, "resample")} data-testid="proc-resample-create">Resample (linear, no extrapolation)</button>
          </div>
          {isTransmittance ? (
            <div>
              <p className="xspec-note">Transmittance is kept as measured. Converting to absorbance (A = −log₁₀ T) happens only when you ask for it here.</p>
              <button type="button" className="import-secondary-btn" disabled={busy !== null} onClick={() => void transform({ op: "convert.absorbance_from_transmittance", parameters: {} }, "convert")} data-testid="proc-convert-absorbance">Create absorbance version</button>
            </div>
          ) : null}
        </div>
      </details> : null}

      {show("peaks") ? <details className="xspec-section" open>
        <summary>Peak detection</summary>
        <div className="xspec-form">
          <p className="xspec-note">Deterministic peak picking (SciPy <code>find_peaks</code>). The peak set is <strong>derived output, not raw data</strong>; it keeps its parameters and the library versions.</p>
          <label className="xspec-field"><span>Minimum prominence (× noise estimate)</span><input type="text" inputMode="decimal" value={sigma} onChange={(event) => setSigma(event.currentTarget.value)} data-testid="proc-peaks-sigma" /></label>
          <label className="xspec-field"><span>Minimum distance between peaks ({unit}, optional)</span><input type="text" inputMode="decimal" value={minDistance} onChange={(event) => setMinDistance(event.currentTarget.value)} data-testid="proc-peaks-distance" /></label>
          <label className="xspec-field"><span>Feature direction</span>
            <select value={polarity} onChange={(event) => setPolarity(event.currentTarget.value)} data-testid="proc-peaks-polarity">
              <option value="">{isTransmittance ? "automatic: minima (transmittance dips)" : "automatic: maxima"}</option>
              <option value="maxima">maxima</option>
              <option value="minima">minima</option>
            </select>
          </label>
          <button type="button" className="import-primary-btn" disabled={peakParameters() === null || busy !== null} onClick={() => { const parameters = peakParameters(); if (parameters) void run("peaks", () => createSpectrumPeaks({ projectId, datasetId: dataset.id, parameters })); }} data-testid="proc-peaks-create">
            {busy === "peaks" ? "Detecting…" : `Detect peaks on ${opLabel(dataset.transform?.op ?? "raw").toLowerCase() === "raw" ? "this spectrum" : "this version"}`}
          </button>
        </div>
      </details> : null}
    </div>
  );
}
