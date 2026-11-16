"use client";

import { useState } from "react";
import { AppIcon, AppPopover } from "@chemdft/ui";
import { ExportMenu as UnifiedExportMenu } from "@/app/_components/export/export-menu";
import type { SavedComparisonListOutput } from "@chemdft/schemas";
import styles from "./compare.module.css";

export type ExportKind = "csv" | "json" | "report-html" | "report-markdown" | "report-json";

/** CSV / JSON of the comparison and the HTML / Markdown / JSON report: all existing, server-generated formats of exactly the selected results. */
export function ExportMenu({ disabled, onExport }: { disabled: boolean; onExport: (kind: ExportKind) => void }) {
  return (
    <UnifiedExportMenu
      context="comparison"
      canCompare={!disabled}
      disabled={disabled}
      disabledReason="Select at least two available results"
      onExport={onExport}
    />
  );
}

/** Names the current selection (reference first) and saves it through the existing saved-comparison contract. */
export function SavePopover({ disabled, reason, onSave }: { disabled: boolean; reason?: string | undefined; onSave: (name: string, note: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <AppPopover
      isOpen={open && !disabled} onInteraction={(next) => setOpen(next)} placement="bottom-end"
      content={
        <form
          className={styles.pop} aria-label="Save comparison" data-testid="compare-save-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim() || saving) return;
            setSaving(true);
            void onSave(name.trim(), note.trim()).then((ok) => { setSaving(false); if (ok) { setName(""); setNote(""); setOpen(false); } });
          }}
        >
          <strong>Save this comparison</strong>
          <p className={styles.caption}>Saves exactly these results and their order (the first is the reference). Reopening revalidates every source; nothing is replaced with newer results.</p>
          <label>Name<input type="text" value={name} maxLength={120} autoFocus onChange={(e) => setName(e.currentTarget.value)} placeholder="e.g. Water: basis-set series" data-testid="compare-save-name" /></label>
          <label>Note (optional)<textarea value={note} rows={2} maxLength={500} onChange={(e) => setNote(e.currentTarget.value)} /></label>
          <div><button type="submit" className={styles.primaryAction} disabled={!name.trim() || saving} data-testid="compare-save">{saving ? "Saving…" : "Save comparison"}</button></div>
        </form>
      }
    >
      <button type="button" className={styles.secondaryAction} disabled={disabled} title={disabled ? reason : undefined} aria-haspopup="dialog" aria-expanded={open && !disabled} data-testid="compare-save-open">
        <AppIcon icon="floppy-disk" /> Save<span className={styles.btnLong}> comparison</span>
      </button>
    </AppPopover>
  );
}

/** The saved comparisons of this project: open one (revalidated on the server) or, with write access, archive it. */
export function SavedMenu({ list, canWrite, onOpen, onArchive }: {
  list: SavedComparisonListOutput | null; canWrite: boolean; onOpen: (id: string) => void; onArchive: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const comparisons = list?.availability === "NOT_ACTIVATED" ? [] : (list?.comparisons ?? []).filter((c) => !c.archived);
  return (
    <AppPopover
      isOpen={open} onInteraction={(next) => setOpen(next)} placement="bottom-end"
      content={
        <div className={styles.menu} role="group" aria-label="Saved comparisons" data-testid="saved-list">
          {list?.availability === "NOT_ACTIVATED" ? (
            <p className={styles.pop} role="note" data-testid="saved-not-activated">Saving needs a database migration that has not been applied to this environment. Live comparison is unaffected.</p>
          ) : comparisons.length === 0 ? (
            <p className={styles.pop} data-testid="saved-empty">No saved comparisons yet. Select results, then choose Save comparison.</p>
          ) : comparisons.map((saved) => (
            <div key={saved.id} className={styles.savedRow} data-testid="saved-item">
              <button type="button" className={styles.link} style={{ textAlign: "left" }} onClick={() => { setOpen(false); onOpen(saved.id); }} data-testid="saved-open">{saved.name}</button>
              <span className={styles.caption}>{saved.result_ids.length} results</span>
              {canWrite ? <button type="button" className={styles.link} style={{ gridColumn: "1 / -1", textAlign: "left", fontSize: "0.75rem" }} onClick={() => onArchive(saved.id)} aria-label={`Archive saved comparison ${saved.name}`}>Archive</button> : null}
            </div>
          ))}
        </div>
      }
    >
      <button type="button" className={styles.secondaryAction} aria-haspopup="dialog" aria-expanded={open} data-testid="saved-menu">
        <AppIcon icon="bookmark" /> Saved{comparisons.length > 0 ? ` (${comparisons.length})` : ""}
      </button>
    </AppPopover>
  );
}
