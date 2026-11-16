/**
 * Safe persistence for workspace layout dimensions, collapsed states, density, and focus mode.
 * Every read and write is wrapped in try/catch to ensure the workspace renders and functions
 * completely normally even when localStorage is blocked, throws (private browsing / iframe),
 * or is unavailable.
 */

export const STORAGE_KEYS = {
  EXPLORER_WIDTH: "chemdft:explorer-width",
  DOCK_WIDTH: "chemdft:dock-width",
  EXPLORER_COLLAPSED: "chemdft:explorer-collapsed",
  DOCK_COLLAPSED: "chemdft:dock-collapsed",
  DENSITY: "chemdft:density-preference",
  FOCUS_MODE: "chemdft:focus-mode",
} as const;

export type DensityPreference = "comfortable" | "compact";

export function getPersistedExplorerWidth(fallback: number): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.EXPLORER_WIDTH);
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 120 && parsed <= 600 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function setPersistedExplorerWidth(width: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEYS.EXPLORER_WIDTH, String(Math.round(width)));
  } catch {
    /* safely ignored */
  }
}

export function getPersistedDockWidth(fallback: number): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.DOCK_WIDTH);
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 200 && parsed <= 800 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function setPersistedDockWidth(width: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEYS.DOCK_WIDTH, String(Math.round(width)));
  } catch {
    /* safely ignored */
  }
}

export function getPersistedExplorerCollapsed(fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.EXPLORER_COLLAPSED);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

export function setPersistedExplorerCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEYS.EXPLORER_COLLAPSED, String(collapsed));
  } catch {
    /* safely ignored */
  }
}

export function getPersistedDockCollapsed(fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.DOCK_COLLAPSED);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

export function setPersistedDockCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEYS.DOCK_COLLAPSED, String(collapsed));
  } catch {
    /* safely ignored */
  }
}

export function getPersistedDensity(): DensityPreference | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.DENSITY) ?? window.localStorage.getItem("chemdft:density");
    if (raw === "comfortable" || raw === "compact") return raw;
    return null;
  } catch {
    return null;
  }
}

export function setPersistedDensity(density: DensityPreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEYS.DENSITY, density);
    window.localStorage.setItem("chemdft:density", density);
  } catch {
    /* safely ignored */
  }
}

export function getPersistedFocusMode(fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.FOCUS_MODE);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

export function setPersistedFocusMode(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEYS.FOCUS_MODE, String(enabled));
  } catch {
    /* safely ignored */
  }
}

