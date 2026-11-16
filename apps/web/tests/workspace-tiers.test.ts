import { describe, expect, it } from "vitest";
import {
  DEFAULT_AI_DOCK_WIDTH_MEDIUM,
  DEFAULT_AI_DOCK_WIDTH_WIDE,
  DEFAULT_EXPLORER_RAIL_WIDTH,
  DEFAULT_EXPLORER_WIDTH,
  DRAWER_PANEL_WIDTH,
  HARD_MIN_HEIGHT,
  HARD_MIN_WIDTH,
  WIDTH_TIER_MEDIUM_MIN,
  WIDTH_TIER_WIDE_MIN,
  getTierForWidth,
  isCompactViewport,
} from "../src/lib/workspace-tiers";

describe("Workspace Width Tiers and Responsive Constants", () => {
  it("defines exact spec constants for widths and tiers", () => {
    expect(WIDTH_TIER_WIDE_MIN).toBe(1500);
    expect(WIDTH_TIER_MEDIUM_MIN).toBe(1100);
    expect(DEFAULT_EXPLORER_WIDTH).toBe(240);
    expect(DEFAULT_EXPLORER_RAIL_WIDTH).toBe(48);
    expect(DEFAULT_AI_DOCK_WIDTH_WIDE).toBe(380);
    expect(DEFAULT_AI_DOCK_WIDTH_MEDIUM).toBe(300);
    expect(DRAWER_PANEL_WIDTH).toBe(400);
    expect(HARD_MIN_WIDTH).toBe(1024);
    expect(HARD_MIN_HEIGHT).toBe(600);
  });

  it("classifies wide tier (>= 1500px)", () => {
    expect(getTierForWidth(1500)).toBe("wide");
    expect(getTierForWidth(1728)).toBe("wide");
    expect(getTierForWidth(1920)).toBe("wide");
    expect(getTierForWidth(2560)).toBe("wide");
  });

  it("classifies medium tier (1100px - 1499px)", () => {
    expect(getTierForWidth(1100)).toBe("medium");
    expect(getTierForWidth(1280)).toBe("medium");
    expect(getTierForWidth(1366)).toBe("medium");
    expect(getTierForWidth(1440)).toBe("medium");
    expect(getTierForWidth(1499)).toBe("medium");
  });

  it("classifies narrow tier (< 1100px)", () => {
    expect(getTierForWidth(1099)).toBe("narrow");
    expect(getTierForWidth(1024)).toBe("narrow");
    expect(getTierForWidth(860)).toBe("narrow");
    expect(getTierForWidth(834)).toBe("narrow");
    expect(getTierForWidth(500)).toBe("narrow");
  });

  it("identifies compact viewports (e.g. 1024x600, or height < 700)", () => {
    expect(isCompactViewport(1024, 600)).toBe(true);
    expect(isCompactViewport(1280, 650)).toBe(true);
    expect(isCompactViewport(860, 800)).toBe(true);
    expect(isCompactViewport(1440, 900)).toBe(false);
    expect(isCompactViewport(1728, 1080)).toBe(false);
  });
});

