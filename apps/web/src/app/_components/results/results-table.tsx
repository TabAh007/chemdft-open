"use client";

import Link from "next/link";
import type { Locale } from "@chemdft/i18n";
import type { OverviewRow } from "@chemdft/schemas";
import { MAX_SELECTION } from "@/lib/comparison-view";
import { standingOf, standingText, taskLabel, verificationText, VISUALIZATION_LABEL, type SortDirection, type SortKey } from "@/lib/overview-view";
import { resultDetailHref, rowLevel, rowPrimaryQuantity } from "@/lib/results-model";
import { ScientificTimestamp } from "../scientific-timestamp";
import { RowActionsMenu, rowActions, rowMenuLabel } from "./row-actions";
import { Tag } from "./results-parts";
import styles from "./results-ui.module.css";

const COLUMNS: { key: SortKey | null; label: string; cls?: string }[] = [
  { key: "task", label: "Scientific result" },
  { key: "formula", label: "Structure", cls: styles.hideNarrow ?? "" },
  { key: "engine", label: "Method · engine" },
  { key: "energy", label: "Primary stored quantity" },
  { key: null, label: "Standing" },
  { key: "updated", label: "Updated", cls: styles.hideMid ?? "" },
];

/**
 * A compact table of published scientific results. Every row is backed by a stored result record; calculations without
 * one are Jobs' concern and never appear here. Inspect is the one visible action; the rest live in a row menu and only
 * when they apply and the caller may use them. Selection feeds Compare and reports (compatibility is checked there).
 */
export function ResultsTable({ rows, locale, projectId, sort, onSort, ticked, onTick, onReuse, canWrite }: {
  rows: readonly OverviewRow[];
  locale: Locale;
  projectId: string;
  sort: { key: SortKey; direction: SortDirection };
  onSort: (key: SortKey) => void;
  ticked: readonly string[];
  onTick: (resultId: string) => void;
  onReuse: (calculationId: string) => void;
  canWrite: boolean | null;
}) {
  return (
    <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Published results table, scrollable">
      <table className={styles.table} data-testid="results-table">
        <caption className={styles.visuallyHidden}>Published scientific results in this project, sorted by {sort.key} {sort.direction === "asc" ? "ascending" : "descending"}</caption>
        <thead>
          <tr>
            <th scope="col"><span className={styles.visuallyHidden}>Select for comparison or report</span></th>
            {COLUMNS.map((column) => (
              <th key={column.label} scope="col" className={column.cls || undefined} aria-sort={column.key && sort.key === column.key ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}>
                {column.key ? <button type="button" className={styles.sortButton} onClick={() => onSort(column.key as SortKey)} data-testid={`results-sort-${column.key}`}>{column.label}</button> : column.label}
              </th>
            ))}
            <th scope="col"><span className={styles.visuallyHidden}>Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const standing = standingOf(row);
            const quantity = rowPrimaryQuantity(row);
            const level = rowLevel(row);
            const resultId = row.result_id!;
            const isTicked = ticked.includes(resultId);
            const label = rowMenuLabel(row);
            return (
              <tr key={resultId} data-testid="results-row" data-calculation-id={row.calculation_id} data-result-id={resultId} data-standing={standing} data-selected={isTicked} title={`Result ${resultId} · calculation ${row.calculation_id}`}>
                <td>
                  <input type="checkbox" checked={isTicked} disabled={!isTicked && ticked.length >= MAX_SELECTION} onChange={() => onTick(resultId)}
                    aria-label={`Select ${label}, ${level.level}`} data-testid="results-select" />
                </td>
                <td>
                  <div className={styles.cellMain}>{taskLabel(row.task)}</div>
                  {(row.visualizations ?? []).length > 0 ? <div className={styles.cellSub} data-testid="results-viz">{(row.visualizations ?? []).map((v) => VISUALIZATION_LABEL[v] ?? v).join(" · ")}</div> : null}
                </td>
                <td className={styles.hideNarrow}>
                  <div>{row.structure_name ?? "—"}{row.structure_revision ? <span className={styles.muted}> · V{row.structure_revision}</span> : null}</div>
                  <div className={styles.cellSub}>{row.formula_hill ?? "—"}{row.atom_count ? ` · ${row.atom_count} atoms` : ""}</div>
                </td>
                <td>
                  <div>{level.level}</div>
                  <div className={styles.cellSub}>{level.engine} · {level.electronic}</div>
                </td>
                <td>
                  {quantity ? (
                    <>
                      <div className={styles.num} data-testid="results-quantity">{quantity.text}</div>
                      <div className={styles.cellSub}>{quantity.label}</div>
                    </>
                  ) : <span className={styles.muted}>—</span>}
                </td>
                <td>
                  {standing === "current" ? <Tag intent="success">Current</Tag> : <Tag intent="warning">{standingText(row)}</Tag>}
                  <div className={styles.cellSub}>{verificationText(row)}</div>
                </td>
                <td className={`${styles.cellSub} ${styles.hideMid}`}><ScientificTimestamp value={row.updated_at} /></td>
                <td className={styles.actionsCell}>
                  <span className={styles.rowTools}>
                    <Link className={styles.secondaryAction} href={resultDetailHref(locale, projectId, resultId)} data-testid="results-open" aria-label={`Inspect result: ${label}, ${level.level}`}>Inspect result</Link>
                    <RowActionsMenu label={label} actions={rowActions(row, locale, projectId, canWrite, () => onReuse(row.calculation_id))} />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
