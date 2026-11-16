import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CalculationDetail } from "@chemdft/schemas";
import { Dftd4ResultView, Dftd4RetryControl } from "../src/app/_components/dftd4-correction";

// Synthetic presentation data: these values are not scientific acceptance evidence.
function fixture(validation: string, authority = "AUTHORITATIVE"): CalculationDetail {
  return {
    calculation: { id: "correction-1" },
    result: { authority, validation_state: validation, verification_state: "UNVERIFIED",
      // The real API always reports the read-time state; absence is treated as not established.
      ...(authority === "AUTHORITATIVE" && validation === "VALIDATED" ? { effective_state: {
        stored_authority: "AUTHORITATIVE", stored_validation_state: "VALIDATED", stored_verification_state: "UNVERIFIED",
        authority: "AUTHORITATIVE", validation_state: "VALIDATED", verification_state: "UNVERIFIED",
        source_lineage_validity: "ACTIVE", eligible_for_derivation: true, inactive_result_ids: [], reason: null,
      } } : {}),
      payload: { payload_schema: "chemdft.dispersion-corrected-energy", functional: "b3lyp",
        uncorrected_dft_energy: { value: -76 }, d4_correction_energy: { value: -0.001 },
        corrected_total_energy: { value: -76.001 }, parameters: { s6: 1, s8: 2.02929367 },
        source: { result_id: "source-1", calculation_id: "calc-source", structure_version_id: "version-1", canonical_sha256: "a".repeat(64) },
        parameter_table_sha256: "b".repeat(64) },
      producer_software: { name: "dftd4", version: "4.2.0" }, provenance_record_id: "provenance-1", raw_artifacts: [],
    },
  } as unknown as CalculationDetail;
}

describe("D4 researcher presentation", () => {
  it("separates three energies and does not claim independent verification", () => {
    const html = renderToStaticMarkup(createElement(Dftd4ResultView, { projectId: "project-1", initial: fixture("VALIDATED") }));
    expect(html).toContain("Original uncorrected DFT energy");
    expect(html).toContain("D4 dispersion correction");
    expect(html).toContain("DFT + D4 total energy");
    expect(html).toContain("Independent verification of this combined energy: not established");
    expect(html).toContain("inputs and evidence validated");
    expect(html).toContain("Authority: AUTHORITATIVE");
    expect(html).toContain("Validation: VALIDATED");
    expect(html).toContain("Independent verification: UNVERIFIED");
    expect(html).not.toMatch(/independently verified/i);
    expect(html).not.toContain("Validated native correction");
    expect(html).toContain("source-1");
    expect(html).toContain("2.02929367");
  });
  it("hides an inactive effective state even if historical envelope axes look current", () => {
    const detail = fixture("VALIDATED");
    detail.result!.effective_state = { eligible_for_derivation: false } as NonNullable<NonNullable<typeof detail.result>["effective_state"]>;
    const html = renderToStaticMarkup(createElement(Dftd4ResultView, { projectId: "project-1", initial: detail }));
    expect(html).toContain("Inactive correction");
    expect(html).not.toContain("DFT + D4 total energy");
  });
  it.each(["ENGINE_CRASHED", "EXECUTION_TIMEOUT", "ENGINE_UNAVAILABLE", "OUTPUT_MISSING"])("offers explicit recovery for %s", (code) => {
    const detail = { calculation: { id: "logical-calc", state: "FAILED" }, attempt: { id: "failed-1", state: "FAILED", failure_code: code } } as CalculationDetail;
    const html = renderToStaticMarkup(createElement(Dftd4RetryControl, { projectId: "project-1", detail, onRetried: () => {} }));
    expect(html).toContain("Retry failed D4 execution");
    expect(html).toContain("diagnostics will be preserved");
  });
  it.each(["RESULT_VALIDATION_FAILED", "INPUT_INVALID", "FIREWALL_REJECTED"])("does not offer execution retry for %s", (code) => {
    const detail = { calculation: { state: "FAILED" }, attempt: { state: "FAILED", failure_code: code } } as unknown as CalculationDetail;
    expect(renderToStaticMarkup(createElement(Dftd4RetryControl, { projectId: "project-1", detail, onRetried: () => {} }))).toBe("");
  });
  it.each(["DISPUTED", "SUPERSEDED"])("suppresses usable energy for %s sources", (state) => {
    const html = renderToStaticMarkup(createElement(Dftd4ResultView, { projectId: "project-1", initial: fixture(state, "CANDIDATE") }));
    expect(html).toContain("Inactive correction");
    expect(html).not.toContain("DFT + D4 total energy");
    expect(html).toContain("Scientific lineage, parameters and native evidence");
  });
});
