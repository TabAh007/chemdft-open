"use client";

import { useEffect, useMemo, useRef } from "react";

import { axisTickText } from "@/lib/chart-tick-label";
import { numberText } from "@/lib/claim-format";
import type { Agreement, AgreementGroup } from "@/lib/comparison-format";
import styles from "./comparison.module.css";

// echarts is a large optional dependency: it loads only when the Agreement view is on screen.
type EChartsInstance = {
  setOption: (option: object, notMerge?: boolean) => void; resize: () => void; dispose: () => void;
  on: (event: string, handler: (params: { data?: { rowId?: string } }) => void) => void;
};
type EChartsModule = { init: (element: HTMLElement, theme?: string | null, options?: object) => EChartsInstance };

const INK = "#18212b", MUTED = "#52606d", LINE = "#d6dde4", ACCENT = "#1565a7";
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/**
 * One range for BOTH axes: the smallest and largest plotted value (either side) with a margin so end points are not on the frame.
 * With equal ranges the dashed y = x line is a true "paper equals ChemDFT" reference. This is axis extent only, not a statistic.
 */
export function axisExtent(values: number[]): { min: number; max: number } {
  const low = Math.min(...values), high = Math.max(...values);
  const margin = (high > low ? high - low : Math.abs(low) || 1) * 0.08;
  return { min: low - margin, max: high + margin };
}

/** "1 row", "2 rows". */
export const rowCount = (count: number): string => `${count} ${count === 1 ? "row" : "rows"}`;

/**
 * Paper value against ChemDFT value for one unit. The dots are the server's numbers; the dashed y = x line only marks where the two
 * would be equal and spans the shared axis range, so it is a valid reference on both axes.
 */
export function optionFor(group: AgreementGroup, selectedId: string | null): object {
  const values = group.points.flatMap((point) => [point.source, point.project]);
  const { min, max } = axisExtent(values);
  const axis = (name: string) => ({
    type: "value", name, nameLocation: "middle", nameGap: 34, min, max,
    nameTextStyle: { color: MUTED, fontSize: 11 }, axisLabel: { color: MUTED, fontSize: 11, formatter: (value: number) => axisTickText(value) },
    axisLine: { lineStyle: { color: "#718096" } }, splitLine: { lineStyle: { color: LINE, type: "dashed" } },
  });
  return {
    animation: false,
    grid: { left: 64, right: 24, top: 18, bottom: 48 },
    tooltip: {
      trigger: "item",
      formatter: (params: { data?: { topic?: string; value?: [number, number]; rule?: string | null }; seriesType?: string }) => {
        const data = params.data;
        if (params.seriesType !== "scatter" || !data?.value) return "y = x: paper equals ChemDFT";
        return `<strong>${escapeHtml(data.topic ?? "")}</strong><br/>Paper: ${numberText(data.value[0])} ${escapeHtml(group.unit)}<br/>ChemDFT: ${numberText(data.value[1])} ${escapeHtml(group.unit)}`
          + (data.rule ? `<br/><span style="color:${MUTED}">${escapeHtml(data.rule)}</span>` : "");
      },
    },
    xAxis: axis(`Paper (${group.unit})`),
    yAxis: axis(`ChemDFT (${group.unit})`),
    series: [
      { type: "line", silent: true, symbol: "none", data: [[min, min], [max, max]], lineStyle: { color: "#718096", type: "dashed", width: 1 }, z: 1 },
      {
        type: "scatter", symbolSize: 10, z: 3,
        data: group.points.map((point) => ({
          rowId: point.rowId, topic: point.topic, rule: point.rule, value: [point.source, point.project],
          itemStyle: point.rowId === selectedId ? { color: INK, borderColor: ACCENT, borderWidth: 3 } : { color: ACCENT },
        })),
      },
    ],
  };
}

function Plot({ group, selectedId, onSelect }: { group: AgreementGroup; selectedId: string | null; onSelect: (id: string) => void }) {
  const host = useRef<HTMLDivElement | null>(null);
  const chart = useRef<EChartsInstance | null>(null);
  const option = useMemo(() => optionFor(group, selectedId), [group, selectedId]);
  const latest = useRef({ option, onSelect });
  useEffect(() => { latest.current = { option, onSelect }; chart.current?.setOption(option, true); }, [option, onSelect]);
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    void (async () => {
      const echarts = (await import("echarts")) as unknown as EChartsModule;
      if (disposed || !host.current) return;
      const instance = echarts.init(host.current, null, { renderer: "canvas" });
      chart.current = instance;
      instance.setOption(latest.current.option, true);
      instance.on("click", (params) => { if (params.data?.rowId) latest.current.onSelect(params.data.rowId); });
      if (typeof ResizeObserver !== "undefined") { observer = new ResizeObserver(() => instance.resize()); observer.observe(host.current); }
    })();
    return () => { disposed = true; observer?.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, []);
  return <div ref={host} className={styles.plotCanvas} role="img" data-testid="agreement-chart"
    aria-label={`Paper value against ChemDFT value in ${group.unit}, ${rowCount(group.points.length)}; the exact values are in the table below`} />;
}

export function AgreementView({ agreement, selectedId, onSelect }: { agreement: Agreement; selectedId: string | null; onSelect: (id: string) => void }) {
  return <div className={styles.agreement}>
    <p className={styles.caption}>
      {agreement.plotted} of {agreement.total} visible rows plotted: only rows the server marked directly comparable, with one paper and one ChemDFT number in the same
      recorded unit. Values are exactly as sent; nothing is converted, fitted or summarised. Axis ticks are scale labels, the table has the exact digits.
    </p>
    {agreement.groups.length === 0 ? <p className={styles.empty}>No visible row can be plotted.</p> : null}
    <div className={styles.plotGroups}>
    {agreement.groups.map((group) => <section key={group.unit} className={styles.plotGroup} aria-label={`Agreement in ${group.unit}`}>
      <h3>{group.unit} <small>{rowCount(group.points.length)}</small></h3>
      <Plot group={group} selectedId={selectedId} onSelect={onSelect} />
      <details open className={styles.plotTable}>
        <summary>Exact values ({group.unit})</summary>
        <table>
          <thead><tr><th scope="col">Topic</th><th scope="col">Paper</th><th scope="col">ChemDFT</th></tr></thead>
          <tbody>{group.points.map((point) => <tr key={point.rowId} data-row-id={point.rowId} data-selected={point.rowId === selectedId} onClick={() => onSelect(point.rowId)}>
            <th scope="row">{point.topic}</th><td className={styles.mono}>{numberText(point.source)} {group.unit}</td><td className={styles.mono}>{numberText(point.project)} {group.unit}</td>
          </tr>)}</tbody>
        </table>
      </details>
    </section>)}
    </div>
    {agreement.excluded.length ? <details className={styles.excluded}>
      <summary>{rowCount(agreement.excluded.length)} not plotted</summary>
      <ul>{agreement.excluded.map((item) => <li key={item.rowId}><strong>{item.topic}</strong> {item.reason}</li>)}</ul>
    </details> : null}
  </div>;
}
