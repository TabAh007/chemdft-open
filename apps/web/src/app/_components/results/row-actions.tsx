"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AppIcon, AppPopover } from "@chemdft/ui";
import type { Locale } from "@chemdft/i18n";
import type { OverviewRow } from "@chemdft/schemas";
import { compareHref, jobsHref, taskLabel } from "@/lib/overview-view";
import { resultDetailHref } from "@/lib/results-model";
import styles from "./results-ui.module.css";

export type RowAction = { key: string; label: string; href?: string; onSelect?: () => void };

/** Only actions that apply to this row and that the caller may use; nothing is offered speculatively. */
export function rowActions(row: Pick<OverviewRow, "result_id" | "job_id">, locale: Locale, projectId: string, canWrite: boolean | null, onReuse: () => void): RowAction[] {
  const actions: RowAction[] = [];
  if (row.result_id) {
    actions.push({ key: "compare", label: "Compare…", href: compareHref(locale, projectId, [row.result_id]) });
    actions.push({ key: "export", label: "Export & reports", href: resultDetailHref(locale, projectId, row.result_id, "export") });
    actions.push({ key: "provenance", label: "Provenance & evidence", href: resultDetailHref(locale, projectId, row.result_id, "provenance") });
  }
  if (row.job_id) actions.push({ key: "job", label: "View job", href: jobsHref(locale, projectId) });
  if (canWrite === true) actions.push({ key: "reuse", label: "Reuse settings", onSelect: onReuse });
  return actions;
}

/** A compact accessible actions menu for one result row. Inspect stays the visible primary action beside it. */
export function RowActionsMenu({ actions, label }: { actions: readonly RowAction[]; label: string }) {
  const [open, setOpen] = useState(false);
  const first = useRef<HTMLElement | null>(null);
  useEffect(() => { if (open) window.setTimeout(() => first.current?.focus(), 0); }, [open]);
  if (actions.length === 0) return null;
  const move = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") { event.preventDefault(); items[(at + 1) % items.length]?.focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
    else if (event.key === "Home") { event.preventDefault(); items[0]?.focus(); }
    else if (event.key === "End") { event.preventDefault(); items[items.length - 1]?.focus(); }
  };
  return (
    <AppPopover
      isOpen={open} onInteraction={(next) => setOpen(next)} placement="bottom-end"
      content={
        <ul className={styles.menu} role="menu" aria-label={label} onKeyDown={move} data-testid="row-menu">
          {actions.map((action, index) => (
            <li key={action.key} role="none">
              {action.href
                ? <Link role="menuitem" className={styles.menuItem} href={action.href} data-action={action.key} onClick={() => setOpen(false)} ref={index === 0 ? (node) => { first.current = node; } : undefined}>{action.label}</Link>
                : <button type="button" role="menuitem" className={styles.menuItem} data-action={action.key} onClick={() => { setOpen(false); action.onSelect?.(); }} ref={index === 0 ? (node) => { first.current = node; } : undefined}>{action.label}</button>}
            </li>
          ))}
        </ul>
      }
    >
      <button type="button" className={styles.kebab} aria-haspopup="menu" aria-expanded={open} aria-label={`More actions for ${label}`} data-testid="row-actions">
        <AppIcon icon="more" />
      </button>
    </AppPopover>
  );
}

export function rowMenuLabel(row: OverviewRow): string {
  return `${taskLabel(row.task)} of ${row.formula_hill ?? row.structure_name ?? "structure"}`;
}
