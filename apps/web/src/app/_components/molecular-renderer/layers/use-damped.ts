import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useRef, type RefObject } from "react";

import { damp } from "./damp";

/**
 * A presentation value (opacity, fade) that chases `target` exponentially. It restarts from `restart` whenever
 * `resetKey` changes, and keeps the demand-driven render loop alive only while it is moving.
 */
export function useDampedRef(target: number, options: { lambda?: number; initial?: number; restart?: number; resetKey?: unknown; immediate?: boolean } = {}): RefObject<number> {
  const { lambda = 8, initial = target, restart = 0, resetKey, immediate = false } = options;
  const value = useRef(initial);
  const invalidate = useThree((state) => state.invalidate);
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) first.current = false;
    else value.current = restart;
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when the reset key changes
  }, [resetKey]);
  useLayoutEffect(() => {
    if (immediate) value.current = target;
    invalidate();
  }, [target, immediate, invalidate]);
  useFrame((_, delta) => {
    if (immediate) return;
    if (Math.abs(value.current - target) < 2e-3) {
      value.current = target;
      return;
    }
    value.current = damp(value.current, target, lambda, delta);
    invalidate();
  });
  return value;
}
