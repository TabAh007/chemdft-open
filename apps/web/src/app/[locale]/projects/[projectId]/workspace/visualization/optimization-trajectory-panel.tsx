"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

import { inferVisualBonds, type VisualizationState } from "@chemdft/scientific-scene";
import type { CalculationDetail, OptimizationResult, OptimizationStep, StructureVersionDetail } from "@chemdft/schemas";

import { listStructures, listStructureVersions } from "@/lib/structure-workspace-api";
import { energyUnitLabel, formatEnergyEh, formatGradient, formatLocalTime, fullValueTitle } from "@/lib/quantity-format";
import { ViewerToolbar, ViewerCaption } from "@/app/_components/viewer-toolbar";
import { optimizationSeparationWarnings, optimizationSeries, sceneForOptimizationStep } from "@/lib/optimization-trajectory";

const StructureViewport = dynamic(() => import("./structure-viewport").then((m) => m.StructureViewport), {
  ssr: false,
  loading: () => <div className="viewport-fallback">Loading trajectory viewer…</div>,
});

type Chart = {
  setOption: (option: unknown) => void;
  on: (event: string, handler: (params: { dataIndex?: number }) => void) => void;
  resize: () => void;
  dispose: () => void;
};
type EChartsModule = { init: (element: HTMLElement) => Chart };
const EMPTY_STEPS: OptimizationStep[] = [];

export function OptimizationTrajectoryPanel({ projectId, detail, onOpenFinal }: {
  projectId: string;
  detail: CalculationDetail;
  onOpenFinal: (version: StructureVersionDetail) => void;
}) {
  const trajectory = detail.optimization_trajectory;
  const native = detail.specification.engine_preference.engine === "xtb";
  const result = detail.result?.result_type === "chemdft.optimization" ? detail.result.payload as OptimizationResult : null;
  const recordLabel = native ? "evaluation" : "step";
  const steps = trajectory?.steps ?? EMPTY_STEPS;
  const inputVersionId = trajectory?.input_structure_version_id;
  const [source, setSource] = useState<StructureVersionDetail | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [followLatest, setFollowLatest] = useState(true);
  const [cameraKey, setCameraKey] = useState(0);
  // The real revision of the published final structure, read from the record (never guessed); hidden until it is read.
  const [finalRevision, setFinalRevision] = useState<number | null>(null);
  const [representation, setRepresentation] = useState<VisualizationState["representation"]>("ball-stick");
  const restoredStepKeyRef = useRef<string | null>(null);
  const energyRef = useRef<HTMLDivElement>(null);
  const gradientRef = useRef<HTMLDivElement>(null);
  const terminal = ["SUCCEEDED", "FAILED", "CANCELED"].includes(detail.calculation.state);
  useEffect(() => {
    if (terminal) window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
  }, [terminal, detail.calculation.id]);
  const stepStorageKey = trajectory ? `chemdft:trajectory-step:${projectId}:${trajectory.id}` : null;

  useEffect(() => {
    if (!stepStorageKey || !steps.length || typeof window === "undefined" ||
      restoredStepKeyRef.current === stepStorageKey) return;
    restoredStepKeyRef.current = stepStorageKey;
    queueMicrotask(() => {
      const stored = window.localStorage.getItem(stepStorageKey);
      const saved = Number(stored);
      if (stored !== null && Number.isInteger(saved) && saved >= 0 && saved < steps.length) {
        setIndex(saved);
        setFollowLatest(false);
      }
    });
  // Restore once for each trajectory; later server updates should not replace the user's frame.
  }, [stepStorageKey, steps.length]);

  useEffect(() => {
    if (!inputVersionId) return;
    let active = true;
    void (async () => {
      const structures = await listStructures(projectId);
      const versionLists = await Promise.all(structures.map((structure) => listStructureVersions(projectId, structure.id)));
      const found = versionLists.flat().find((item) => item.version.id === inputVersionId);
      if (!found) throw new Error("The authoritative input StructureVersion is unavailable.");
      if (active) setSource(found);
    })().catch((error: unknown) => {
      if (active) setSourceError(error instanceof Error ? error.message : "Input structure could not be loaded.");
    });
    return () => { active = false; };
  }, [projectId, inputVersionId]);

  const finalVersionId = trajectory?.final_structure_version_id ?? null;
  const sourceStructureId = source?.structure.id;
  useEffect(() => {
    if (!finalVersionId || !sourceStructureId) return;
    let active = true;
    void listStructureVersions(projectId, sourceStructureId)
      .then((versions) => { const found = versions.find((item) => item.version.id === finalVersionId); if (active && found) setFinalRevision(found.version.revision); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [projectId, finalVersionId, sourceStructureId]);

  useEffect(() => {
    if (!playing || steps.length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => current >= steps.length - 1 ? 0 : current + 1);
    }, 950);
    return () => window.clearInterval(timer);
  }, [playing, steps.length]);

  const currentIndex = followLatest ? Math.max(0, steps.length - 1) : Math.min(index, Math.max(0, steps.length - 1));
  const selected = steps[currentIndex];
  const scene = useMemo(() => source && selected ? sceneForOptimizationStep(source, selected) : null, [source, selected]);

  useEffect(() => {
    if (stepStorageKey && !followLatest && steps.length) window.localStorage.setItem(stepStorageKey, String(currentIndex));
  }, [currentIndex, followLatest, stepStorageKey, steps.length]);

  useEffect(() => {
    if (!trajectory || !selected) return;
    window.dispatchEvent(new CustomEvent("chemdft:workspace-selection", {
      detail: { projectId, calculationId: detail.calculation.id, resultId: detail.result?.id, currentView: `Optimization trajectory · ${recordLabel} ${selected.index + 1} / ${steps.length}` },
    }));
  }, [projectId, trajectory, selected, steps.length, detail.calculation.id, detail.result?.id, recordLabel]);

  useEffect(() => {
    if (!energyRef.current || !gradientRef.current || !steps.length) return;
    let disposed = false;
    let charts: Chart[] = [];
    void (async () => {
      const echarts = await import("echarts") as unknown as EChartsModule;
      if (disposed || !energyRef.current || !gradientRef.current) return;
      charts = [echarts.init(energyRef.current), echarts.init(gradientRef.current)];
      const selectedIndex = currentIndex;
      const finalIndex = trajectory?.state === "CONVERGED" ? steps.length - 1 : -1;
      const series = optimizationSeries(steps);
      const chartOptions = (values: number[], color: string, unit: string, tickFormat: (value: number) => string) => ({
        animation: false,
        backgroundColor: "transparent",
        grid: { left: 74, right: 16, top: 16, bottom: 32, containLabel: false },
        tooltip: { trigger: "item", valueFormatter: (value: number) => `${value} ${unit}` },
        xAxis: { type: "value", name: native ? "Evaluation" : "Step", min: 1, max: Math.max(2, steps.length), interval: 1,
          axisLine: { lineStyle: { color: "#8294a3" } }, splitLine: { show: false } },
        yAxis: { type: "value", scale: true, axisLabel: { formatter: tickFormat, hideOverlap: true },
          axisLine: { lineStyle: { color: "#8294a3" } },
          splitLine: { lineStyle: { color: "#dce4e9", type: "dashed" } } },
        series: [{ type: "line", showSymbol: true, symbol: "circle", lineStyle: { width: 1.5, color },
          itemStyle: { color }, symbolSize: (_value: unknown, params: { dataIndex: number }) =>
            params.dataIndex === selectedIndex ? 11 : params.dataIndex === finalIndex ? 9 : 5,
          data: values.map((value, position) => [position + 1, value]),
          markLine: { silent: true, symbol: "none", lineStyle: { color: "#172f42", width: 2, type: "dashed" },
            data: [{ xAxis: selectedIndex + 1 }] },
          markPoint: finalIndex >= 0 ? { symbol: "diamond", symbolSize: 12,
            data: [{ coord: [finalIndex + 1, values[finalIndex]], name: "Converged" }] } : undefined,
        }],
      });
      charts[0]!.setOption(chartOptions(series.energy.map((point) => point[1]), "#1d6084", "Eh", (value: number) => value.toFixed(6)));
      charts[1]!.setOption(chartOptions(series.gradient.map((point) => point[1]), "#a55f31", "Eh/bohr", (value: number) => value.toExponential(1)));
      for (const chart of charts) chart.on("click", (params) => {
        if (typeof params.dataIndex === "number") { setFollowLatest(false); setPlaying(false); setIndex(params.dataIndex); }
      });
      const resize = () => charts.forEach((chart) => chart.resize());
      window.addEventListener("resize", resize);
      // The chart instance owns its resize listener and is disposed on the next effect run.
      (charts as Chart[] & { cleanup?: () => void }).cleanup = () => window.removeEventListener("resize", resize);
    })();
    return () => {
      disposed = true;
      (charts as Chart[] & { cleanup?: () => void }).cleanup?.();
      charts.forEach((chart) => chart.dispose());
    };
  }, [currentIndex, steps, trajectory?.state, native]);

  if (!trajectory) return null;
  const select = (next: number) => {
    setFollowLatest(false);
    setPlaying(false);
    setIndex(Math.max(0, Math.min(steps.length - 1, next)));
  };
  const finalAvailable = trajectory.final_structure_version_id && source;
  const separationWarnings = source && result && steps.length
    ? optimizationSeparationWarnings(source, steps[steps.length - 1]!) : [];

  return <section className="optimization-player" aria-label="Optimization trajectory">
    <div className="optimization-head">
      <div><h2>Optimization trajectory</h2><p>{native ? "GFN2-xTB + native ANCopt" : "PySCF + geomeTRIC"} · real engine evaluations · Cartesian Å</p></div>
      <strong data-state={trajectory.state}>Run: {trajectory.state.replaceAll("_", " ")}</strong>
    </div>
    <div className="optimization-progress" role="status">
      <span>{steps.length ? `Viewing ${recordLabel} ${currentIndex + 1} / ${steps.length}` : trajectory.state === "QUEUED" ? "Waiting for scientific worker" : "Waiting for first engine step"}</span>
      {trajectory.state === "CONVERGED" && currentIndex === steps.length - 1 ? <strong className="optimization-endpoint">CONVERGED ENDPOINT</strong> : null}
      {steps.length && !terminal ? <span>{trajectory.state === "QUEUED" ? "Run queued" : "Run in progress"}</span> : null}
      {selected ? <span title={fullValueTitle(selected.energy_hartree)}>Total energy {formatEnergyEh(selected.energy_hartree)} Eh</span> : null}
      {selected ? <span title={fullValueTitle(selected.gradient_norm_hartree_per_bohr)}>Gradient {formatGradient(selected.gradient_norm_hartree_per_bohr)} Eh/bohr</span> : null}
    </div>
    {sourceError ? <p role="alert">{sourceError}</p> : null}
    {scene ? <div className="optimization-viewport">
      <StructureViewport
        key={cameraKey}
        scene={scene}
        visualBonds={inferVisualBonds(scene)}
        representation={representation}
        cameraStorageKey={`chemdft:trajectory-camera:${projectId}:${trajectory.id}`}
      />
    </div> : <div className="optimization-viewport-empty">{steps.length ? "Validating geometry for display…" : "The first calculated geometry will appear here."}</div>}
    <div className="optimization-controls" aria-label="Trajectory controls">
      <button type="button" onClick={() => select(0)} disabled={!steps.length} aria-label="First step">|◀</button>
      <button type="button" onClick={() => select(currentIndex - 1)} disabled={currentIndex <= 0} aria-label="Previous step">◀</button>
      <button type="button" onClick={() => { setFollowLatest(false); setIndex(currentIndex); setPlaying(!playing); }} disabled={steps.length < 2} aria-label={playing ? "Pause" : "Play"}>{playing ? "Pause" : "Play"}</button>
      <button type="button" onClick={() => select(currentIndex + 1)} disabled={currentIndex >= steps.length - 1} aria-label="Next step">▶</button>
      <button type="button" onClick={() => select(steps.length - 1)} disabled={!steps.length} aria-label="Final available step">▶|</button>
      <input type="range" min={0} max={Math.max(0, steps.length - 1)} value={currentIndex}
        disabled={!steps.length} aria-label="Optimization step" onChange={(event) => select(Number(event.target.value))} />
      <span>{steps.length ? `${currentIndex + 1} / ${steps.length}` : "0 / 0"}</span>
    </div>
    <ViewerToolbar
      testIdPrefix="optimization"
      style={representation}
      styleOptions={[{ value: "ball-stick", label: "Ball and stick" }, { value: "sticks", label: "Sticks" }, { value: "wireframe", label: "Wireframe" }, { value: "space-fill", label: "Space filling" }]}
      onStyleChange={(value) => setRepresentation(value as VisualizationState["representation"])}
      onReset={() => {
        try { if (trajectory) localStorage.removeItem(`chemdft:trajectory-camera:${projectId}:${trajectory.id}`); } catch { /* optional */ }
        setCameraKey((current) => current + 1);
      }}
    />
    <ViewerCaption testId="optimization-viewer-caption">
      {selected ? <>
        {`Steps through the ${steps.length} geometries the optimizer visited. `}
        {selected.evaluation_kind === "FINAL_SINGLE_POINT" ? "Showing the final single-point evaluation (not an optimizer iteration)." : `Showing optimizer evaluation ${selected.engine_cycle ?? selected.index + 1}`}
        {selected.timestamp ? <>{" · "}<time dateTime={selected.timestamp} title={`UTC ${formatLocalTime(selected.timestamp).utc}`}>{formatLocalTime(selected.timestamp).text}</time></> : null}
      </> : "The first calculated geometry will appear here."}
    </ViewerCaption>
    {steps.length ? <div className="optimization-charts">
      <div><h3>Total energy <span>(Eh)</span></h3><div ref={energyRef} role="img" aria-label="Total energy by recorded evaluation" /></div>
      <div><h3>Gradient norm <span>(Eh/bohr)</span></h3><div ref={gradientRef} role="img" aria-label="Gradient norm by optimization step" /></div>
    </div> : null}
    {result ? <div className="optimization-summary-card" data-testid="optimization-result-summary" data-calculation-id={detail.calculation.id} data-result-id={detail.result!.id}>
      <dl className="optimization-summary-grid">
        <div><dt>Final total energy</dt><dd><strong title={fullValueTitle(result.final_energy.value)}>{formatEnergyEh(Number(result.final_energy.value))} {energyUnitLabel(result.final_energy.unit.code)}</strong></dd></div>
        {result.optimization_iterations != null ? <div><dt>Optimizer iterations</dt><dd>{result.optimization_iterations} · {steps.length} recorded evaluations (includes final single-point)</dd></div> : null}
        <div><dt>Source</dt><dd className="optimization-chips"><span className="chip">{detail.result!.source_class}</span></dd></div>
        {finalRevision !== null ? <div><dt>Final structure</dt><dd data-testid="optimization-final-structure">V{finalRevision}</dd></div> : null}
        <div><dt>Producer</dt><dd>{detail.result!.trusted_producer_id}</dd></div>
        <div><dt>Provenance</dt><dd><code title={detail.result!.provenance_record_id}>{detail.result!.provenance_record_id.slice(0, 8)}…</code></dd></div>
      </dl>
      <p>Geometry convergence: established by the validated engine output. A local minimum is not established without vibrational analysis.</p>
      {separationWarnings.map((warning) => <p key={warning} role="status">Geometry review warning: {warning}</p>)}
      <p>Connectivity is not independently verified. Displayed bonds use input connectivity or visual distance inference.</p>
    </div> : null}
    <div className="optimization-inspector">
      <div><span>Input version</span><strong>{trajectory.input_structure_version_id}</strong></div>
      <div><span>Input hash</span><strong>{trajectory.input_hash}</strong></div>
      <div><span>Trajectory hash</span><strong>{trajectory.artifact_sha256 ?? "Pending final artifact"}</strong></div>
      <div><span>Engine</span><strong>{trajectory.engine ? `${trajectory.engine.name} ${trajectory.engine.version}` : "Pending engine manifest"}</strong></div>
      <div><span>Final version</span><strong>{trajectory.final_structure_version_id ?? "Not published"}</strong></div>
    </div>
    {finalAvailable ? <button type="button" className="optimization-open-final" onClick={async () => {
      const versions = await listStructureVersions(projectId, source.structure.id);
      const version = versions.find((item) => item.version.id === trajectory.final_structure_version_id);
      if (version) onOpenFinal(version);
    }}title="Open the optimized StructureVersion">Open optimized structure</button> : null}
    {detail.attempt?.diagnostic ? <p className="optimization-diagnostic" role="status">{detail.attempt.diagnostic}</p> : null}
  </section>;
}
