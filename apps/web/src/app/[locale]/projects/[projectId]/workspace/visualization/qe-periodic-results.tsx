"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useParams } from "next/navigation";

import { canSaveRelaxedStructure, RELAXED_VERSION_NOTE, savedVersionSummary } from "@/lib/relaxed-structure";
import { structureWorkspacePath } from "@/lib/job-view";
import { createRelaxedStructureVersion } from "@/lib/structure-workspace-api";
import {
  QE_AFM_LOCAL_MINIMUM_NOTE,
  QE_BANDS_CAPTION,
  QE_BANDS_GAP_LABEL,
  QE_DOS_CAPTION,
  QE_GAP_NOTE,
  QE_RELAX_NOTE,
} from "@/lib/periodic-wording";

type EChart = { setOption: (option: unknown, notMerge?: boolean) => void; resize: () => void; dispose: () => void };
type EChartsModule = { init: (element: HTMLElement) => EChart };

type DosPayload = {
  fermi_ev: number;
  spin_polarized: boolean;
  energy_rel_fermi_ev: number[];
  total_up: number[];
  total_down: number[] | null;
  projected_energy_rel_fermi_ev?: number[];
  projected: { element: string; orbital: string; up: number[]; down: number[] | null }[];
  k_mesh?: number[];
  gap_from_eigenvalues_ev?: number | null;
  gap_note?: string;
};

type BandsPayload = {
  fermi_ev: number;
  k_distance: number[];
  nodes: { index: number; label: string; distance: number }[];
  bands_up: number[][];
  bands_down: number[][] | null;
  vbm_ev: number | null;
  cbm_ev: number | null;
  gap_along_path_ev: number | null;
  path_source?: string;
};

type Relaxation = {
  converged: boolean;
  ionic_steps: number | null;
  scf_cycles: number | null;
  initial_energy_hartree: number;
  final_energy_hartree: number;
  max_force_ry_per_bohr: number | null;
  force_threshold_ry_per_bohr: number;
  final_positions: { index: number; element: string; species: string; fractional: number[] }[];
};

function useChart(option: unknown | null) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<EChart | null>(null);
  useEffect(() => {
    if (!option || !ref.current) return;
    let active = true;
    void (async () => {
      const echarts = (await import("echarts")) as unknown as EChartsModule;
      if (!active || !ref.current) return;
      chart.current ??= echarts.init(ref.current);
      chart.current.setOption(option, true);
    })();
    const resize = () => chart.current?.resize();
    window.addEventListener("resize", resize);
    return () => { active = false; window.removeEventListener("resize", resize); };
  }, [option]);
  useEffect(() => () => { chart.current?.dispose(); chart.current = null; }, []);
  return ref;
}

function downloadCsv(name: string, header: string[], rows: (number | string)[][]) {
  const text = [header.join(","), ...rows.map((r) => r.join(","))].join("\n") + "\n";
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

const sectionStyle = { borderTop: "1px solid var(--cdf-line, #d6dde4)", paddingTop: "12px", marginTop: "12px" } as const;
const captionStyle = { fontSize: "11px", color: "var(--cdf-ink-muted, #52606d)", lineHeight: 1.4, margin: "6px 0 0" } as const;

export function DosChart({ dos }: { dos: DosPayload }) {
  const keys = useMemo(() => ["Total", ...dos.projected.map((p) => `${p.element} ${p.orbital}`)], [dos]);
  const [visible, setVisible] = useState<Set<string>>(() => new Set(["Total", ...dos.projected.map((p) => `${p.element} ${p.orbital}`).slice(0, 4)]));
  const option = useMemo(() => {
    const series: unknown[] = [];
    const add = (label: string, x: number[], up: number[], down: number[] | null) => {
      if (!visible.has(label)) return;
      series.push({ name: `${label} ↑`, type: "line", showSymbol: false, data: x.map((e, i) => [e, up[i]]), lineStyle: { width: 1.2 } });
      if (down) series.push({ name: `${label} ↓`, type: "line", showSymbol: false, data: x.map((e, i) => [e, -(down[i] ?? 0)]), lineStyle: { width: 1.2, type: "dashed" } });
    };
    add("Total", dos.energy_rel_fermi_ev, dos.total_up, dos.total_down);
    for (const p of dos.projected) add(`${p.element} ${p.orbital}`, dos.projected_energy_rel_fermi_ev ?? [], p.up, p.down);
    return {
      animation: false,
      grid: { left: 54, right: 12, top: 18, bottom: 44 },
      tooltip: { trigger: "axis" },
      legend: { type: "scroll", bottom: 0 },
      xAxis: { type: "value", name: "Energy − Fermi level (eV)", nameLocation: "middle", nameGap: 24, splitLine: { show: false } },
      yAxis: { type: "value", name: "DOS (states/eV)", nameLocation: "middle", nameGap: 40 },
      series: [...series, { type: "line", data: [], markLine: { symbol: "none", silent: true, data: [{ xAxis: 0 }], lineStyle: { color: "#888" } } }],
    };
  }, [dos, visible]);
  const ref = useChart(option);
  const toggle = (key: string) => setVisible((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const exportData = () => {
    const rows: (number | string)[][] = [];
    dos.energy_rel_fermi_ev.forEach((e, i) => rows.push(["Total", e, dos.total_up[i] ?? "", dos.total_down?.[i] ?? ""]));
    for (const p of dos.projected) (dos.projected_energy_rel_fermi_ev ?? []).forEach((e, i) => rows.push([`${p.element} ${p.orbital}`, e, p.up[i] ?? "", p.down?.[i] ?? ""]));
    downloadCsv("chemdft-dos.csv", ["series", "energy_minus_fermi_eV", "dos_up", "dos_down"], rows);
  };
  return (
    <div data-testid="qe-dos" style={sectionStyle}>
      <strong>Density of states</strong>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: "12px", margin: "6px 0" }} data-testid="qe-dos-toggles">
        {keys.map((key) => (
          <label key={key} style={{ display: "inline-flex", gap: "4px", alignItems: "center" }}>
            <input type="checkbox" checked={visible.has(key)} onChange={() => toggle(key)} /> {key}
          </label>
        ))}
        <button type="button" onClick={exportData} data-testid="qe-dos-export">Export plotted data (CSV)</button>
      </div>
      <div ref={ref} style={{ width: "100%", height: 240 }} data-testid="qe-dos-chart" />
      {typeof dos.gap_from_eigenvalues_ev === "number" ? (
        <p style={captionStyle} data-testid="qe-dos-gap">Kohn-Sham gap from the eigenvalues of the {dos.k_mesh?.join("×")} mesh: <strong>{dos.gap_from_eigenvalues_ev.toFixed(3)} eV</strong>. {QE_GAP_NOTE}</p>
      ) : null}
      <p style={captionStyle} data-testid="qe-dos-caption">{QE_DOS_CAPTION}</p>
    </div>
  );
}

export function BandsChart({ bands }: { bands: BandsPayload }) {
  const option = useMemo(() => {
    const series: unknown[] = [];
    bands.bands_up.forEach((energies, band) => series.push({ name: "spin up", type: "line", showSymbol: false, silent: true, lineStyle: { width: 1, color: "#1565a7" }, data: bands.k_distance.map((x, i) => [x, energies[i]]), z: 2, id: `u${band}` }));
    bands.bands_down?.forEach((energies, band) => series.push({ name: "spin down", type: "line", showSymbol: false, silent: true, lineStyle: { width: 1, color: "#b34a1f", type: "dashed" }, data: bands.k_distance.map((x, i) => [x, energies[i]]), z: 1, id: `d${band}` }));
    return {
      animation: false,
      grid: { left: 54, right: 12, top: 18, bottom: 44 },
      xAxis: {
        type: "value", min: bands.k_distance[0], max: bands.k_distance[bands.k_distance.length - 1],
        axisLabel: { formatter: (value: number) => bands.nodes.find((n) => Math.abs(n.distance - value) < 1e-3)?.label ?? "" },
        axisTick: { show: false }, splitLine: { show: true }, interval: 1e9,
      },
      yAxis: { type: "value", name: "Energy − Fermi level (eV)", nameLocation: "middle", nameGap: 40, min: -8, max: 8 },
      series: [...series, { type: "line", data: [], markLine: { symbol: "none", silent: true, label: { formatter: (p: { name: string }) => p.name, position: "end" }, data: bands.nodes.map((n) => ({ xAxis: n.distance, name: n.label })), lineStyle: { color: "#999" } } }],
    };
  }, [bands]);
  const ref = useChart(option);
  const exportData = () => {
    const rows: (number | string)[][] = [];
    const add = (spin: string, data: number[][]) => data.forEach((energies, band) => energies.forEach((e, i) => rows.push([spin, band + 1, bands.k_distance[i] ?? "", e])));
    add("up", bands.bands_up);
    if (bands.bands_down) add("down", bands.bands_down);
    downloadCsv("chemdft-bands.csv", ["spin", "band", "k_distance", "energy_minus_fermi_eV"], rows);
  };
  return (
    <div data-testid="qe-bands" style={sectionStyle}>
      <strong>Band structure</strong>
      <div style={{ margin: "6px 0", fontSize: "12px" }}>
        <button type="button" onClick={exportData} data-testid="qe-bands-export">Export plotted data (CSV)</button>
        <span style={{ marginLeft: 12 }}>Path: {bands.nodes.map((n) => n.label).join(" – ")}</span>
      </div>
      <div ref={ref} style={{ width: "100%", height: 260 }} data-testid="qe-bands-chart" />
      {typeof bands.gap_along_path_ev === "number" ? (
        <p style={captionStyle} data-testid="qe-bands-gap">{QE_BANDS_GAP_LABEL}: <strong>{bands.gap_along_path_ev.toFixed(3)} eV</strong> (highest occupied {bands.vbm_ev?.toFixed(3)} eV, lowest empty {bands.cbm_ev?.toFixed(3)} eV, absolute eigenvalues).</p>
      ) : null}
      <p style={captionStyle} data-testid="qe-bands-caption">{QE_BANDS_CAPTION}</p>
      {bands.path_source ? <p style={captionStyle}>Path source: {bands.path_source}</p> : null}
    </div>
  );
}

export function SaveRelaxedStructure({ projectId, calculationId }: { projectId: string; calculationId: string }) {
  const params = useParams<{ locale?: string }>();
  const locale = (params?.locale ?? "en") as Parameters<typeof structureWorkspacePath>[0];
  const [state, setState] = useState<{ phase: "idle" | "saving" | "saved" | "error"; text?: string; href?: string }>({ phase: "idle" });
  const save = async () => {
    setState({ phase: "saving" });
    try {
      const { version } = await createRelaxedStructureVersion({ projectId, calculationId });
      setState({
        phase: "saved", text: savedVersionSummary(version),
        href: structureWorkspacePath(locale, projectId, String(version.structure_id), String(version.id)),
      });
    } catch (error) {
      setState({ phase: "error", text: error instanceof Error ? error.message : "The relaxed structure could not be saved." });
    }
  };
  return (
    <div data-testid="qe-save-relaxed" style={{ marginTop: 8 }}>
      <button type="button" onClick={() => void save()} disabled={state.phase === "saving" || state.phase === "saved"} data-testid="qe-save-relaxed-button">
        {state.phase === "saving" ? "Saving…" : "Save relaxed structure as a new version"}
      </button>
      {state.phase === "saved" ? (
        <p role="status" style={captionStyle} data-testid="qe-save-relaxed-result">{state.text} <a href={state.href}>Open the new version</a></p>
      ) : null}
      {state.phase === "error" ? <p role="alert" style={captionStyle} data-testid="qe-save-relaxed-error">{state.text}</p> : null}
      <p style={captionStyle}>Creates a new version of the same structure with the relaxed positions: {RELAXED_VERSION_NOTE}. The original version is never changed.</p>
    </div>
  );
}

export function QePeriodicResults({ payload, projectId, calculationId }: { payload: Record<string, unknown>; projectId?: string | undefined; calculationId?: string | undefined }) {
  const rawRelaxation = payload.relaxation as Relaxation | null | undefined;
  // A relaxation block with missing numbers or positions is not rendered rather than crashing the workspace.
  const relaxation = rawRelaxation
    && typeof rawRelaxation.initial_energy_hartree === "number" && typeof rawRelaxation.final_energy_hartree === "number"
    && typeof rawRelaxation.force_threshold_ry_per_bohr === "number" && Array.isArray(rawRelaxation.final_positions)
    ? rawRelaxation : null;
  const dos = payload.dos as DosPayload | null | undefined;
  const bands = payload.bands as BandsPayload | null | undefined;
  const fermi = typeof payload.fermi_energy_ev === "number" ? payload.fermi_energy_ev : null;
  const absMag = typeof payload.absolute_magnetization === "number" ? payload.absolute_magnetization : null;
  const k = typeof payload.irreducible_k_points === "number" ? payload.irreducible_k_points : null;
  return (
    <div data-testid="qe-results" style={{ marginTop: 12 }}>
      <div style={{ fontSize: "12px", display: "flex", flexWrap: "wrap", gap: "4px 18px" }}>
        {fermi !== null ? <span data-testid="qe-fermi">Fermi level (SCF): <strong>{fermi.toFixed(4)} eV</strong></span> : null}
        {absMag !== null ? <span data-testid="qe-abs-magnetization">Absolute magnetization: <strong>{absMag.toFixed(3)} μB per cell</strong></span> : null}
        {k !== null ? <span>Irreducible k-points: <strong>{k}</strong></span> : null}
      </div>
      <p style={captionStyle} data-testid="qe-local-minimum-note">{QE_AFM_LOCAL_MINIMUM_NOTE}</p>
      {relaxation ? (
        <div data-testid="qe-relaxation" style={sectionStyle}>
          <strong>Atom relaxation (cell fixed): {relaxation.converged ? "converged" : "not converged"}</strong>
          <ul style={{ fontSize: "12px", margin: "6px 0", paddingLeft: 18 }}>
            <li>Initial energy {relaxation.initial_energy_hartree.toFixed(8)} Eh → final energy {relaxation.final_energy_hartree.toFixed(8)} Eh</li>
            <li>{relaxation.ionic_steps ?? "?"} ionic steps, {relaxation.scf_cycles ?? "?"} SCF cycles</li>
            <li>Final maximum force component {relaxation.max_force_ry_per_bohr?.toExponential(2) ?? "n/a"} Ry/bohr (threshold {relaxation.force_threshold_ry_per_bohr.toExponential(0)})</li>
          </ul>
          <table style={{ fontSize: "11px", borderCollapse: "collapse" }} data-testid="qe-final-positions">
            <thead><tr><th align="left">#</th><th align="left">Atom</th><th align="right">x</th><th align="right">y</th><th align="right">z</th></tr></thead>
            <tbody>{relaxation.final_positions.filter((a) => Array.isArray(a.fractional)).map((a) => (
              <tr key={a.index}><td>{a.index + 1}</td><td>{a.species}</td>{a.fractional.map((c, i) => (<td key={i} align="right" style={{ fontFamily: "monospace", paddingLeft: 10 }}>{typeof c === "number" ? c.toFixed(5) : "n/a"}</td>))}</tr>
            ))}</tbody>
          </table>
          <p style={captionStyle}>Final fractional coordinates. {QE_RELAX_NOTE}</p>
          {projectId && calculationId && canSaveRelaxedStructure(payload) ? <SaveRelaxedStructure projectId={projectId} calculationId={calculationId} /> : null}
        </div>
      ) : null}
      {dos ? <DosChart dos={dos} /> : null}
      {bands ? <BandsChart bands={bands} /> : null}
    </div>
  );
}
