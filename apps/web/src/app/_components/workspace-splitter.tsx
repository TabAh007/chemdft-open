"use client";

import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import styles from "./workspace-splitter.module.css";

export interface WorkspaceSplitterProps {
  id: string;
  label: string;
  side: "left" | "right";
  width: number;
  minWidth: number;
  maxWidth: number;
  collapsed: boolean;
  onWidthChange: (newWidth: number) => void;
  onToggleCollapse: () => void;
  disabled?: boolean;
}

/**
 * Accessible, keyboard-navigable, draggable pane splitter.
 * Implements WAI-ARIA role="separator" with orientation, value limits,
 * keyboard stepping (Arrow keys, Home, End, Enter/Space), and pointer capture.
 */
export function WorkspaceSplitter({
  id,
  label,
  side,
  width,
  minWidth,
  maxWidth,
  collapsed,
  onWidthChange,
  onToggleCollapse,
  disabled = false,
}: WorkspaceSplitterProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (disabled || e.button !== 0) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragStartRef.current = { startX: e.clientX, startWidth: collapsed ? minWidth : width };
      setIsDragging(true);
    },
    [disabled, collapsed, minWidth, width],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!isDragging || !dragStartRef.current) return;
      const deltaX = e.clientX - dragStartRef.current.startX;
      const direction = side === "left" ? 1 : -1;
      const targetWidth = dragStartRef.current.startWidth + deltaX * direction;

      if (targetWidth < minWidth * 0.65) {
        if (!collapsed) onToggleCollapse();
        return;
      }

      if (collapsed && targetWidth >= minWidth) {
        onToggleCollapse();
      }

      const clamped = Math.max(minWidth, Math.min(maxWidth, targetWidth));
      onWidthChange(clamped);
    },
    [isDragging, side, minWidth, maxWidth, collapsed, onToggleCollapse, onWidthChange],
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* safely ignore pointer release */
      }
      setIsDragging(false);
      dragStartRef.current = null;
    },
    [isDragging],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      const step = e.shiftKey ? 50 : 10;
      const current = collapsed ? minWidth : width;

      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onToggleCollapse();
        return;
      }

      if (e.key === "Home") {
        e.preventDefault();
        onWidthChange(minWidth);
        return;
      }

      if (e.key === "End") {
        e.preventDefault();
        onWidthChange(maxWidth);
        return;
      }

      let delta = 0;
      if (e.key === "ArrowLeft") delta = side === "left" ? -step : step;
      else if (e.key === "ArrowRight") delta = side === "left" ? step : -step;

      if (delta !== 0) {
        e.preventDefault();
        const next = Math.max(minWidth, Math.min(maxWidth, current + delta));
        onWidthChange(next);
      }
    },
    [disabled, collapsed, minWidth, width, maxWidth, side, onToggleCollapse, onWidthChange],
  );

  return (
    <div
      id={id}
      role="separator"
      tabIndex={disabled ? -1 : 0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={collapsed ? 0 : Math.round(width)}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-disabled={disabled}
      className={`${styles.splitter} ${styles[side]} ${isDragging ? styles.dragging : ""} ${
        collapsed ? styles.collapsed : ""
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      onDoubleClick={onToggleCollapse}
      title={`${label} · Drag or use arrow keys to resize, Enter to toggle collapse`}
    >
      <div className={styles.handle} aria-hidden="true" />
    </div>
  );
}

