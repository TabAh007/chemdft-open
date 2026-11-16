// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPersistedDensity,
  getPersistedDockCollapsed,
  getPersistedDockWidth,
  getPersistedExplorerCollapsed,
  getPersistedExplorerWidth,
  getPersistedFocusMode,
  setPersistedDensity,
  setPersistedDockCollapsed,
  setPersistedDockWidth,
  setPersistedExplorerCollapsed,
  setPersistedExplorerWidth,
  setPersistedFocusMode,
} from "../src/lib/persisted-layout";

describe("Persisted Layout with safe storage and throwing storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("reads and writes explorer width, dock width, and collapsed states normally", () => {
    expect(getPersistedExplorerWidth(240)).toBe(240);
    setPersistedExplorerWidth(280);
    expect(getPersistedExplorerWidth(240)).toBe(280);

    expect(getPersistedDockWidth(380)).toBe(380);
    setPersistedDockWidth(420);
    expect(getPersistedDockWidth(380)).toBe(420);

    expect(getPersistedExplorerCollapsed(false)).toBe(false);
    setPersistedExplorerCollapsed(true);
    expect(getPersistedExplorerCollapsed(false)).toBe(true);

    expect(getPersistedDockCollapsed(false)).toBe(false);
    setPersistedDockCollapsed(true);
    expect(getPersistedDockCollapsed(false)).toBe(true);

    expect(getPersistedDensity()).toBeNull();
    setPersistedDensity("compact");
    expect(getPersistedDensity()).toBe("compact");

    expect(getPersistedFocusMode(false)).toBe(false);
    setPersistedFocusMode(true);
    expect(getPersistedFocusMode(false)).toBe(true);
  });

  it("handles localStorage throwing on reads without crashing and returns fallbacks", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Access denied by security settings", "SecurityError");
    });

    expect(getPersistedExplorerWidth(240)).toBe(240);
    expect(getPersistedDockWidth(380)).toBe(380);
    expect(getPersistedExplorerCollapsed(false)).toBe(false);
    expect(getPersistedDockCollapsed(true)).toBe(true);
    expect(getPersistedDensity()).toBeNull();
    expect(getPersistedFocusMode(false)).toBe(false);
  });

  it("handles localStorage throwing on writes without crashing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    expect(() => setPersistedExplorerWidth(300)).not.toThrow();
    expect(() => setPersistedDockWidth(400)).not.toThrow();
    expect(() => setPersistedExplorerCollapsed(true)).not.toThrow();
    expect(() => setPersistedDockCollapsed(true)).not.toThrow();
    expect(() => setPersistedDensity("comfortable")).not.toThrow();
    expect(() => setPersistedFocusMode(true)).not.toThrow();
  });
});
