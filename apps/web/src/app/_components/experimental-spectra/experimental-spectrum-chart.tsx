"use client";

import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { extentOf, niceTicks, type Trace } from "@/lib/experimental-spectra";

export interface ChartPeak { index: number; x: number; y: number; label: string; matched?: "matched" | "ambiguous" | "unmatched" | undefined }
export interface ChartStick {
  id: number;
  x: number;
  /** Calculated value as a 0..1 fraction of the strongest considered item. Orientation only: never an intensity claim. */
  relative: number;
  label: string;
  status: "matched" | "ambiguous" | "unmatched";
}

interface Props {
  traces: Trace[];
  xLabel: string;
  yLabel: string;
  inverted?: boolean;
  peaks?: ChartPeak[];
  selectedPeak?: number | null;
  onSelectPeak?: (index: number) => void;
  sticks?: ChartStick[];
  selectedStick?: number | null;
  onSelectStick?: (id: number) => void;
  stickCaption?: string;
  height?: number;
  testIdPrefix: string;
  ariaLabel: string;
  description: string;
}

function useMeasuredWidth(fallback: number): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => { const next = Math.round(node.clientWidth); if (next > 0) setWidth(next); };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

const STICK_ZONE = 0.5; // calculated sticks occupy the lower half of the plot so they never read as the measured intensity

/**
 * Experimental spectrum plot. Traces are the stored arrays (raw, baseline, corrected, processed); peaks are algorithm output
 * drawn as markers; calculated sticks are a separate, clearly labelled overlay. Drag across the plot to zoom.
 */
export const ExperimentalSpectrumChart = memo(function ExperimentalSpectrumChart({
  traces, xLabel, yLabel, inverted = false, peaks = [], selectedPeak = null, onSelectPeak,
  sticks = [], selectedStick = null, onSelectStick, stickCaption, height = 360, testIdPrefix, ariaLabel, description,
}: Props) {
  const [wrapRef, width] = useMeasuredWidth(900);
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const extent = useMemo(() => extentOf(traces), [traces]);
  const [xLo, xHi] = zoom ?? [extent.xMin, extent.xMax];
  const visible = useMemo(() => {
    if (!zoom) return extent;
    let yMin = Infinity, yMax = -Infinity;
    for (const trace of traces) {
      for (let i = 0; i < trace.x.length; i += 1) {
        const xv = trace.x[i]!;
        if (xv < zoom[0] || xv > zoom[1]) continue;
        const yv = trace.y[i]!;
        if (yv < yMin) yMin = yv;
        if (yv > yMax) yMax = yv;
      }
    }
    if (!Number.isFinite(yMin)) return extent;
    const pad = (yMax - yMin || 1) * 0.06;
    return { ...extent, yMin: yMin - pad, yMax: yMax + pad };
  }, [extent, traces, zoom]);

  const plot = { left: 66, right: 24, top: 18, bottom: 48 };
  const plotWidth = Math.max(160, width - plot.left - plot.right);
  const plotHeight = height - plot.top - plot.bottom;
  const baseY = height - plot.bottom;
  const span = xHi - xLo || 1;
  const toX = (xv: number) => plot.left + (inverted ? (xHi - xv) / span : (xv - xLo) / span) * plotWidth;
  const fromX = (px: number) => { const f = Math.max(0, Math.min(1, (px - plot.left) / plotWidth)); return inverted ? xHi - f * span : xLo + f * span; };
  const ySpan = visible.yMax - visible.yMin || 1;
  const toY = (yv: number) => baseY - ((yv - visible.yMin) / ySpan) * plotHeight;

  const paths = useMemo(() => traces.map((trace) => {
    const parts: string[] = [];
    let drawing = false;
    for (let i = 0; i < trace.x.length; i += 1) {
      const xv = trace.x[i]!;
      if (xv < xLo || xv > xHi) { drawing = false; continue; }
      parts.push(`${drawing ? "L" : "M"}${toX(xv).toFixed(1)} ${toY(trace.y[i]!).toFixed(1)}`);
      drawing = true;
    }
    return { id: trace.id, style: trace.style, label: trace.label, d: parts.join(" ") };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [traces, xLo, xHi, inverted, plotWidth, height, visible.yMin, visible.yMax]);

  const xTicks = useMemo(() => niceTicks(xLo, xHi, Math.max(3, Math.floor(plotWidth / 90))), [xLo, xHi, plotWidth]);
  const yTicks = useMemo(() => niceTicks(visible.yMin, visible.yMax, 5), [visible.yMin, visible.yMax]);

  function svgX(event: React.MouseEvent) {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect ? event.clientX - rect.left : 0;
  }
  function endDrag() {
    if (drag && Math.abs(drag.to - drag.from) > 8) {
      const a = fromX(drag.from), b = fromX(drag.to);
      setZoom([Math.min(a, b), Math.max(a, b)]);
    }
    setDrag(null);
  }

  const peakInView = peaks.filter((p) => p.x >= xLo && p.x <= xHi);
  const stickInView = sticks.filter((s) => s.x >= xLo && s.x <= xHi);

  return (
    <div ref={wrapRef} className="xspec-chart" data-testid={`${testIdPrefix}-chart`}>
      <div className="xspec-chart-tools">
        <ul className="xspec-legend" aria-label="Curves">
          {traces.map((trace) => <li key={trace.id} data-style={trace.style}><span className="xspec-swatch" />{trace.label}</li>)}
          {peaks.length ? <li data-style="peak"><span className="xspec-swatch" />Detected peaks (algorithm output, not raw)</li> : null}
          {sticks.length ? <li data-style="stick"><span className="xspec-swatch" />Calculated items (relative height, orientation only)</li> : null}
        </ul>
        <span className="xspec-zoom-hint">{zoom ? `Zoomed ${xLo.toFixed(1)}–${xHi.toFixed(1)}` : "Drag across the plot to zoom"}</span>
        {zoom ? <button type="button" className="xspec-link-btn" onClick={() => setZoom(null)} data-testid={`${testIdPrefix}-zoom-reset`}>Reset zoom</button> : null}
      </div>
      <svg
        ref={svgRef}
        className="xspec-plot"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        data-testid={`${testIdPrefix}-svg`}
        onMouseDown={(event) => { const x = svgX(event); if (x >= plot.left && x <= plot.left + plotWidth) setDrag({ from: x, to: x }); }}
        onMouseMove={(event) => { if (drag) setDrag({ from: drag.from, to: svgX(event) }); }}
        onMouseUp={endDrag}
        onMouseLeave={() => setDrag(null)}
      >
        <title>{ariaLabel}</title>
        <desc>{description}</desc>
        <rect x={plot.left} y={plot.top} width={plotWidth} height={plotHeight} className="xspec-plot-bg" />
        {yTicks.map((tick) => (
          <g key={`y${tick}`}>
            <line x1={plot.left} x2={plot.left + plotWidth} y1={toY(tick)} y2={toY(tick)} className="xspec-grid" />
            <text x={plot.left - 8} y={toY(tick) + 4} textAnchor="end" className="xspec-tick">{Math.abs(tick) >= 1000 || (Math.abs(tick) < 0.01 && tick !== 0) ? tick.toExponential(1) : Number(tick.toPrecision(4))}</text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <g key={`x${tick}`}>
            <line x1={toX(tick)} x2={toX(tick)} y1={baseY} y2={baseY + 5} className="xspec-axis" />
            <text x={toX(tick)} y={baseY + 18} textAnchor="middle" className="xspec-tick">{tick}</text>
          </g>
        ))}
        <line x1={plot.left} x2={plot.left + plotWidth} y1={baseY} y2={baseY} className="xspec-axis" />
        <line x1={plot.left} x2={plot.left} y1={plot.top} y2={baseY} className="xspec-axis" />
        <text x={plot.left + plotWidth / 2} y={height - 8} textAnchor="middle" className="xspec-axis-label">{xLabel}{inverted ? " · high → low" : ""}</text>
        <text transform={`translate(14 ${plot.top + plotHeight / 2}) rotate(-90)`} textAnchor="middle" className="xspec-axis-label">{yLabel}</text>
        {paths.map((path) => <path key={path.id} d={path.d} className={`xspec-trace xspec-trace-${path.style}`} fill="none" data-testid={`${testIdPrefix}-trace-${path.id}`}><title>{path.label}</title></path>)}
        {stickInView.map((stick) => {
          const top = baseY - stick.relative * plotHeight * STICK_ZONE;
          const selected = stick.id === selectedStick;
          return (
            <g key={`s${stick.id}`} className={`xspec-stick xspec-stick-${stick.status}${selected ? " is-selected" : ""}`} data-testid={`${testIdPrefix}-stick-${stick.id}`}
              role="button" tabIndex={0} aria-label={stick.label} aria-pressed={selected}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => onSelectStick?.(stick.id)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectStick?.(stick.id); } }}>
              <rect x={toX(stick.x) - 7} y={top - 4} width={14} height={baseY - top + 4} className="xspec-stick-hit" />
              <line x1={toX(stick.x)} x2={toX(stick.x)} y1={baseY} y2={top} />
              <circle cx={toX(stick.x)} cy={top} r={selected ? 5 : 3.5} />
              {selected ? <text x={toX(stick.x)} y={top - 9} textAnchor="middle" className="xspec-stick-label">{stick.label}</text> : null}
            </g>
          );
        })}
        {peakInView.map((peak) => {
          const selected = peak.index === selectedPeak;
          const px = toX(peak.x), py = toY(peak.y);
          return (
            <g key={`p${peak.index}`} className={`xspec-peak${selected ? " is-selected" : ""}${peak.matched ? ` xspec-peak-${peak.matched}` : ""}`} data-testid={`${testIdPrefix}-peak-${peak.index}`}
              role="button" tabIndex={0} aria-label={`Peak ${peak.label}`} aria-pressed={selected}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => onSelectPeak?.(peak.index)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectPeak?.(peak.index); } }}>
              <rect x={px - 9} y={py - 24} width={18} height={26} className="xspec-peak-hit" />
              <path d={`M${px} ${py - 4} l-5 -9 h10 z`} />
              {selected || peakInView.length <= 8 ? <text x={px} y={py - 17} textAnchor="middle" className="xspec-peak-label">{peak.label}</text> : null}
            </g>
          );
        })}
        {drag ? <rect x={Math.min(drag.from, drag.to)} y={plot.top} width={Math.abs(drag.to - drag.from)} height={plotHeight} className="xspec-brush" /> : null}
      </svg>
      {stickCaption && sticks.length ? <p className="xspec-stick-caption">{stickCaption}</p> : null}
    </div>
  );
});
