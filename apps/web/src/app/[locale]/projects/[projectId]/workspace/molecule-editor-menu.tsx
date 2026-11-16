"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import styles from "./molecule-editor.module.css";

export type PopMenuItem = { id: string; label: string; disabled?: boolean; onSelect: () => void };

/** A small disclosure menu (closes on Escape, outside click and selection). Blueprint Popover is not needed for three entries. */
export function PopMenu({ label, glyph, items, disabled, testId, variant = "button", up = false, alignEnd = false, side = false }: {
  label: string;
  glyph?: ReactNode;
  items: readonly PopMenuItem[];
  disabled?: boolean;
  testId?: string;
  variant?: "button" | "tool";
  up?: boolean;
  alignEnd?: boolean;
  /** Open beside the trigger with fixed positioning, so a scrolling rail does not clip the menu. */
  side?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [fixedPos, setFixedPos] = useState<CSSProperties | undefined>(undefined);
  const host = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (host.current && !host.current.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [open]);

  return (
    <div className={styles.menuHost} ref={host}>
      <button
        ref={trigger}
        type="button"
        className={variant === "tool" ? styles.tool : styles.menuButton}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        disabled={disabled}
        data-testid={testId}
        onClick={() => {
          if (side && !open && trigger.current) {
            const r = trigger.current.getBoundingClientRect();
            setFixedPos({ position: "fixed", left: r.right + 4, top: Math.max(4, Math.min(r.top, window.innerHeight - 240)), margin: 0 });
          }
          setOpen((value) => !value);
        }}
      >
        {variant === "tool" ? <>{glyph}<span className={styles.toolLabel}>{label}</span></> : <>{label} ▾</>}
      </button>
      {open ? (
        <ul className={`${styles.menu}${up ? ` ${styles.menuUp}` : ""}${alignEnd ? ` ${styles.menuAlignEnd}` : ""}`} role="menu" aria-label={label} style={side ? fixedPos : undefined}>
          {items.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                disabled={item.disabled}
                data-testid={`${testId ?? "menu"}-${item.id}`}
                onClick={() => { setOpen(false); item.onSelect(); }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * A non-modal disclosure panel (info text, import form). Closes on Escape, outside pointer and when focus leaves; Escape returns focus to the trigger.
 * While open it marks itself with data-editor-popover-open so the editor's Escape (leave focus mode) does not also fire.
 */
export function Popover({ label, panelLabel, iconOnly = false, wide = false, disabled, testId, panelTestId, open: controlledOpen, onOpenChange, children }: {
  label: string;
  panelLabel?: string;
  iconOnly?: boolean;
  wide?: boolean;
  disabled?: boolean;
  testId: string;
  panelTestId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = useCallback((value: boolean) => { setInnerOpen(value); onOpenChange?.(value); }, [onOpenChange]);
  const host = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (host.current && !host.current.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [open, setOpen]);

  return (
    <div className={styles.menuHost} ref={host} {...(open ? { "data-editor-popover-open": "" } : {})}>
      <button
        ref={trigger}
        type="button"
        className={iconOnly ? styles.infoButton : styles.textButton}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={iconOnly ? label : undefined}
        title={label}
        disabled={disabled}
        data-testid={testId}
        onClick={() => setOpen(!open)}
      >
        {iconOnly ? <span aria-hidden="true">i</span> : <>{label} ▾</>}
      </button>
      {open ? (
        <div className={`${styles.popover}${wide ? ` ${styles.popoverWide}` : ""}`} role="dialog" aria-label={panelLabel ?? label} data-testid={panelTestId}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
