import { displayUnit, formatDisplayValue, formatEnergyEh } from "./quantity-format";

const isEnergyEh = (unit: string): boolean => ["Eh", "E_h", "HARTREE", "hartree"].includes(unit);
import type { Locale } from "@chemdft/i18n";
import type { OverviewRow } from "@chemdft/schemas";

import { calculationWorkspacePath, resultWorkspacePath } from "./job-view";
import { projectPath } from "./routes";

/** Presentation rules for the project results overview. Every scientific judgement is server-side. */

export type OverviewFilters = {
  text: string;
  task: string;
  engine: string;
  standing: "all" | "current" | "historical" | "none";
  state: string;
};

export const EMPTY_FILTERS: OverviewFilters = { text: "", task: "ALL", engine: "ALL", standing: "all", state: "ALL" };

export type SortKey = "updated" | "task" | "engine" | "formula" | "energy";
export type SortDirection = "asc" | "desc";

export const TASK_LABEL: Record<string, string> = {
  ENERGY: "Single-point energy",
  GEOMETRY_OPTIMIZATION: "Geometry optimization",
  FREQUENCY: "Vibrational frequencies",
  ORBITAL: "Molecular orbitals",
  TDDFT: "TDDFT excited states",
  THERMOCHEMISTRY: "Thermochemistry",
  CONFORMER_SEARCH: "Conformer search",
  PERIODIC_ENERGY: "Periodic single-point energy",
};

export const VISUALIZATION_LABEL: Record<string, string> = {
  trajectory: "Optimization trajectory",
  "ir-spectrum": "IR spectrum",
  "raman-spectrum": "Raman spectrum",
  "uv-vis-spectrum": "UV-Vis spectrum",
  "molecular-orbitals": "Molecular orbitals",
  "electron-density": "Electron density",
  thermochemistry: "Thermochemistry",
  conformers: "Conformers",
};

export function taskLabel(task: string): string {
  return TASK_LABEL[task] ?? task;
}

/** Standing is only ever "current" when the server said so; no result is its own state. */
export function standingOf(row: Pick<OverviewRow, "evidence_use">): "current" | "historical" | "none" {
  if (row.evidence_use === "CURRENT") return "current";
  if (row.evidence_use === "NO_RESULT") return "none";
  return "historical"; // HISTORICAL_ONLY and UNKNOWN both fail closed
}

export function standingText(row: Pick<OverviewRow, "evidence_use" | "effective_state">): string {
  switch (standingOf(row)) {
    case "current": return "Current";
    case "none": return "No result";
    default:
      return row.evidence_use === "UNKNOWN"
        ? "Standing unknown"
        : `Historical · ${(row.effective_state?.source_lineage_validity ?? "inactive").toLowerCase()}`;
  }
}

export function verificationText(row: Pick<OverviewRow, "effective_state">): string {
  const state = row.effective_state?.verification_state;
  if (!state) return "—";
  return state === "UNVERIFIED" ? "Not independently verified" : state === "VERIFIED" ? "Independently verified" : state.toLowerCase().replaceAll("_", " ");
}

export function levelOfTheory(row: Pick<OverviewRow, "method" | "basis" | "dispersion">): string {
  const level = [row.method, row.basis].filter(Boolean).join(" / ") || "not recorded";
  return row.dispersion ? `${level} + ${row.dispersion}` : level;
}

export function headline(row: Pick<OverviewRow, "quantities">): { text: string; label: string; full: string } | null {
  const quantity = row.quantities?.[0];
  if (!quantity) return null;
  // Display rounding only (precision policy); `full` is the stored value for the tooltip.
  return {
    text: `${isEnergyEh(quantity.unit) ? formatEnergyEh(quantity.value) : formatDisplayValue(quantity.value, quantity.unit)} ${displayUnit(quantity.unit)}`.trim(),
    label: quantity.label,
    full: `${quantity.value} ${quantity.unit === "1" ? "" : quantity.unit}`.trim(),
  };
}

export function filterRows(rows: readonly OverviewRow[], filters: OverviewFilters): OverviewRow[] {
  const needle = filters.text.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.task !== "ALL" && row.task !== filters.task) return false;
    if (filters.engine !== "ALL" && row.engine !== filters.engine) return false;
    if (filters.state !== "ALL" && row.calculation_state !== filters.state) return false;
    if (filters.standing !== "all" && standingOf(row) !== filters.standing) return false;
    if (!needle) return true;
    const haystack = [
      row.structure_name, row.formula_hill, row.method, row.basis, levelOfTheory(row), row.engine, taskLabel(row.task),
      row.calculation_id, row.result_id, row.calculation_state,
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

export function sortRows(rows: readonly OverviewRow[], key: SortKey, direction: SortDirection): OverviewRow[] {
  const sign = direction === "asc" ? 1 : -1;
  const text = (row: OverviewRow): string => {
    switch (key) {
      case "task": return taskLabel(row.task);
      case "engine": return row.engine ?? "";
      case "formula": return row.formula_hill ?? "";
      default: return row.updated_at;
    }
  };
  return [...rows].sort((a, b) => {
    if (key === "energy") {
      // Energies of different levels of theory are not comparable; sorting only orders the column.
      const av = a.quantities?.[0]?.value;
      const bv = b.quantities?.[0]?.value;
      if (av === undefined && bv === undefined) return 0;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      return (av - bv) * sign;
    }
    return text(a).localeCompare(text(b)) * sign || a.calculation_id.localeCompare(b.calculation_id);
  });
}

export function distinct(rows: readonly OverviewRow[], pick: (row: OverviewRow) => string | null | undefined): string[] {
  return [...new Set(rows.map(pick).filter((v): v is string => Boolean(v)))].sort();
}

export function compareHref(locale: Locale, projectId: string, resultIds: readonly string[]): string {
  const query = new URLSearchParams();
  for (const id of resultIds) query.append("result", id);
  return `${projectPath(locale, projectId, "compare")}?${query.toString()}`;
}

export function savedComparisonHref(locale: Locale, projectId: string, savedId: string): string {
  return `${projectPath(locale, projectId, "compare")}?saved=${encodeURIComponent(savedId)}`;
}

export function jobsHref(locale: Locale, projectId: string): string {
  return projectPath(locale, projectId, "jobs");
}

/** A row with a published result opens that result's viewer; otherwise the calculation record (state, failure). */
export function rowWorkspaceHref(locale: Locale, projectId: string, row: Pick<OverviewRow, "calculation_id" | "result_id">): string {
  return row.result_id
    ? resultWorkspacePath(locale, projectId, row.calculation_id, row.result_id)
    : calculationWorkspacePath(locale, projectId, row.calculation_id);
}

export type ResultContextModel = {
  task: string;
  quantity: { text: string; label: string; full: string } | null;
  engine: string;
  level: string;
  chargeMultiplicity: string;
  structure: string | null;
  standing: "current" | "historical" | "none";
  standingText: string;
  verification: string;
  analyses: string[];
  state: string;
  failure: string | null;
};

/** Researcher-facing summary of one overview row. Every value is the server's stored or judged value. */
export function resultContextModel(row: OverviewRow): ResultContextModel {
  const structure = row.structure_name
    ? [row.structure_name, row.structure_revision ? `V${row.structure_revision}` : null, row.formula_hill].filter(Boolean).join(" · ")
    : row.formula_hill ?? null;
  return {
    task: taskLabel(row.task),
    quantity: headline(row),
    engine: [row.engine, row.engine_version].filter(Boolean).join(" ") || "engine not recorded",
    level: levelOfTheory(row),
    chargeMultiplicity: `${row.charge ?? "?"} / ${row.multiplicity ?? "?"}`,
    structure,
    standing: standingOf(row),
    standingText: standingText(row),
    verification: verificationText(row),
    analyses: (row.visualizations ?? []).map((key) => VISUALIZATION_LABEL[key] ?? key),
    state: row.calculation_state.toLowerCase().replaceAll("_", " "),
    failure: row.failure ?? null,
  };
}

/** Result ids of the rows a researcher ticked, in tick order, restricted to rows that have a result. */
export function selectedResultIds(rows: readonly OverviewRow[], ticked: readonly string[]): string[] {
  const byCalculation = new Map(rows.map((row) => [row.calculation_id, row]));
  return ticked.flatMap((id) => {
    const resultId = byCalculation.get(id)?.result_id;
    return resultId ? [resultId] : [];
  });
}
