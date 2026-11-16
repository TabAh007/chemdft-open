import { describe, expect, it } from "vitest";
import { displayUnit, formatDisplayValue } from "../src/lib/quantity-format";
import { axisTicksWithHeadroom, layoutPeakLabels } from "../src/lib/spectrum-labels";
import { rowPrimaryQuantity } from "../src/lib/results-model";

// The real 9-mode HNO3 / imidazole IR result shape (intensities in km/mol, frequencies in cm^-1).
const HNO3_IR = [
  { f: 509.786118, v: 8.16 }, { f: 760.2, v: 9.37 }, { f: 1020.4, v: 17.93 }, { f: 1180.9, v: 75.8 }, { f: 1330.5, v: 101.05 },
  { f: 1495.3, v: 125.57 }, { f: 1710.8, v: 186.77 }, { f: 1839.1, v: 363.12 }, { f: 3550.6, v: 270.62 },
];

function layout(width: number, intensities: number[] = HNO3_IR.map((m) => m.v), selected = 7) {
  const plot = { left: 64, right: 46, top: 34, bottom: 46 };
  const height = 270;
  const baseY = height - plot.bottom;
  const plotH = height - plot.top - plot.bottom;
  const max = Math.max(...intensities);
  const ticks = axisTicksWithHeadroom(max, 4);
  const yTop = ticks[ticks.length - 1]!;
  const plotW = width - plot.left - plot.right;
  const items = HNO3_IR.map((m, i) => ({
    key: i, x: plot.left + ((4000 - m.f) / 3600) * plotW, y: baseY - ((intensities[i] ?? m.v) / yTop) * plotH,
    chars: Math.max(`${m.f.toFixed(1)} cm⁻¹`.length, `${(intensities[i] ?? m.v).toFixed(2)} km/mol`.length), priority: i === selected ? 3 : (intensities[i] ?? m.v) / max, mustShow: i === selected,
  }));
  return { items, yTop, ticks, placed: layoutPeakLabels(items, { left: plot.left, right: width - plot.right, top: plot.top, baseY }), plot, baseY };
}

describe("IR chart axis and labels (0.0.25)", () => {
  it("always ends the y axis above the tallest peak (the 363.12 km/mol peak of the HNO3 result)", () => {
    const { ticks, yTop } = layout(900);
    expect(yTop).toBeGreaterThan(363.12 * 1.1);
    expect(ticks[ticks.length - 1]).toBe(yTop);
    for (const max of [0.004, 0.9, 12, 363.12, 4900, 2.5e6]) {
      const t = axisTicksWithHeadroom(max);
      expect(t[t.length - 1]!).toBeGreaterThanOrEqual(max * 1.14);
      expect(t.length).toBeLessThan(12);
    }
  });

  it("keeps every shown label fully inside the plot and clear of the others, at desktop and narrow widths", () => {
    for (const width of [900, 560, 360]) {
      const { placed, plot } = layout(width);
      const boxes = placed.filter((p) => p.shown).map((p) => {
        const w = 13 * 6.4 + 6;
        const left = p.anchor === "middle" ? p.x - w / 2 : p.anchor === "start" ? p.x : p.x - w;
        return { left, right: left + w, top: p.y - 22, bottom: p.y + 4, key: p.key };
      });
      expect(boxes.length).toBeGreaterThanOrEqual(1);
      for (const b of boxes) {
        expect(b.top).toBeGreaterThanOrEqual(2);
        expect(b.right).toBeLessThanOrEqual(width + 40);
        expect(b.left).toBeGreaterThanOrEqual(plot.left - 56);
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!;
        const overlap = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        expect(overlap, `${width}px labels ${a.key}/${b.key}`).toBe(false);
      }
      expect(placed.find((p) => p.key === 7)?.shown).toBe(true); // the selected (strongest) mode is always labelled
    }
  });

  it("works for far larger and far smaller intensities", () => {
    for (const scale of [1e-3, 1, 1e3]) {
      const { placed, yTop } = layout(700, HNO3_IR.map((m) => m.v * scale));
      expect(yTop).toBeGreaterThan(363.12 * scale * 1.1);
      expect(placed.filter((p) => p.shown).length).toBeGreaterThan(0);
    }
  });
});

describe("one display formatter for quantities (0.0.25)", () => {
  it("shows frequencies with one decimal and a superscript unit, never cm^-1 or six decimals", () => {
    expect(formatDisplayValue(509.786118, "cm^-1")).toBe("509.8");
    expect(displayUnit("cm^-1")).toBe("cm⁻¹");
    expect(displayUnit("A^2")).toBe("Å²".replace("Å", "A"));
    expect(displayUnit("1")).toBe("");
    expect(displayUnit("km/mol")).toBe("km/mol");
    expect(formatDisplayValue(-1.1167593073964255, "Eh")).toBe("-1.1167593074");
  });

  it("applies to the headline card of a result row while the stored value stays reachable", () => {
    const quantity = rowPrimaryQuantity({ engine: "pyscf", method: "b3lyp", quantities: [{ kind: "frequency", label: "Lowest frequency", value: 509.786118, unit: "cm^-1" }] } as never);
    expect(quantity?.text).toBe("509.8 cm⁻¹");
    expect(quantity?.unit).toBe("cm⁻¹");
    expect(quantity?.fullValueText).toBe("509.786118");
    expect(quantity?.text).not.toContain("^");
  });
});
