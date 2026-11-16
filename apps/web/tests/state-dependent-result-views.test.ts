import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CalculationDetail, CalculationResult, ThermochemistryResult } from "@chemdft/schemas";
import reference from "./fixtures/thermochemistry-water-b3lyp-def2svp-298k.json";
import { Dftd4CorrectionControl, Dftd4ResultView } from "../src/app/_components/dftd4-correction";
import { ScientificStateStrip } from "../src/app/_components/scientific-state-strip";
import { ThermochemistryAdvancedPanel } from "../src/app/[locale]/projects/[projectId]/workspace/visualization/thermochemistry-advanced-panel";

/**
 * Rendered-label regression tests for views that previously asserted current authority from stored fields.
 * Thermochemistry uses the committed accepted water B3LYP/def2-SVP 298 K payload unmodified. The D4 payload and
 * the result envelopes are presentation fixtures: every numeric expectation below is read back from the fixture
 * object, never typed in, and none of it is scientific acceptance evidence.
 */

type Effective = NonNullable<CalculationResult["effective_state"]>;
type Lineage = Effective["source_lineage_validity"];

const ACTIVE: Effective = {
  stored_authority: "AUTHORITATIVE", stored_validation_state: "VALIDATED", stored_verification_state: "UNVERIFIED",
  authority: "AUTHORITATIVE", validation_state: "VALIDATED", verification_state: "UNVERIFIED",
  source_lineage_validity: "ACTIVE", eligible_for_derivation: true, inactive_result_ids: [], reason: null,
};
// Shape produced by services/api effective_result_state.py for an inactive lineage.
function inactive(lineage: Exclude<Lineage, "ACTIVE">): Effective {
  return {
    ...ACTIVE, authority: "CANDIDATE", validation_state: lineage === "SUPERSEDED" ? "SUPERSEDED" : "DISPUTED",
    source_lineage_validity: lineage, eligible_for_derivation: false,
    inactive_result_ids: ["00000000-0000-4000-8000-000000000001"],
    reason: `Historical result; current source lineage is ${lineage}.`,
  };
}

const SCENARIOS: Array<{ name: string; effective: Effective | undefined; current: boolean }> = [
  { name: "active authoritative", effective: ACTIVE, current: true },
  { name: "retracted", effective: inactive("RETRACTED"), current: false },
  { name: "superseded", effective: inactive("SUPERSEDED"), current: false },
  { name: "disputed", effective: inactive("DISPUTED"), current: false },
  { name: "invalidated", effective: inactive("INVALIDATED"), current: false },
  { name: "missing effective_state", effective: undefined, current: false },
  { name: "explicitly ineligible despite ACTIVE lineage", effective: { ...ACTIVE, eligible_for_derivation: false }, current: false },
  { name: "active lineage but effective authority is not AUTHORITATIVE", effective: { ...ACTIVE, authority: "CANDIDATE" }, current: false },
];

function envelope(payload: unknown, resultType: string, effective: Effective | undefined): CalculationResult {
  return {
    id: "00000000-0000-4000-8000-0000000000aa", project_id: "00000000-0000-4000-8000-0000000000bb",
    calculation_id: "00000000-0000-4000-8000-0000000000cc", calculation_input_id: "00000000-0000-4000-8000-0000000000dd",
    result_type: resultType, payload, authority: "AUTHORITATIVE", validation_state: "VALIDATED", verification_state: "UNVERIFIED",
    source_class: "CALCULATED", producer_software: { name: "pyscf", version: "2.14.0" },
    producer_attestation_id: "attestation-1", provenance_record_id: "provenance-1", raw_artifacts: [],
    created_at: "2026-10-11T05:54:55.867429", ...(effective ? { effective_state: effective } : {}),
  } as unknown as CalculationResult;
}

const strip = (result: CalculationResult) => renderToStaticMarkup(createElement(ScientificStateStrip, { projectId: "p", resultId: result.id, result }));
const flag = (html: string) => /data-currently-authoritative="(true|false)"/.exec(html)?.[1];

describe("advanced thermochemistry never asserts current authority from stored fields", () => {
  const payload = reference as unknown as ThermochemistryResult;
  const gibbs = String(payload.thermodynamics.gibbs_free_energy_hartree);
  const panel = (effective: Effective | undefined) => renderToStaticMarkup(
    createElement(ThermochemistryAdvancedPanel, { result: envelope(payload, "chemdft.thermochemistry", effective) }));

  it.each(SCENARIOS)("$name", ({ effective, current }) => {
    const html = panel(effective);
    expect(flag(html)).toBe(String(current));
    // Recorded scientific values are preserved in every state.
    expect(html).toContain(gibbs);
    expect(html).toContain("Gibbs free energy G (Eh)");
    if (current) {
      expect(html).toContain("Authoritative · Validated · Not independently verified");
      expect(html).not.toContain("thermo-adv-historical");
      expect(html).not.toMatch(/Historical record/);
    } else {
      expect(html).not.toMatch(/Authoritative ·/i);
      expect(html).toContain("thermo-adv-historical");
      expect(html).toContain("must not be used as current results");
      expect(html).toContain(effective ? "Historical record · not currently authoritative" : "Current authority not established");
    }
  });

  it("retains the recorded state of an inactive result and names its lineage", () => {
    const html = panel(inactive("RETRACTED"));
    expect(html).toContain("Historical result · retracted");
    expect(html).toContain("current source lineage is RETRACTED");
    expect(html).toContain("Recorded at publication: AUTHORITATIVE / VALIDATED / UNVERIFIED");
  });

  it.each(SCENARIOS)("header and scientific-state strip cannot contradict: $name", ({ effective }) => {
    const result = envelope(payload, "chemdft.thermochemistry", effective);
    const stripHtml = strip(result);
    const panelHtml = renderToStaticMarkup(createElement(ThermochemistryAdvancedPanel, { result }));
    expect(flag(panelHtml)).toBe(flag(stripHtml));
    // The panel says "Authoritative" only when the strip says so, and the strip's historical headline
    // implies the panel's historical banner.
    if (flag(stripHtml) === "false") {
      expect(panelHtml).not.toMatch(/Authoritative ·/i);
      expect(stripHtml).not.toContain("Authoritative engine result");
    }
  });
});

describe("DFT-D4 correction view fails closed", () => {
  // Presentation fixture. The uncorrected energy is the accepted fixture's electronic energy; the other two values are
  // derived from it so the three displayed energies are mutually consistent without typing any result in.
  const uncorrected = (reference as unknown as ThermochemistryResult).thermodynamics.electronic_energy_hartree;
  const correction = -1 / 1024;
  const corrected = uncorrected + correction;
  const d4Payload = {
    payload_schema: "chemdft.dispersion-corrected-energy", functional: "b3lyp",
    uncorrected_dft_energy: { value: uncorrected }, d4_correction_energy: { value: correction },
    corrected_total_energy: { value: corrected }, parameters: { s6: 1, s8: 2.02929367 },
    source: { result_id: "source-1", calculation_id: "calc-source", structure_version_id: "version-1", canonical_sha256: "a".repeat(64) },
    parameter_table_sha256: "b".repeat(64),
  };
  const detail = (effective: Effective | undefined): CalculationDetail => ({
    calculation: { id: "correction-1", state: "SUCCEEDED" },
    result: { ...envelope(d4Payload, "chemdft.dispersion-corrected-energy", effective), producer_software: { name: "dftd4", version: "4.2.0" } },
  }) as unknown as CalculationDetail;
  const view = (effective: Effective | undefined) => renderToStaticMarkup(
    createElement(Dftd4ResultView, { projectId: "project-1", initial: detail(effective) }));
  const correctedText = corrected.toPrecision(17);

  it("shows the three energies and three distinct, non-verified claims only for an established active state", () => {
    const html = view(ACTIVE);
    expect(flag(html)).toBe("true");
    expect(html).toContain(uncorrected.toPrecision(17));
    expect(html).toContain(correction.toPrecision(17));
    expect(html).toContain(correctedText);
    expect(html).toContain("DFT + D4 total energy");
    expect(html).toContain("Authority: AUTHORITATIVE · Validation: VALIDATED · Independent verification: UNVERIFIED");
    expect(html).toContain("Independent verification of this combined energy: not established");
    expect(html).not.toMatch(/(?<!not )independently verified/i);
    expect(html).not.toContain("dftd4-inactive-reason");
  });

  it.each(SCENARIOS.filter((scenario) => !scenario.current))("$name: no active claim and no corrected total", ({ effective }) => {
    const html = view(effective);
    expect(flag(html)).toBe("false");
    expect(html).toContain("Inactive correction");
    expect(html).not.toContain("DFT + D4 total energy");
    expect(html).not.toContain(correctedText);
    expect(html).not.toContain("Native correction · inputs and evidence validated");
    expect(html).toContain("dftd4-inactive-reason");
    expect(html).toContain("not shown as current evidence");
    expect(html).toContain("Independent verification of this combined energy: not established");
    expect(html).toContain("Independent verification: UNVERIFIED");
  });

  it("explains uncertain state differently from a known inactive lineage", () => {
    expect(view(undefined)).toContain("current scientific state not established");
    expect(view(inactive("RETRACTED"))).toContain("required source is no longer valid");
    expect(view(inactive("RETRACTED"))).toContain("Recorded at publication: AUTHORITATIVE / VALIDATED / UNVERIFIED");
  });

  it("never offers a correction for a source that is not currently established as authoritative", () => {
    for (const scenario of SCENARIOS.filter((item) => !item.current)) {
      const html = renderToStaticMarkup(createElement(Dftd4CorrectionControl, {
        projectId: "project-1", source: envelope({ payload_schema: "chemdft.energy" }, "chemdft.energy", scenario.effective),
      }));
      expect(html, scenario.name).toContain("Unavailable: the source result is not currently established as authoritative");
      expect(html, scenario.name).not.toContain("Calculate D4 correction");
    }
  });
});
