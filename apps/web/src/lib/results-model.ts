import { displayUnit, formatDisplayValue } from "./quantity-format";
import type { Locale } from "@chemdft/i18n";
import type { OverviewRow, PublishedResultsPage } from "@chemdft/schemas";
import { projectPath } from "./routes";
import { levelOfTheory, standingOf, taskLabel } from "./overview-view";

/**
 * Presentation rules for the Results Library. Every scientific judgement (standing, validation, verification, units,
 * the stored values) is the server's; this module only decides what to show first and how to word it.
 */

export type LibraryMode = "loading" | "empty" | "single" | "multiple";

/**
 * One published result → a featured summary; two or more → a professional table; none → a helpful empty state.
 * The mode follows the server's exact count of ALL published results (never the filtered or loaded count), so
 * filtering a long table can never turn it into a featured card or an empty state.
 */
export function libraryMode(page: Pick<PublishedResultsPage, "total_published"> | null): LibraryMode {
  if (page === null) return "loading";
  return page.total_published === 0 ? "empty" : page.total_published === 1 ? "single" : "multiple";
}

export type EmptyBreakdown = {
  /** One sentence naming which of the situations applies. */
  headline: string;
  detail: string;
};

export type JobsSummary = {
  /** Published scientific results in the project (every stored result record), exact and server-counted. */
  published: number;
  /** Published results matching the current filters. */
  matching: number;
  /** Calculation records in the project, as reported by the server (never a count of results). */
  calculations: number;
  /** Calculations with no published result, split by what became of them; execution detail belongs to Jobs. */
  withoutResult: number;
  pending: number;
  failed: number;
  canceled: number;
  noResult: number;
};

/**
 * Keeps the three things apart that must never be conflated: published results, calculation records, and calculations
 * that produced no published result. Every number is the server's exact count over the whole project.
 */
export function jobsSummary(page: Pick<PublishedResultsPage, "total_published" | "total_matching" | "total_calculations" | "without_result"> | null): JobsSummary {
  const without = page?.without_result;
  const pending = without?.pending ?? 0, failed = without?.failed ?? 0, canceled = without?.canceled ?? 0, noResult = without?.no_result ?? 0;
  return {
    published: page?.total_published ?? 0,
    matching: page?.total_matching ?? 0,
    calculations: page?.total_calculations ?? 0,
    withoutResult: pending + failed + canceled + noResult,
    pending, failed, canceled, noResult,
  };
}

/** Distinguishes: no calculations, pending jobs, failed jobs, and calculations that finished without a published result. */
export function emptyBreakdown(summary: JobsSummary): EmptyBreakdown {
  if (summary.calculations === 0) {
    return { headline: "No calculations in this project yet", detail: "Run a calculation from the workspace. Its published result will appear here once the platform has validated it." };
  }
  if (summary.pending > 0) {
    return {
      headline: `${summary.pending} calculation${summary.pending === 1 ? " is" : "s are"} still in progress`,
      detail: "Nothing has been published yet. A result appears here only after the calculation succeeds and the platform validates its output.",
    };
  }
  if (summary.failed > 0 && summary.failed === summary.calculations) {
    return {
      headline: `${summary.failed === 1 ? "The calculation" : `All ${summary.failed} calculations`} failed`,
      detail: "A failed calculation publishes no result and nothing is substituted. The recorded reason is in Jobs; adjust the settings and run again.",
    };
  }
  if (summary.noResult > 0) {
    return {
      headline: `${summary.noResult} calculation${summary.noResult === 1 ? "" : "s"} finished without a published result`,
      detail: "The calculation record exists but the platform published no scientific result for it. Jobs has its execution record.",
    };
  }
  return { headline: "No published results yet", detail: "Calculations in this project were canceled or failed, so there is no scientific result to show." };
}

/** One sentence for the compact Jobs pointer; null when every calculation has a published result. */
export function jobsPointerText(summary: JobsSummary): string | null {
  if (summary.withoutResult === 0) return null;
  const parts = [
    summary.pending ? `${summary.pending} in progress` : null,
    summary.failed ? `${summary.failed} failed` : null,
    summary.canceled ? `${summary.canceled} canceled` : null,
    summary.noResult ? `${summary.noResult} finished without a published result` : null,
  ].filter((part): part is string => part !== null);
  return `${summary.withoutResult} calculation${summary.withoutResult === 1 ? "" : "s"} ${summary.withoutResult === 1 ? "has" : "have"} no published result (${parts.join(", ")}).`;
}

// ---------------------------------------------------------------------------------------------------------------
// Primary quantity wording
// ---------------------------------------------------------------------------------------------------------------

/**
 * The server labels the stored quantity "Total electronic energy". For a single-point SCF energy that is ambiguous:
 * PySCF's SCF total energy includes the nuclear repulsion and is not the electronic-only component. The wording
 * below names the quantity precisely; the stored value and unit are never touched.
 */
export function energyQuantityLabel(input: { engine?: string | null | undefined; method?: string | null | undefined }): { label: string; note: string | null } {
  const engine = (input.engine ?? "").toLowerCase();
  const method = (input.method ?? "").toLowerCase();
  const name = engine === "xtb" || method.startsWith("gfn") ? "GFN2-xTB" : method === "hf" ? "Hartree–Fock" : method === "mp2" ? "MP2" : method ? method.toUpperCase() : "";
  if (engine === "xtb" || method.startsWith("gfn")) {
    return { label: `${name} total energy`, note: "Semi-empirical energy on the GFN2-xTB scale; not comparable with ab initio total energies." };
  }
  if (method === "mp2") return { label: "MP2 total energy", note: "Includes the Hartree–Fock reference and the MP2 correlation energy." };
  return {
    label: `${name ? `${name} ` : ""}total energy`.trim().replace(/^./, (c) => c.toUpperCase()),
    note: engine === "pyscf" ? "SCF total energy; it includes nuclear repulsion and is not the electronic-only component." : null,
  };
}

export const HARTREE_TO_EV = 27.211386245988; // CODATA 2018
export const HARTREE_TO_KCAL_PER_MOL = 627.5094740631; // CODATA 2018 (Eh × N_A × 1 cal^-1 conversion)

/** Derived representations of a stored energy in hartree. Only valid for the unit "Eh"; anything else returns null. */
export function derivedEnergyUnits(value: number, unit: string): { eV: string; kcalPerMol: string } | null {
  if (!["Eh", "HARTREE", "hartree"].includes(unit) || !Number.isFinite(value)) return null;
  return { eV: (value * HARTREE_TO_EV).toFixed(4), kcalPerMol: (value * HARTREE_TO_KCAL_PER_MOL).toFixed(2) };
}

/** The stored value at readable precision (10 decimals for hartree); the full stored value stays available in details. */
export function formatStoredValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return "—";
  const hartree = ["Eh", "HARTREE", "hartree"].includes(unit);
  return hartree ? value.toFixed(10) : value.toPrecision(10).replace(/\.?0+$/, "");
}

export function unitLabel(unit: string): string {
  return ["HARTREE", "hartree"].includes(unit) ? "Eh" : displayUnit(unit);
}

/** One-line level-of-theory + engine for tables and headers, from the overview row only. */
export function rowLevel(row: OverviewRow): { level: string; engine: string; electronic: string } {
  return {
    level: levelOfTheory(row),
    engine: [row.engine, row.engine_version].filter(Boolean).join(" ") || "engine not recorded",
    electronic: `charge ${row.charge ?? "?"} · 2S+1 ${row.multiplicity ?? "?"}`,
  };
}

/** The primary stored quantity of a row with the precise label; null when the result type stores no scalar. */
export function rowPrimaryQuantity(row: OverviewRow): { value: number; valueText: string; fullValueText: string; unit: string; text: string; label: string; note: string | null; isEnergy: boolean } | null {
  const quantity = row.quantities?.[0];
  if (!quantity) return null;
  const isEnergy = /energy/i.test(quantity.kind) || /energy/i.test(quantity.label);
  const wording = isEnergy ? energyQuantityLabel({ engine: row.engine, method: row.method }) : { label: quantity.label, note: null };
  const unit = unitLabel(quantity.unit);
  return {
    value: quantity.value, valueText: formatDisplayValue(quantity.value, quantity.unit), fullValueText: formatStoredValue(quantity.value, quantity.unit), unit, isEnergy, label: wording.label, note: wording.note,
    text: `${formatDisplayValue(quantity.value, quantity.unit)}${unit ? ` ${unit}` : ""}`,
  };
}

export { standingOf, taskLabel };

// ---------------------------------------------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------------------------------------------

/** The Results-owned detail page for one published result. The older workspace deep links keep working. */
export function resultDetailHref(locale: Locale, projectId: string, resultId: string, section?: InspectorSection): string {
  const base = projectPath(locale, projectId, `results/${encodeURIComponent(resultId)}`);
  return section ? `${base}?section=${section}` : base;
}

export const INSPECTOR_SECTIONS = ["provenance", "evidence", "coordinates", "artifacts", "export"] as const;
export type InspectorSection = (typeof INSPECTOR_SECTIONS)[number];

export function parseSection(value: string | null | undefined): InspectorSection | null {
  return INSPECTOR_SECTIONS.find((section) => section === value) ?? null;
}
