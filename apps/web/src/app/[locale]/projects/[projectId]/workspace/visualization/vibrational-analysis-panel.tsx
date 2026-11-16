"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CalculationResult, StructureVersionDetail, VibrationalAnalysis } from "@chemdft/schemas";
import { listStructures, listStructureVersions } from "@/lib/structure-workspace-api";
import { vibrationalFrameDetail } from "@/lib/vibrational-mode";
import { ScientificVisualizationPanel } from "./scientific-visualization-panel";

export function VibrationalAnalysisPanel({ projectId, result }: {
  projectId: string;
  result: CalculationResult;
}) {
  const analysis = result.payload as VibrationalAnalysis;
  const storageKey = `chemdft:vibrational:${projectId}:${result.id}`;
  const restored = useRef(false);
  const [displayStateRestored, setDisplayStateRestored] = useState(false);
  const [source, setSource] = useState<StructureVersionDetail | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [modeIndex, setModeIndex] = useState(0);
  const [amplitude, setAmplitude] = useState(0.6);
  const [showArrows, setShowArrows] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [phase, setPhase] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const selectedMode = analysis.modes[modeIndex];
  const frame = useMemo(() => source && selectedMode
    ? vibrationalFrameDetail(source, analysis, modeIndex, phase, amplitude)
    : null, [source, analysis, modeIndex, phase, amplitude, selectedMode]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const structures = await listStructures(projectId);
      const versions = await Promise.all(structures.map((item) => listStructureVersions(projectId, item.id)));
      const found = versions.flat().find((item) => item.version.id === analysis.input_structure_version_id);
      if (!found) throw new Error("The authoritative input StructureVersion is unavailable.");
      if (active) setSource(found);
    })().catch((error: unknown) => {
      if (active) setSourceError(error instanceof Error ? error.message : "Input structure could not be loaded.");
    });
    return () => { active = false; };
  }, [analysis.input_structure_version_id, projectId]);

  useEffect(() => {
    if (restored.current || typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as Partial<{ modeIndex: number; amplitude: number; speed: number }> | null;
        if (saved && Number.isInteger(saved.modeIndex) && saved.modeIndex! >= 0 && saved.modeIndex! < analysis.modes.length) setModeIndex(saved.modeIndex!);
        if (saved && Number.isFinite(saved.amplitude)) setAmplitude(Math.max(0, Math.min(2, saved.amplitude!)));
        if (saved && Number.isFinite(saved.speed)) setSpeed(Math.max(0.25, Math.min(3, saved.speed!)));
      } catch { /* Invalid local display state is safely ignored. */ }
      restored.current = true;
      setDisplayStateRestored(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [analysis.modes.length, storageKey]);

  useEffect(() => {
    if (displayStateRestored && typeof window !== "undefined") window.localStorage.setItem(storageKey, JSON.stringify({ modeIndex, amplitude, speed }));
  }, [amplitude, displayStateRestored, modeIndex, speed, storageKey]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setPhase((value) => value + 0.16 * speed), 1000 / 24);
    return () => window.clearInterval(timer);
  }, [playing, speed]);

  if (sourceError) return <section className="workspace-calculation-summary"><p role="alert">{sourceError}</p></section>;
  const arrows = showArrows && frame && selectedMode ? (() => {
    const vectors = selectedMode.displacement_vectors.map((vector) => vector.map(Number) as [number, number, number]);
    const largest = Math.max(...vectors.map((vector) => Math.hypot(...vector)));
    if (!Number.isFinite(largest) || largest <= 0) return undefined;
    const scale = 1.2 / largest; // longest arrow is drawn 1.2 A long; display scaling only
    return frame.version.coordinates?.atoms.map((atom, index) => ({
      origin: [atom.x, atom.y, atom.z] as const,
      vector: vectors[index]!.map((value) => value * scale) as unknown as [number, number, number],
    }));
  })() : undefined;
  if (!source || !frame) return <section className="workspace-calculation-summary"><p role="status">Loading calculated modes…</p></section>;

  const plot = { left: 86, right: 22, top: 18, bottom: 50, width: 900, height: 245 };
  const rawMin = Math.min(0, ...analysis.modes.map((mode) => mode.frequency_cm1));
  const rawMax = Math.max(0, ...analysis.modes.map((mode) => mode.frequency_cm1));
  const tickStep = Math.max(1, Math.ceil((rawMax - rawMin) / 5 / 1000)) * 1000;
  const minFrequency = Math.floor(rawMin / tickStep) * tickStep;
  const maxFrequency = Math.ceil(rawMax / tickStep) * tickStep || tickStep;
  const plotWidth = plot.width - plot.left - plot.right;
  const plotHeight = plot.height - plot.top - plot.bottom;
  const frequencyX = (frequency: number) => plot.left + (frequency - minFrequency) / (maxFrequency - minFrequency) * plotWidth;

  return <section className="vibrational-analysis" aria-label="Vibrational analysis">
    <header><div><h2>Vibrational modes</h2><p>PySCF {analysis.engine_version} · {analysis.method.toUpperCase()}/{analysis.basis} · signed harmonic frequencies</p></div><strong>{analysis.modes.length} modes</strong></header>
    {analysis.modes.some((mode) => mode.imaginary) ? <p className="vibrational-warning">This geometry is not a confirmed local minimum at the selected method/basis.</p> : null}
    <p className="vibrational-reference">Input StructureVersion {analysis.input_structure_version_id} · Result SHA-256 {analysis.result_sha256}</p>
    <div className="vibrational-controls">
      <button type="button" onClick={() => setModeIndex((modeIndex - 1 + analysis.modes.length) % analysis.modes.length)}>Previous mode</button>
      <button type="button" onClick={() => setPlaying((value) => !value)}>{playing ? "Pause" : "Play mode"}</button>
      <button type="button" onClick={() => setModeIndex((modeIndex + 1) % analysis.modes.length)}>Next mode</button>
      <button type="button" onClick={() => { setPlaying(false); setPhase(0); setCameraKey((value) => value + 1); }}>Reset camera / frame</button>
      <label>Amplitude · Å<input aria-label="Visualization amplitude" type="range" min="0" max="2" step="0.05" value={amplitude} onChange={(event) => setAmplitude(Number(event.currentTarget.value))} /><output>{amplitude.toFixed(2)} Å maximum atom displacement</output></label>
      <label><input type="checkbox" aria-label="Show displacement arrows" checked={showArrows} onChange={(event) => setShowArrows(event.currentTarget.checked)} /> Displacement arrows</label>
      {showArrows ? <span className="vibrational-hint" data-testid="arrow-scale-note">Arrows show the stored mode vector direction and relative size per atom; lengths are scaled for display (longest = 1.2 Å), not physical amplitudes.</span> : null}
      <label>Playback speed<input aria-label="Animation speed" type="range" min="0.25" max="3" step="0.25" value={speed} onChange={(event) => setSpeed(Number(event.currentTarget.value))} /><output>{speed.toFixed(2)}×</output></label>
    </div>
    <div className="vibrational-view"><ScientificVisualizationPanel key={cameraKey} arrows={arrows} detail={frame} selectedAtomIndex={null} measurementKind="none" measurementAtomIndices={[]} onSelectAtom={() => undefined} onMeasurementKindChange={() => undefined} onSceneReady={() => undefined} persistenceKey={`${storageKey}:visualization`} /></div>
    <div className="vibrational-frequency"><h3>Calculated vibrational frequencies</h3><p>Mode positions only; this calculation did not produce IR intensities or Raman activities.</p>
    <svg className="vibrational-frequency-plot" viewBox={`0 0 ${plot.width} ${plot.height}`} role="img" aria-labelledby="vibrational-frequency-title vibrational-frequency-description">
      <title id="vibrational-frequency-title">Calculated vibrational frequencies</title>
      <desc id="vibrational-frequency-description">Signed harmonic frequency in inverse centimeters for each normal mode. Select a marker to view its displacement.</desc>
      {Array.from({ length: Math.floor((maxFrequency - minFrequency) / tickStep) + 1 }, (_, index) => {
        const value = minFrequency + index * tickStep;
        const x = frequencyX(value);
        return <g key={value}><line x1={x} x2={x} y1={plot.top} y2={plot.height - plot.bottom} /><text x={x} y={plot.height - plot.bottom + 20} textAnchor="middle">{value}</text></g>;
      })}
      {analysis.modes.map((mode, index) => {
        const y = plot.top + (index + 1) * plotHeight / (analysis.modes.length + 1);
        const selected = index === modeIndex;
        const marker = mode.imaginary ? "#c86a2b" : selected ? "#25785d" : "#54728e";
        return <g key={mode.index} className="vibrational-frequency-marker" role="button" tabIndex={0} aria-label={`Mode ${mode.index + 1}, ${mode.frequency_cm1.toFixed(2)} inverse centimeters${mode.imaginary ? ", imaginary" : ""}`} aria-pressed={selected} onClick={() => setModeIndex(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setModeIndex(index); } }}>
          <text x={plot.left - 12} y={y + 4} textAnchor="end">Mode {mode.index + 1}</text>
          <line className="vibrational-frequency-guide" x1={plot.left} x2={plot.width - plot.right} y1={y} y2={y} />
          <circle cx={frequencyX(mode.frequency_cm1)} cy={y} r={selected ? 8 : 6} fill={marker} />
          <text className="vibrational-frequency-value" x={frequencyX(mode.frequency_cm1) + 12} y={y + 4}>{mode.imaginary ? `−${Math.abs(mode.frequency_cm1).toFixed(0)}i` : mode.frequency_cm1.toFixed(0)}</text>
        </g>;
      })}
      <line className="vibrational-frequency-axis" x1={plot.left} x2={plot.width - plot.right} y1={plot.height - plot.bottom} y2={plot.height - plot.bottom} />
      <text className="vibrational-frequency-axis-label" x={(plot.left + plot.width - plot.right) / 2} y={plot.height - 8} textAnchor="middle">Frequency / cm⁻¹</text>
    </svg>
    <table><thead><tr><th>Mode</th><th>Frequency / cm⁻¹</th><th>State</th><th>Reduced mass / amu</th></tr></thead><tbody>
      {analysis.modes.map((mode, index) => <tr key={mode.index} aria-selected={index === modeIndex}>
        <td><button type="button" onClick={() => setModeIndex(index)}>Mode {mode.index + 1}</button></td>
        <td>{mode.imaginary ? `−${Math.abs(mode.frequency_cm1).toFixed(2)}` : mode.frequency_cm1.toFixed(2)}</td>
        <td>{mode.imaginary ? <strong>IMAGINARY</strong> : "Real"}</td>
        <td>{mode.reduced_mass_amu?.toFixed(4) ?? "—"}</td>
      </tr>)}
    </tbody></table></div>
    <details><summary>Calculation provenance</summary><dl>
      <div><dt>Calculation</dt><dd>{analysis.calculation_id}</dd></div><div><dt>Input StructureVersion</dt><dd>{analysis.input_structure_version_id}</dd></div>
      <div><dt>Structure hash</dt><dd>{analysis.input_structure_hash}</dd></div><div><dt>Specification hash</dt><dd>{analysis.calculation_specification_hash}</dd></div>
      <div><dt>Hessian artifact</dt><dd>{analysis.hessian_artifact.artifact_id} · {analysis.hessian_sha256}</dd></div>
      <div><dt>Units / vector convention</dt><dd>{analysis.hessian_unit} · {analysis.frequency_unit} · {analysis.vector_convention} ({analysis.vector_unit})</dd></div>
      <div><dt>Parser / adapter</dt><dd>{analysis.parser_version} / {analysis.adapter_version}</dd></div><div><dt>Immutable result hash</dt><dd>{analysis.result_sha256}</dd></div>
    </dl></details>
  </section>;
}
