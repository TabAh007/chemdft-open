import { useLayoutEffect, useRef, type MutableRefObject } from "react";

/**
 * A ref that always holds the latest value, for event handlers and effects that must not re-subscribe on every change.
 * It is updated in a layout effect (after render, before any passive effect and before the browser can deliver an
 * event), so nothing is written to a ref during render.
 */
export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
