"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CalculationComparisonOutput } from "@chemdft/schemas";
import {
  deltaPlot, frequencyRows, plottableDeltaKinds, positionLetter, signed, STATUS, THERMO_PLOT_KINDS, thermoPoints, pairFor,
  type CompareItem, type DeltaUnit, type StoredModes, type ThermoConditions,
} from "@/lib/compare-model";
import { formatNumber } from "@/lib/comparison-view";
import { formatPressure } from "@/lib/thermochemistry";
import styles from "./compare.module.css";

// echarts is a large optional dependency: it loads only when a plot is on screen.
type EChartsInstance = { setOption: (option: object, notMerge?: boolean) => void; resize: () => void; dispose: () => void };
type EChartsModule = { init: (element: HTMLElement, theme?: string | null, options?: object) => EChartsInstance };

const INK = "#18212b", MUTED = "#52606d", LINE = "#d6dde4", ACCENT = "#1565a7", WARN = "#a96700";

function EChart({ option, label, height = 260 }: { option: object; label: string; height?: number }) {
  const host = useRef<HTMLDivElement | null>(null);
  const chart = useRef<EChartsInstance | null>(null);
  const latest = useRef(option);
  useEffect(() => { latest.current = option; chart.current?.setOption(option, true); }, [option]);
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    void (async () => {
      const echarts = (await import("echarts")) as unknown as EChartsModule;
      if (disposed || !host.current) return;
      chart.current = echarts.init(host.current, null, { renderer: "canvas" });
      chart.current.setOption(latest.current, true);
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => chart.current?.resize());
        observer.observe(host.current);
      }
    })();
    return () => { disposed = true; observer?.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, []);
  return <div ref={host} className={styles.plotCanvas} style={{ height }} role="img" aria-label={label} data-testid="compare-chart" />;
}

const baseAxis = { axisLine: { lineStyle: { color: "#718096" } }, axisLabel: { color: MUTED, fontSize: 11 }, nameTextStyle: { color: MUTED, fontSize: 11 }, splitLine: { lineStyle: { color: LINE, type: "dashed" } } };

function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: string[][] }) {
  return (
    <details className={styles.plotTable}>
      <summary>Data table for this plot</summary>
      <div className={styles.scroll} style={{ marginTop: 6 }} tabIndex={0} role="region" aria-label={`${caption} (scrollable)`}>
        <table className={styles.data}>
          <caption className="screen-reader-only">{caption}</caption>
          <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j} className={styles.valueCell}>{cell}</td>))}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * Differences the server formed (other minus reference) for one quantity. Only pairings with a delta are drawn;
 * the reference is the zero line. Limited comparisons carry a hatch pattern and the word in the tooltip, so the
 * distinction does not rest on colour. Nothing between the bars is interpolated.
 */
function DeltaChartCard({ output, items }: { output: CalculationComparisonOutput; items: readonly CompareItem[] }) {
  const kinds = useMemo(() => plottableDeltaKinds(output), [output]);
  const [kind, setKind] = useState<string>("");
  const [unit, setUnit] = useState<DeltaUnit>("kcal");
  // Energies (the quantities with kcal/mol and kJ/mol conversions) lead; the researcher can pick any other quantity.
  const chosen = kinds.find((k) => k.kind === kind) ?? kinds.find((k) => k.energy) ?? kinds[0];
  const effectiveUnit: DeltaUnit = chosen?.energy ? unit : "native";
  const plot = chosen ? deltaPlot(output, chosen.kind, effectiveUnit) : null;
  const letter = (resultId: string) => positionLetter(Math.max(0, items.findIndex((item) => item.resultId === resultId)));
  const option = useMemo(() => {
    if (!plot) return {};
    const categories = ["A · reference", ...plot.bars.map((bar) => `${letter(bar.resultId)} · ${items.find((i) => i.resultId === bar.resultId)?.taskText ?? "result"}`)];
    const data = [
      { value: 0, itemStyle: { color: "#718096" }, limited: false, reference: true },
      ...plot.bars.map((bar) => ({
        value: bar.value, limited: bar.limited, reference: false,
        itemStyle: bar.limited ? { color: WARN, decal: { symbol: "rect", dashArrayX: [4, 2], dashArrayY: [4, 2], rotation: Math.PI / 4, color: "rgba(255,255,255,0.55)" } } : { color: ACCENT },
      })),
    ];
    return {
      animation: false, backgroundColor: "transparent", aria: { enabled: true },
      grid: { left: 118, right: 28, top: 12, bottom: 38 },
      tooltip: {
        trigger: "item",
        formatter: (params: { name: string; value: number; data: { limited: boolean; reference: boolean } }) =>
          params.data.reference ? `${params.name}<br/>0 by definition` : `${params.name}<br/>Δ = ${signed(params.value, 6)} ${plot.unit}<br/>${params.data.limited ? "Comparable with limitations" : "Directly comparable"}`,
      },
      xAxis: { type: "value", name: `Δ (other − reference) / ${plot.unit}`, nameLocation: "middle", nameGap: 24, ...baseAxis },
      yAxis: { type: "category", inverse: true, data: categories, axisTick: { show: false }, axisLabel: { color: INK, fontSize: 11, width: 108, overflow: "truncate" }, axisLine: { lineStyle: { color: "#718096" } } },
      series: [{ type: "bar", data, barMaxWidth: 22, label: { show: true, position: "right", color: INK, fontSize: 11, formatter: (p: { value: number }) => (p.value === 0 ? "" : signed(p.value, 4)) } }],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, items]);
  if (!chosen || !plot) return null;
  const identical = plot.bars.every((bar) => bar.value === 0);
  return (
    <section className={styles.plot} aria-label="Differences from the reference" data-testid="compare-plot-delta">
      <header><h4>Difference from the reference</h4><span className={styles.caption}>Derived by the platform from stored values</span></header>
      <div className={styles.plotControls}>
        {kinds.length > 1 ? (
          <label>Quantity{" "}<select value={chosen.kind} onChange={(e) => setKind(e.currentTarget.value)} data-testid="compare-plot-kind">{kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select></label>
        ) : <span>{chosen.label}</span>}
        {chosen.energy ? (
          <label>Unit{" "}<select value={unit} onChange={(e) => setUnit(e.currentTarget.value as DeltaUnit)} data-testid="compare-plot-unit"><option value="kcal">kcal/mol</option><option value="kj">kJ/mol</option><option value="native">{plot.nativeUnit === "Eh" ? "Eh (hartree)" : plot.nativeUnit}</option></select></label>
        ) : null}
      </div>
      {identical ? (
        <p className={styles.notice} data-intent="info" data-testid="compare-plot-identical">
          <strong>No difference to plot.</strong>
          <span>The stored {plot.label.toLowerCase()} of {plot.bars.length === 1 ? "the other result equals" : "every other result equals"} the reference (Δ = 0 at stored precision), so a bar chart would only show empty bars.</span>
        </p>
      ) : <EChart option={option} height={Math.max(150, 62 + 42 * (plot.bars.length + 1))} label={`Bar chart of ${plot.label} differences from the reference in ${plot.unit}`} />}
      {plot.hiddenIncomparable > 0 ? <p className={styles.caption}>{plot.hiddenIncomparable} not scientifically comparable result{plot.hiddenIncomparable === 1 ? " is" : "s are"} not drawn: no difference exists for them.</p> : null}
      <DataTable caption="Differences plotted" head={["Result", `Δ (${plot.unit})`, "Comparability"]} rows={[["A · reference", "0", "—"], ...plot.bars.map((bar) => {
        const pair = pairFor(output, bar.resultId);
        return [`${letter(bar.resultId)} · ${items.find((i) => i.resultId === bar.resultId)?.taskText ?? ""}`, signed(bar.value, 8), pair ? STATUS[pair.label].text : "—"];
      })]} />
    </section>
  );
}

/**
 * Stored thermal values at the conditions each result was computed at. One marker per stored result: the markers are
 * not joined, no value is interpolated, and nothing is evaluated at another temperature.
 */
function ThermoChartCard({ output, items, conditions }: { output: CalculationComparisonOutput; items: readonly CompareItem[]; conditions: ReadonlyMap<string, ThermoConditions> }) {
  // Enthalpy and Gibbs free energy lead: they are the quantities that change with temperature.
  const available = [...THERMO_PLOT_KINDS].reverse().filter((k) => thermoPoints(output, conditions, k.kind).length >= 2);
  const [kind, setKind] = useState<string>("");
  const [unit, setUnit] = useState<DeltaUnit>("kj");
  const chosen = available.find((k) => k.kind === kind) ?? available[0];
  const points = chosen ? thermoPoints(output, conditions, chosen.kind) : [];
  const factors = output.conversion_factors;
  const stored = points[0]?.unit ?? "";
  const factor = stored === "Eh" && unit === "kj" ? factors["kJ/mol per Eh"] : stored === "Eh" && unit === "kcal" ? factors["kcal/mol per Eh"] : 1;
  const unitText = stored === "Eh" ? (unit === "kj" ? "kJ/mol" : unit === "kcal" ? "kcal/mol" : "Eh") : stored;
  const scale = factor ?? 1;
  const letter = (resultId: string) => positionLetter(Math.max(0, items.findIndex((item) => item.resultId === resultId)));
  const option = useMemo(() => ({
    animation: false, backgroundColor: "transparent", aria: { enabled: true },
    grid: { left: 84, right: 20, top: 18, bottom: 66 },
    legend: { bottom: 0, textStyle: { color: MUTED, fontSize: 11 }, icon: "circle" },
    tooltip: { trigger: "item", formatter: (p: { seriesName: string; value: number[]; data: { pressure: string } }) => `${p.seriesName}<br/>T = ${p.value[0]} K · p = ${p.data.pressure}<br/>${formatNumber(p.value[1] ?? 0, 9)} ${unitText}` },
    xAxis: { type: "value", name: "Temperature / K", nameLocation: "middle", nameGap: 28, scale: true, ...baseAxis },
    yAxis: { type: "value", name: unitText, nameLocation: "middle", nameGap: 62, scale: true, ...baseAxis },
    series: points.map((point, index) => ({
      type: "scatter", name: `${letter(point.resultId)} · ${items.find((i) => i.resultId === point.resultId)?.taskText ?? "result"}`, symbolSize: 11,
      symbol: ["circle", "diamond", "triangle", "rect", "roundRect", "pin", "arrow", "circle"][index % 8], itemStyle: { color: index === 0 ? ACCENT : "#52606d" },
      data: [{ value: [point.temperatureK, point.value * scale], pressure: formatPressure(point.pressurePa) }],
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [points, unitText, scale, items]);
  if (!chosen) return null;
  return (
    <section className={styles.plot} aria-label="Stored thermal values at their conditions" data-testid="compare-plot-thermo">
      <header><h4>Stored thermal values at their conditions</h4><span className={styles.caption}>One marker per stored result · not joined</span></header>
      <div className={styles.plotControls}>
        <label>Quantity{" "}<select value={chosen.kind} onChange={(e) => setKind(e.currentTarget.value)}>{available.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select></label>
        {stored === "Eh" ? <label>Unit{" "}<select value={unit} onChange={(e) => setUnit(e.currentTarget.value as DeltaUnit)}><option value="kj">kJ/mol</option><option value="kcal">kcal/mol</option><option value="native">Eh (hartree)</option></select></label> : null}
      </div>
      <EChart option={option} label={`Stored ${chosen.label} of each result against the temperature it was computed at, in ${unitText}`} />
      <p className={styles.caption}>Each marker is a separate stored calculation at its own temperature and pressure. No curve is drawn between them and no value is estimated at another temperature.{stored === "Eh" && unit !== "native" ? " The unit conversion is the platform's fixed CODATA factor." : ""}</p>
      <DataTable caption="Stored thermal values plotted" head={["Result", "T (K)", "p", `${chosen.label} (${unitText})`]} rows={points.map((p) => [`${letter(p.resultId)} · ${items.find((i) => i.resultId === p.resultId)?.taskText ?? ""}`, String(p.temperatureK), formatPressure(p.pressurePa), String(p.value * scale)])} />
    </section>
  );
}

/** Positions of the stored real vibrational modes of each result on one wavenumber axis (rows of ticks); imaginary modes are counted, not drawn. */
function FrequencyChartCard({ output, items, modes }: { output: CalculationComparisonOutput; items: readonly CompareItem[]; modes: ReadonlyMap<string, StoredModes> }) {
  const rows = useMemo(() => frequencyRows(output, modes), [output, modes]);
  const letter = (resultId: string) => positionLetter(Math.max(0, items.findIndex((item) => item.resultId === resultId)));
  const option = useMemo(() => ({
    animation: false, backgroundColor: "transparent", aria: { enabled: true },
    grid: { left: 96, right: 20, top: 12, bottom: 40 },
    tooltip: { trigger: "item", formatter: (p: { name: string; value: number[] }) => `${p.name}<br/>${formatNumber(p.value[0] ?? 0, 6)} cm⁻¹` },
    xAxis: { type: "value", name: "Wavenumber / cm⁻¹", nameLocation: "middle", nameGap: 24, ...baseAxis },
    yAxis: { type: "category", inverse: true, data: rows.map((r) => `${letter(r.resultId)} · ${items.find((i) => i.resultId === r.resultId)?.taskText ?? ""}`), axisTick: { show: false }, axisLabel: { color: INK, fontSize: 11, width: 88, overflow: "truncate" }, axisLine: { lineStyle: { color: "#718096" } } },
    series: [{ type: "scatter", symbol: "rect", symbolSize: [2, 20], itemStyle: { color: ACCENT }, data: rows.flatMap((row, rowIndex) => row.frequencies.map((f) => ({ name: `${letter(row.resultId)} · stored real mode`, value: [f, rowIndex] }))) }],
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, items]);
  if (rows.length === 0) return null;
  return (
    <section className={styles.plot} aria-label="Stored vibrational mode positions" data-testid="compare-plot-frequency">
      <header><h4>Stored vibrational mode positions</h4><span className={styles.caption}>Harmonic frequencies as stored</span></header>
      <EChart option={option} height={Math.max(130, 70 + 40 * rows.length)} label="Positions of the stored real vibrational frequencies of each result on a wavenumber axis" />
      <p className={styles.caption}>Positions only: no intensities, broadening or spectrum is drawn. {rows.filter((r) => r.imaginaryCount > 0).map((r) => `${letter(r.resultId)} has ${r.imaginaryCount} imaginary mode${r.imaginaryCount === 1 ? "" : "s"} (not drawn).`).join(" ")}</p>
      <DataTable caption="Stored real frequencies plotted" head={["Result", "Real modes (cm⁻¹)"]} rows={rows.map((r) => [`${letter(r.resultId)} · ${items.find((i) => i.resultId === r.resultId)?.taskText ?? ""}`, r.frequencies.map((f) => formatNumber(f, 6)).join(", ")])} />
    </section>
  );
}

/** Only the plots the returned, stored data can honestly support; otherwise a reason and the numerical comparison. */
export default function PlotsView({ output, items, conditions, modes }: {
  output: CalculationComparisonOutput; items: readonly CompareItem[]; conditions: ReadonlyMap<string, ThermoConditions>; modes: ReadonlyMap<string, StoredModes>;
}) {
  const hasDelta = plottableDeltaKinds(output).length > 0;
  const hasThermo = THERMO_PLOT_KINDS.some((k) => thermoPoints(output, conditions, k.kind).length >= 2);
  const hasFrequency = frequencyRows(output, modes).length > 0;
  if (!hasDelta && !hasThermo && !hasFrequency) {
    const blocked = output.overall === "NOT_SCIENTIFICALLY_COMPARABLE";
    return (
      <div className={styles.tabPanel} data-testid="compare-plots">
        <p className={styles.notice} data-intent="info" data-testid="compare-no-plot">
          <strong>No scientifically supported plot for this selection.</strong>
          <span>{blocked
            ? "These results are not scientifically comparable, so no difference is plotted. The stored values are in the Data tab."
            : "The selected results share no stored quantity that a plot can show without inventing values. The numerical comparison is in Key comparison."}</span>
        </p>
      </div>
    );
  }
  return (
    <div className={styles.tabPanel} data-testid="compare-plots">
      <div className={styles.plotGrid}>
        <DeltaChartCard output={output} items={items} />
        <ThermoChartCard output={output} items={items} conditions={conditions} />
        <FrequencyChartCard output={output} items={items} modes={modes} />
      </div>
    </div>
  );
}
