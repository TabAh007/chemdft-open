import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CalculationResult } from "@chemdft/schemas";
import { describeScientificState } from "../src/lib/scientific-state";
import { summarizeProvenance } from "../src/lib/provenance-view";
import { ScientificStateStrip } from "../src/app/_components/scientific-state-strip";

// Presentation fixtures. The active shape is copied from a real read-time response for the accepted
// Psi4 HF/STO-3G n-hexane result; the inactive shape mirrors effective_result_state.py's downgrade
// (authority -> CANDIDATE, validation -> SUPERSEDED/DISPUTED, stored axes preserved).
type Effective = NonNullable<CalculationResult["effective_state"]>;
const ACTIVE: Effective = {
  stored_authority: "AUTHORITATIVE", stored_validation_state: "VALIDATED", stored_verification_state: "UNVERIFIED",
  authority: "AUTHORITATIVE", validation_state: "VALIDATED", verification_state: "UNVERIFIED",
  source_lineage_validity: "ACTIVE", eligible_for_derivation: true, inactive_result_ids: [], reason: null,
};
const RETRACTED: Effective = {
  ...ACTIVE, authority: "CANDIDATE", validation_state: "DISPUTED", source_lineage_validity: "RETRACTED",
  eligible_for_derivation: false, inactive_result_ids: ["00000000-0000-4000-8000-000000000001"],
  reason: "Historical result; current source lineage is RETRACTED.",
};
const stored = { authority: "AUTHORITATIVE", validation_state: "VALIDATED", verification_state: "UNVERIFIED", source_class: "CALCULATED" };

describe("scientific state keeps three axes apart", () => {
  it("shows AUTHORITATIVE / VALIDATED / UNVERIFIED without implying independent verification", () => {
    const view = describeScientificState({ ...stored, effective_state: ACTIVE });
    expect(view.currentlyAuthoritative).toBe(true);
    expect(view.headline).toBe("Authoritative engine result");
    expect([view.authority.value, view.validation.value, view.verification.value]).toEqual(["AUTHORITATIVE", "VALIDATED", "UNVERIFIED"]);
    expect(view.verification.label).toBe("Not independently verified");
    expect(view.verification.intent).toBe("none");
    expect(view.notes.join(" ")).toMatch(/Validation means the platform's checks passed/);
    expect(view.stored).toBeNull();
  });

  it("never presents a retracted lineage as currently authoritative, even when stored axes look current", () => {
    const view = describeScientificState({ ...stored, effective_state: RETRACTED });
    expect(view.currentlyAuthoritative).toBe(false);
    expect(view.headline).toMatch(/^Historical result/);
    expect(view.authority.value).toBe("CANDIDATE");
    expect(view.lineage.value).toBe("RETRACTED");
    expect(view.stored).toEqual({ authority: "AUTHORITATIVE", validation: "VALIDATED", verification: "UNVERIFIED" });
    expect(view.notes[0]).toMatch(/RETRACTED/);
    expect(view.inactiveResultIds).toEqual(["00000000-0000-4000-8000-000000000001"]);
  });

  it.each(["SUPERSEDED", "DISPUTED", "INVALIDATED"] as const)("treats %s lineage as inactive", (lineage) => {
    const view = describeScientificState({ ...stored, effective_state: { ...RETRACTED, source_lineage_validity: lineage } });
    expect(view.currentlyAuthoritative).toBe(false);
    expect(view.lineage.intent).toBe("danger");
  });

  it("fails closed when the API reports no effective state", () => {
    const view = describeScientificState(stored);
    expect(view.effectiveKnown).toBe(false);
    expect(view.currentlyAuthoritative).toBe(false);
    expect(view.headline).toBe("Engine result · not currently authoritative");
    expect(view.notes[0]).toMatch(/not reported/);
  });

  it("requires validation as well as authority", () => {
    const view = describeScientificState({ ...stored, effective_state: { ...ACTIVE, validation_state: "REJECTED" } });
    expect(view.currentlyAuthoritative).toBe(false);
  });

  it("reports an independently verified result only when the backend says so", () => {
    const view = describeScientificState({ ...stored, verification_state: "VERIFIED", effective_state: { ...ACTIVE, verification_state: "VERIFIED", stored_verification_state: "VERIFIED" } });
    expect(view.verification.label).toBe("Independently verified");
    expect(view.notes.join(" ")).not.toMatch(/Validation means the platform's checks passed/);
  });

  it("labels imported results as not produced by a ChemDFT engine", () => {
    const view = describeScientificState({ authority: "IMPORTED", validation_state: "VALIDATED_IMPORT", verification_state: "UNVERIFIED", source_class: "IMPORTED", effective_state: { ...ACTIVE, authority: "IMPORTED", stored_authority: "IMPORTED", validation_state: "VALIDATED_IMPORT", stored_validation_state: "VALIDATED_IMPORT" } });
    expect(view.notes.join(" ")).toMatch(/Imported from an external calculation/);
    expect(view.currentlyAuthoritative).toBe(false);
  });
});

describe("scientific state strip rendering", () => {
  const render = (effective: object | undefined) => renderToStaticMarkup(createElement(ScientificStateStrip, {
    projectId: "p", resultId: "r", result: { ...stored, ...(effective ? { effective_state: effective as never } : {}) },
  }));

  it("renders the three axes and the not-verified wording for the active accepted state", () => {
    const html = render(ACTIVE);
    expect(html).toContain('data-currently-authoritative="true"');
    expect(html).toContain("Authoritative engine result");
    expect(html).toContain("Not independently verified");
    expect(html).toContain("Independent verification");
    expect(html).not.toMatch(/(?<!not )independently verified/i);
    expect(html).toContain("Provenance &amp; lineage");
  });

  it("renders a retracted result as historical with its recorded state", () => {
    const html = render(RETRACTED);
    expect(html).toContain('data-currently-authoritative="false"');
    expect(html).toContain('data-lineage="RETRACTED"');
    expect(html).toContain("Historical result");
    expect(html).toContain("Recorded at publication: AUTHORITATIVE / VALIDATED / UNVERIFIED");
    expect(html).not.toContain("Authoritative engine result");
  });

  it("does not assert currency when effective state is missing", () => {
    const html = render(undefined);
    expect(html).toContain('data-currently-authoritative="false"');
    expect(html).not.toContain("Authoritative engine result");
  });
});

describe("provenance summary", () => {
  const doc = {
    schema: "chemdft.result-lineage-export.v1", historical_evidence: true, truncated: false,
    result: {
      trusted_producer_id: "local.psi4.worker", trusted_producer_type: "SCIENTIFIC_WORKER", created_at: "2026-10-11T05:54:55.867429",
      producer_attestation_id: "execution:1:attempt:1",
      producer_software: { name: "psi4", version: "1.11", adapter_version: "1.0.0", execution_backend: "local.subprocess", hardware_class: "arm64", environment_digest: "e44e" },
      raw_artifacts: [{ artifact_id: "a1", sha256: "9e4d" }, { artifact_id: "", sha256: "x" }],
    },
    provenance_records: [{ id: "prov-1", operation: "chemdft.calculation.energy", operation_version: "1.0.0", producer_identifier: "local.psi4.worker", producer_software_version: "1.11", created_at: "t", detail: "DETERMINISTIC_TRANSFORM", approximate: false }, { operation: "no id" }],
    lineage_results: [{ id: "r1", result_type: "chemdft.energy", authority: "AUTHORITATIVE", effective_state: { source_lineage_validity: "ACTIVE" } }],
  };

  it("extracts only values present in the export", () => {
    const summary = summarizeProvenance(doc)!;
    expect(summary.producer.find((row) => row.label === "Engine")?.value).toBe("psi4 1.11");
    expect(summary.producer.find((row) => row.label === "Environment digest (SHA-256)")?.value).toBe("e44e");
    expect(summary.steps).toHaveLength(1);
    expect(summary.artifacts).toEqual([{ artifactId: "a1", sha256: "9e4d" }]);
    expect(summary.lineage[0]).toMatchObject({ resultId: "r1", lineageValidity: "ACTIVE" });
  });

  it("rejects documents that are not a lineage export", () => {
    expect(summarizeProvenance({ schema: "other" })).toBeNull();
    expect(summarizeProvenance(null)).toBeNull();
    expect(summarizeProvenance("text")).toBeNull();
  });
});
