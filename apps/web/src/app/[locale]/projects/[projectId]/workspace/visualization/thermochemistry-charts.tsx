"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { niceAxisTicks } from "./spectroscopy-shell";

/** Small presentation-only SVG charts for Thermochemistry. They never compute science. */

function useMeasuredWidth(fallback: number): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      const next = Math.round(node.clientWidth);
      if (next > 0) setWidth(next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export interface DonutSlice {
  id: string;
  label: string;
  value: number;
  color: string;
}

export function EntropyDonut({
  slices,
  centerLabel,
  centerUnit,
  formatValue,
}: {
  slices: DonutSlice[];
  centerLabel: string;
  centerUnit: string;
  formatValue: (value: number) => string;
}) {
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const arcs = slices.reduce<Array<{ slice: DonutSlice; dash: number; offset: number }>>((acc, slice) => {
    const fraction = total > 0 ? Math.max(0, slice.value) / total : 0;
    const offset = acc.length ? acc[acc.length - 1]!.offset + acc[acc.length - 1]!.dash : 0;
    return [...acc, { slice, dash: fraction * circumference, offset }];
  }, []);
  return (
    <div className="thermo-donut" data-testid="thermo-entropy-donut">
      <svg viewBox="0 0 140 140" role="img" aria-label="Entropy contributions by term">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="#eef2f6" strokeWidth="16" />
        {arcs.map(({ slice, dash, offset }) =>
          dash > 0 ? (
            <circle
              key={slice.id}
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              stroke={slice.color}
              strokeWidth="16"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
            />
          ) : null,
        )}
        <text x="70" y="68" textAnchor="middle" className="thermo-donut-value">{centerLabel}</text>
        <text x="70" y="84" textAnchor="middle" className="thermo-donut-unit">{centerUnit}</text>
      </svg>
      <ul className="thermo-legend">
        {slices.map((slice) => {
          const fraction = total > 0 ? Math.max(0, slice.value) / total : 0;
          return (
            <li key={slice.id} data-testid={`thermo-entropy-${slice.id}`}>
              <span className="thermo-swatch" style={{ background: slice.color }} aria-hidden="true" />
              <span>{slice.label}</span>
              <span className="thermo-legend-value">{formatValue(slice.value)}</span>
              <span className="thermo-legend-pct">{(fraction * 100).toFixed(1)}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function TrendChart({
  points,
  xLabel,
  yLabel,
  marker,
  formatY,
  ariaLabel,
  height = 190,
}: {
  points: Array<{ x: number; y: number }>;
  xLabel: string;
  yLabel: string;
  marker?: { x: number; y: number } | undefined;
  formatY: (value: number) => string;
  ariaLabel: string;
  height?: number;
}) {
  const [ref, width] = useMeasuredWidth(420);
  const plot = { left: 56, right: 14, top: 12, bottom: 34 };
  const innerWidth = Math.max(80, width - plot.left - plot.right);
  const innerHeight = height - plot.top - plot.bottom;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const rawMin = Math.min(...ys, marker?.y ?? Infinity);
  const rawMax = Math.max(...ys, marker?.y ?? -Infinity);
  const span = rawMax - rawMin || Math.abs(rawMax) || 1;
  const yMin = rawMin - span * 0.06;
  const yMax = rawMax + span * 0.06;
  const toX = (x: number) => plot.left + ((x - xMin) / (xMax - xMin || 1)) * innerWidth;
  const toY = (y: number) => plot.top + (1 - (y - yMin) / (yMax - yMin || 1)) * innerHeight;
  const path = points.map((p, index) => `${index === 0 ? "M" : "L"} ${toX(p.x).toFixed(1)} ${toY(p.y).toFixed(1)}`).join(" ");
  const yTicks = niceAxisTicks(1, 4).map((fraction) => yMin + fraction * (yMax - yMin));
  const xTicks = [xMin, xMin + (xMax - xMin) / 3, xMin + (2 * (xMax - xMin)) / 3, xMax].map((value) => Math.round(value));
  return (
    <div ref={ref} className="thermo-trend" data-testid="thermo-trend-chart">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        {yTicks.map((tick, index) => (
          <g key={`y${index}`} className="spectro-grid">
            <line x1={plot.left} x2={plot.left + innerWidth} y1={toY(tick)} y2={toY(tick)} />
            <text x={plot.left - 6} y={toY(tick) + 3.5} textAnchor="end" fontSize="10">{formatY(tick)}</text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <g key={`x${tick}`} className="spectro-grid">
            <line x1={toX(tick)} x2={toX(tick)} y1={plot.top} y2={plot.top + innerHeight} />
            <text x={toX(tick)} y={plot.top + innerHeight + 14} textAnchor="middle" fontSize="10">{tick}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke="#0284c7" strokeWidth="2" strokeLinejoin="round" />
        {marker ? (
          <g data-testid="thermo-trend-marker">
            <line x1={toX(marker.x)} x2={toX(marker.x)} y1={plot.top} y2={plot.top + innerHeight} stroke="#0f766e" strokeDasharray="3 3" />
            <circle cx={toX(marker.x)} cy={toY(marker.y)} r="4.5" fill="#0f766e" stroke="#fff" strokeWidth="1.5" />
          </g>
        ) : null}
        <text className="spectro-axis-title" x={plot.left + innerWidth / 2} y={height - 6} textAnchor="middle" fontSize="11">{xLabel}</text>
        <text
          className="spectro-axis-title"
          transform={`translate(12 ${plot.top + innerHeight / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize="11"
        >
          {yLabel}
        </text>
      </svg>
    </div>
  );
}

export function ContributionBar({
  id,
  label,
  value,
  max,
  text,
  color = "#0284c7",
}: {
  id: string;
  label: string;
  value: number;
  max: number;
  text: string;
  color?: string;
}) {
  const width = max > 0 ? Math.max(0, Math.min(1, Math.abs(value) / max)) * 100 : 0;
  return (
    <div className="thermo-bar-row" data-testid={`thermo-energy-bar-${id}`}>
      <span className="thermo-bar-label">{label}</span>
      <span className="thermo-bar-track" aria-hidden="true">
        <span className="thermo-bar-fill" style={{ width: `${width}%`, background: color }} />
      </span>
      <span className="thermo-bar-value">{text}</span>
    </div>
  );
}
