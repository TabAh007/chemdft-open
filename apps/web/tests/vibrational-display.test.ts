import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISUAL_EXAGGERATION,
  MAX_VISUAL_EXAGGERATION,
  VISUAL_BASE_DISPLACEMENT_ANGSTROM,
  visualDisplacementAngstrom,
} from "../src/lib/vibrational-mode";
import { vibrationalKind, vibrationalSpectrumLabel } from "../src/lib/vibrational-kind";

const mode = (extra: Record<string, unknown>) => ({ index: 0, ...extra });

describe("visual exaggeration (display only)", () => {
  it("defaults to a conservative displacement and clamps extremes", () => {
    expect(DEFAULT_VISUAL_EXAGGERATION).toBe(1);
    expect(visualDisplacementAngstrom(1)).toBeCloseTo(VISUAL_BASE_DISPLACEMENT_ANGSTROM);
    expect(visualDisplacementAngstrom(100)).toBeCloseTo(MAX_VISUAL_EXAGGERATION * VISUAL_BASE_DISPLACEMENT_ANGSTROM);
    expect(visualDisplacementAngstrom(0)).toBeGreaterThan(0);
    // Never reaches the 1.0–1.5 Å range that visually breaks small molecules
    expect(visualDisplacementAngstrom(Number.MAX_SAFE_INTEGER)).toBeLessThan(0.5);
  });
});

describe("vibrational result kind labels", () => {
  it("labels Raman-bearing results as Raman and IR-only results as IR", () => {
    const ir = { modes: [mode({ ir_intensity: { value: 5 } })] } as never;
    const ramanByMethod = { raman_method: "placzek_static", modes: [mode({})] } as never;
    const ramanByActivity = { modes: [mode({ ir_intensity: { value: 5 }, raman_activity: { value: 7 } })] } as never;
    expect(vibrationalKind(ir)).toBe("ir");
    expect(vibrationalKind(ramanByMethod)).toBe("raman");
    expect(vibrationalKind(ramanByActivity)).toBe("raman");
    expect(vibrationalSpectrumLabel(ir)).toBe("IR spectrum · 1 modes");
    expect(vibrationalSpectrumLabel({ ...(ramanByActivity as object), modes: [mode({ raman_activity: { value: 1 } }), mode({ raman_activity: { value: 2 } }), mode({ raman_activity: { value: 3 } })] } as never)).toBe("Raman spectrum · 3 modes");
  });
});
