/**
 * Release 0.0.25: presentation-only helpers for the stick spectra (IR, Raman).
 * Nothing here changes a value: it only picks the y-axis ceiling and where each peak label sits.
 */
/** Same rule as the shell's niceAxisTicks (kept local so this module stays free of React imports). */
export function niceAxisTicks(max: number, target = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const rough = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = (normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10) * magnitude;
  const ticks: number[] = [];
  for (let value = 0; value <= max * 1.0001; value += step) ticks.push(Number(value.toPrecision(6)));
  return ticks;
}

/** Ticks for the y axis whose last tick is at least `headroom` above the data maximum, so the tallest peak never touches or leaves the plot. */
export function axisTicksWithHeadroom(max: number, target = 4, headroom = 1.14): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const ticks = niceAxisTicks(max * headroom, target);
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : max;
  let last = ticks[ticks.length - 1] ?? 0;
  while (last < max * headroom) {
    last = Number((last + step).toPrecision(6));
    ticks.push(last);
  }
  return ticks;
}

export interface LabelItem {
  key: number;
  x: number;
  y: number;
  /** Longest label line in characters. */
  chars: number;
  /** Selected and hovered labels are always drawn; the others only when a free spot exists. */
  priority: number;
  mustShow: boolean;
}

export interface PlacedLabel { key: number; x: number; y: number; anchor: "start" | "middle" | "end"; shown: boolean }

const CHAR_W = 6.4;
const LINE_H = 12.5;
const BOX_H = 2 * LINE_H + 2;

interface Box { left: number; right: number; top: number; bottom: number }
const overlaps = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * Greedy label placement with collision avoidance. Candidates, in order: centred above the peak, beside it
 * (right, then left), then centred and raised in steps. A candidate is accepted when its box is inside the
 * drawing area, clear of every placed label, and clear of every OTHER peak's stick.
 */
export function layoutPeakLabels(
  items: readonly LabelItem[],
  area: { left: number; right: number; top: number; baseY: number },
): PlacedLabel[] {
  const ordered = [...items].sort((a, b) => b.priority - a.priority || a.y - b.y);
  const placed: Box[] = [];
  const result = new Map<number, PlacedLabel>();
  const sticks = items.map((item) => ({ key: item.key, x: item.x, top: item.y }));
  for (const item of ordered) {
    const width = item.chars * CHAR_W + 6;
    const candidates: Array<{ anchor: "start" | "middle" | "end"; x: number; baseline: number }> = [
      { anchor: "middle", x: item.x, baseline: item.y - 9 },
      { anchor: "start", x: item.x + 9, baseline: item.y + 4 },
      { anchor: "end", x: item.x - 9, baseline: item.y + 4 },
      { anchor: "middle", x: item.x, baseline: item.y - 9 - BOX_H },
      { anchor: "middle", x: item.x, baseline: item.y - 9 - 2 * BOX_H },
    ];
    let chosen: PlacedLabel | null = null;
    let chosenBox: Box | null = null;
    for (const candidate of candidates) {
      let x = candidate.x;
      if (candidate.anchor === "middle") x = Math.max(area.left + width / 2, Math.min(area.right - width / 2, x));
      const left = candidate.anchor === "middle" ? x - width / 2 : candidate.anchor === "start" ? x : x - width;
      const box: Box = { left, right: left + width, top: candidate.baseline - 1.1 * 12 - 9, bottom: candidate.baseline + 4 };
      if (box.left < area.left - 56 || box.right > area.right + 40 || box.top < 2) continue;
      if (placed.some((other) => overlaps(box, other))) continue;
      const crossesStick = sticks.some((stick) => stick.key !== item.key && stick.x > box.left - 2 && stick.x < box.right + 2 && stick.top < box.bottom && area.baseY > box.top);
      if (crossesStick) continue;
      chosen = { key: item.key, x, y: candidate.baseline, anchor: candidate.anchor, shown: true };
      chosenBox = box;
      break;
    }
    if (!chosen && item.mustShow) {
      const x = Math.max(area.left + width / 2, Math.min(area.right - width / 2, item.x));
      chosen = { key: item.key, x, y: Math.max(item.y - 9, 24), anchor: "middle", shown: true };
      chosenBox = { left: x - width / 2, right: x + width / 2, top: Math.max(item.y - 9, 24) - 21, bottom: Math.max(item.y - 9, 24) + 4 };
    }
    if (chosen && chosenBox) {
      placed.push(chosenBox);
      result.set(item.key, chosen);
    } else {
      result.set(item.key, { key: item.key, x: item.x, y: item.y, anchor: "middle", shown: false });
    }
  }
  return items.map((item) => result.get(item.key)!);
}
