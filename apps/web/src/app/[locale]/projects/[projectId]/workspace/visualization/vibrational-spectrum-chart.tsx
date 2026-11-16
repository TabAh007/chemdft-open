"use client";

import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { axisTicksWithHeadroom, layoutPeakLabels } from "@/lib/spectrum-labels";

export interface ChartStick {
  modeIndex: number;
  frequencyCm1: number;
  /** Value plotted on the Y axis for this stick (already in display units). */
  value: number;
  /** Pre-formatted value shown under the frequency in the peak label. */
  valueLabel: string;
  imaginary: boolean;
}

export interface ChartCurvePoint {
  x: number;
  /** Curve height as a fraction (0..1) of the broadened-profile maximum. */
  y: number;
}

interface VibrationalSpectrumChartProps {
  sticks: ChartStick[];
  curve: ChartCurvePoint[];
  wMin: number;
  wMax: number;
  inverted?: boolean;
  xLabel: string;
  yLabel: string;
  selectedIndex: number;
  onSelect: (modeIndex: number) => void;
  testIdPrefix: string;
  ariaLabel: string;
  description: string;
  height?: number;
}

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

/**
 * Stick + broadened-curve spectrum for normal-mode spectroscopies (IR, Raman).
 * Pure presentation: values arrive already computed; hover state is local so
 * hovering never re-renders the surrounding 3D viewer.
 */
export const VibrationalSpectrumChart = memo(function VibrationalSpectrumChart({
  sticks,
  curve,
  wMin,
  wMax,
  inverted = false,
  xLabel,
  yLabel,
  selectedIndex,
  onSelect,
  testIdPrefix,
  ariaLabel,
  description,
  height = 270,
}: VibrationalSpectrumChartProps) {
  const [wrapRef, width] = useMeasuredWidth(900);
  const [hovered, setHovered] = useState<number | null>(null);

  const plot = { left: 64, right: 46, top: 34, bottom: 46 };
  const plotWidth = Math.max(120, width - plot.left - plot.right);
  const plotHeight = height - plot.top - plot.bottom;
  const baseY = height - plot.bottom;

  const span = wMax - wMin || 1;
  const toX = (nu: number) => {
    const clamped = Math.max(wMin, Math.min(wMax, nu));
    const fraction = inverted ? (wMax - clamped) / span : (clamped - wMin) / span;
    return plot.left + fraction * plotWidth;
  };

  const maxValue = Math.max(1e-6, ...sticks.map((stick) => stick.value));
  // The axis always ends above the tallest peak (headroom), so no peak or label is clipped at the top of the plot.
  const yTicks = useMemo(() => axisTicksWithHeadroom(maxValue, 4), [maxValue]);
  const yTop = Math.max(maxValue, yTicks[yTicks.length - 1] ?? maxValue);
  const toY = (value: number) => baseY - Math.max(0, Math.min(1, value / yTop)) * plotHeight;

  const curvePath = useMemo(() => {
    if (curve.length < 2) return "";
    return curve
      .map((point, index) => {
        const clamped = Math.max(wMin, Math.min(wMax, point.x));
        const fraction = inverted ? (wMax - clamped) / span : (clamped - wMin) / span;
        const x = plot.left + fraction * plotWidth;
        const y = baseY - Math.max(0, Math.min(1, point.y)) * plotHeight * (maxValue / yTop);
        return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }, [baseY, curve, inverted, maxValue, plot.left, plotHeight, plotWidth, span, wMax, wMin, yTop]);

  const xTicks = useMemo(() => {
    const minGap = Math.max(150, (span * 52) / plotWidth); // keep tick labels ~52px apart
    const ticks = new Set<number>([wMin, wMax]);
    for (let t = Math.ceil(wMin / 500) * 500; t <= wMax; t += 500) {
      if (Math.abs(t - wMin) >= minGap && Math.abs(t - wMax) >= minGap) ticks.add(t);
    }
    return Array.from(ticks).sort((a, b) => a - b);
  }, [plotWidth, span, wMax, wMin]);

  const labelAll = sticks.length <= 6;
  const labels = useMemo(() => {
    const items = sticks.map((stick) => ({
      key: stick.modeIndex,
      x: toX(stick.frequencyCm1),
      y: toY(stick.value),
      chars: Math.max(`${stick.frequencyCm1.toFixed(1)} cm⁻¹`.length, stick.valueLabel.length),
      priority: stick.modeIndex === selectedIndex ? 3 : stick.modeIndex === hovered ? 2 : stick.value / maxValue,
      mustShow: stick.modeIndex === selectedIndex || stick.modeIndex === hovered,
    }));
    const wanted = items.filter((item) => item.mustShow || labelAll || item.priority > 0.15);
    const placed = layoutPeakLabels(wanted, { left: plot.left, right: width - plot.right, top: plot.top, baseY });
    return new Map(placed.map((entry) => [entry.key, entry]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sticks, selectedIndex, hovered, width, height, maxValue, yTop, labelAll, wMin, wMax, inverted]);

  return (
    <div ref={wrapRef} className="spectro-chart">
      <svg
        className="vibrational-frequency-plot"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        // A group, not an image: the plot contains focusable mode buttons (an image role forbids interactive children).
        role="group"
        aria-label={ariaLabel}
      >
        <desc>{description}</desc>

        {yTicks.map((tick) => {
          const y = toY(tick);
          return (
            <g key={`y-${tick}`} className="spectro-grid">
              <line x1={plot.left} x2={plot.left + plotWidth} y1={y} y2={y} />
              <text x={plot.left - 8} y={y + 3.5} textAnchor="end" fontSize="11">
                {tick}
              </text>
            </g>
          );
        })}
        {xTicks.map((tick) => {
          const x = toX(tick);
          return (
            <g key={`x-${tick}`} className="spectro-grid">
              <line x1={x} x2={x} y1={plot.top} y2={baseY} />
              <text x={x} y={baseY + 17} textAnchor="middle" fontSize="11">
                {tick}
              </text>
            </g>
          );
        })}

        {curvePath ? (
          <path d={curvePath} fill="none" stroke="#0284c7" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
        ) : null}

        {sticks.map((stick) => {
          const x = toX(stick.frequencyCm1);
          const y = toY(stick.value);
          const isSelected = stick.modeIndex === selectedIndex;
          const isHovered = stick.modeIndex === hovered;
          const color = stick.imaginary ? "#c86a2b" : isSelected ? "#0f766e" : isHovered ? "#0284c7" : "#64748b";
          const place = labels.get(stick.modeIndex);
          const showLabel = Boolean(place?.shown);
          const anchor = place?.anchor ?? "middle";
          const labelX = place?.x ?? x;
          const labelY = place?.y ?? y - 9;
          return (
            <g
              key={stick.modeIndex}
              data-testid={`${testIdPrefix}-stick-${stick.modeIndex + 1}`}
              className="vibrational-frequency-marker"
              role="button"
              tabIndex={0}
              aria-label={`Mode ${stick.modeIndex + 1}: ${stick.frequencyCm1.toFixed(1)} cm⁻¹, ${stick.valueLabel}`}
              aria-pressed={isSelected}
              onClick={() => onSelect(stick.modeIndex)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(stick.modeIndex);
                }
              }}
              onMouseEnter={() => setHovered(stick.modeIndex)}
              onMouseLeave={() => setHovered(null)}
            >
              {/* Wide invisible hit target keeps thin sticks easy to click. */}
              <line x1={x} x2={x} y1={baseY} y2={y} stroke="transparent" strokeWidth="14" />
              <line x1={x} x2={x} y1={baseY} y2={y} stroke={color} strokeWidth={isSelected ? 3 : isHovered ? 2.5 : 1.75} />
              <circle cx={x} cy={y} r={isSelected ? 6 : isHovered ? 5 : 3.5} fill={color} stroke="#ffffff" strokeWidth={isSelected ? 2 : 1} />
              {isSelected ? <circle cx={x} cy={y} r={9} fill="none" stroke={color} strokeWidth="1" opacity="0.5" /> : null}
              {showLabel ? (
                <text className="spectro-peak-label" x={labelX} y={labelY} textAnchor={anchor} fill={isSelected ? "#0f766e" : "var(--cdf-ink)"} fontWeight={isSelected ? 700 : 500}
                  stroke="var(--cdf-surface, #fff)" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round">
                  <tspan x={labelX} dy="-1.1em">{stick.frequencyCm1.toFixed(1)} cm⁻¹</tspan>
                  <tspan x={labelX} dy="1.15em">{stick.valueLabel}</tspan>
                </text>
              ) : null}
            </g>
          );
        })}

        <line x1={plot.left} x2={plot.left + plotWidth} y1={baseY} y2={baseY} stroke="var(--cdf-line-strong, #94a3b8)" strokeWidth="1.25" />
        <line x1={plot.left} x2={plot.left} y1={plot.top} y2={baseY} stroke="var(--cdf-line-strong, #94a3b8)" strokeWidth="1" />

        <text className="spectro-axis-title" x={plot.left + plotWidth / 2} y={height - 8} textAnchor="middle" fontSize="12">
          {xLabel}
        </text>
        <text
          className="spectro-axis-title"
          transform={`translate(14 ${plot.top + plotHeight / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize="12"
        >
          {yLabel}
        </text>
      </svg>
    </div>
  );
});
