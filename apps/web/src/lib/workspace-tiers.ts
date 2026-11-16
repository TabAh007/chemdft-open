"use client";

import { useEffect, useState, type RefObject } from "react";

export type WidthTier = "wide" | "medium" | "narrow";

export const WIDTH_TIER_WIDE_MIN = 1500;
export const WIDTH_TIER_MEDIUM_MIN = 1100;

export const DEFAULT_EXPLORER_WIDTH = 240;
export const DEFAULT_EXPLORER_RAIL_WIDTH = 48;
export const DEFAULT_AI_DOCK_WIDTH_WIDE = 380;
export const DEFAULT_AI_DOCK_WIDTH_MEDIUM = 300;
export const DRAWER_PANEL_WIDTH = 400;

export const COMPACT_MAX_WIDTH = 1024;
export const COMPACT_MAX_HEIGHT = 700;
export const HARD_MIN_WIDTH = 1024;
export const HARD_MIN_HEIGHT = 600;

/**
 * Returns the width tier corresponding to a given pixel width:
 * - >= 1500: "wide"
 * - 1100 - 1499: "medium"
 * - < 1100: "narrow"
 */
export function getTierForWidth(width: number): WidthTier {
  if (width >= WIDTH_TIER_WIDE_MIN) return "wide";
  if (width >= WIDTH_TIER_MEDIUM_MIN) return "medium";
  return "narrow";
}

/**
 * Identifies compact viewports (such as 1024x600 or height under 700px)
 * where vertical density and compact toolbar modes are activated automatically.
 */
export function isCompactViewport(width: number, height: number): boolean {
  return width <= COMPACT_MAX_WIDTH || height <= COMPACT_MAX_HEIGHT;
}

export interface WorkspaceTierState {
  tier: WidthTier;
  width: number;
  height: number;
  isCompact: boolean;
  isNarrow: boolean;
  isMedium: boolean;
  isWide: boolean;
}

/**
 * Observes container width and height (falling back to window dimensions) to determine
 * the active responsive tier and compact state.
 */
export function useWorkspaceTier(containerRef?: RefObject<HTMLElement | null>): WorkspaceTierState {
  const [state, setState] = useState<WorkspaceTierState>(() => {
    if (typeof window === "undefined") {
      return {
        tier: "wide",
        width: 1600,
        height: 900,
        isCompact: false,
        isNarrow: false,
        isMedium: false,
        isWide: true,
      };
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    const tier = getTierForWidth(w);
    return {
      tier,
      width: w,
      height: h,
      isCompact: isCompactViewport(w, h),
      isNarrow: tier === "narrow",
      isMedium: tier === "medium",
      isWide: tier === "wide",
    };
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const measure = () => {
      const el = containerRef?.current;
      const w = el ? el.clientWidth : window.innerWidth;
      const h = el ? el.clientHeight : window.innerHeight;
      const tier = getTierForWidth(w);
      setState({
        tier,
        width: w,
        height: h,
        isCompact: isCompactViewport(w, h),
        isNarrow: tier === "narrow",
        isMedium: tier === "medium",
        isWide: tier === "wide",
      });
    };

    measure();

    let resizeObserver: ResizeObserver | null = null;
    if (containerRef?.current && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => measure());
      resizeObserver.observe(containerRef.current);
    }

    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      resizeObserver?.disconnect();
    };
  }, [containerRef]);

  return state;
}

