import { describe, expect, it } from "vitest";
import type { CalculationDetail, StructureVersionDetail } from "@chemdft/schemas";
import fixture from "./fixtures/as-c1-h2-scientific-log.json";
import { coordinateUnitText, inspectorModel, verifiedInputCoordinates, viewerKind } from "../src/lib/result-inspector-model";

// Presentation fixtures derived from the accepted historical H2 experiment (stored values, not new calculations).
function detail(over: { engine?: string; type?: string; lineage?: string; converged?: boolean } = {}): CalculationDetail {
  const ref = { artifact_id: "log", project_id: "p", sha256: fixture.source_native_log_sha256 };
  return {
    calculation: { id: "calc", project_id: "p", input_id: "input", state: "SUCCEEDED", created_at: "2026-10-14T14:50:08.000000" },
    calculation_input_hash: "0".repeat(64), specification: fixture.specification,
    compute_job: { id: "job", state: "SUCCEEDED" }, compute_execution: { finished_at: "2026-10-14T14:50:11Z" }, attempt: { id: "attempt", raw_artifacts: [ref] },
    result: { id: "result", project_id: "p", calculation_id: "calc", calculation_input_id: "input", result_type: over.type ?? "chemdft.energy",
      authority: "AUTHORITATIVE", source_class: "CALCULATED", validation_state: "VALIDATED", verification_state: "UNVERIFIED",
      effective_state: { authority: "AUTHORITATIVE", validation_state: "VALIDATED", source_lineage_validity: over.lineage ?? "ACTIVE", eligible_for_derivation: (over.lineage ?? "ACTIVE") === "ACTIVE", stored_authority: "AUTHORITATIVE", stored_validation_state: "VALIDATED", stored_verification_state: "UNVERIFIED", verification_state: "UNVERIFIED" },
      producer_software: { name: over.engine ?? "pyscf", version: "2.14.0" }, trusted_producer_id: "local.pyscf.worker", producer_attestation_id: "att", provenance_record_id: "prov", raw_artifacts: [ref],
      payload: { payload_schema: "chemdft.energy", task_type: "ENERGY", method: "hf", basis: "sto-3g", converged: over.converged ?? true, scf_iterations: fixture.iterations,
        total_energy: { value: fixture.energy, unit: { code: "Eh", dimension: "ENERGY" } } } },
  } as unknown as CalculationDetail;
}
function input(): StructureVersionDetail {
  return {
    structure: { id: "s", project_id: "p", kind: "MOLECULE", name: "H2" },
    version: { id: "v", project_id: "p", structure_id: "s", revision: 1, origin: "IMPORTED", overall_charge: 0, multiplicity: 1,
      coordinates: { structure_version_id: "v", coordinate_system: "CARTESIAN", unit: "angstrom", source: { project_id: "p", entity_type: "structure.version", entity_id: "v" },
        atoms: fixture.input.atoms.map((a) => ({ index: a.index, element: a.element, atomic_number: a.atomic_number, x: a.xyz_angstrom[0], y: a.xyz_angstrom[1], z: a.xyz_angstrom[2] })), bonds: [] } },
  } as unknown as StructureVersionDetail;
}

describe("inspector model (stored H2 HF/STO-3G result)", () => {
  it("presents the stored authoritative energy exactly, with its unit and precise label", () => {
    const m = inspectorModel(detail(), input());
    expect(m.primary).not.toBeNull();
    expect(m.primary!.exact).toBe(String(fixture.energy));
    expect(m.primary!.valueText).toBe(fixture.energy.toFixed(10));
    expect(m.primary!.unit).toBe("Eh");
    expect(m.primary!.label).toBe("Hartree–Fock total energy");
    expect(m.primary!.note).toMatch(/includes nuclear repulsion and is not the electronic-only component/);
    expect(m.primary!.derived).toEqual({ eV: "-30.3886", kcalPerMol: "-700.78" });
  });
  it("keeps SCF convergence and iterations from the stored payload", () => {
    expect(inspectorModel(detail(), input()).primary!.convergence).toEqual({ known: true, converged: true, iterations: fixture.iterations });
    expect(inspectorModel(detail({ converged: false }), input()).primary!.convergence.converged).toBe(false);
  });
  it("shows method, basis, engine, charge/multiplicity and the immutable structure version", () => {
    const m = inspectorModel(detail(), input());
    expect(m).toMatchObject({ method: "Hartree-Fock", basis: "STO-3G", engine: "pyscf 2.14.0", electronic: { charge: "0", multiplicity: "1" }, viewer: "energy" });
    expect(m.structure).toMatchObject({ name: "H2", revision: 1, versionId: "v", label: "H2 · V1" });
  });
  it("keeps authority, validation, verification and lineage separate", () => {
    const state = inspectorModel(detail(), input()).authority!;
    expect(state.currentlyAuthoritative).toBe(true);
    expect(state.authority.value).toBe("AUTHORITATIVE");
    expect(state.validation.value).toBe("VALIDATED");
    expect(state.verification.label).toBe("Not independently verified"); // authoritative + validated, still not verified
    expect(state.lineage.value).toBe("ACTIVE");
  });
  it("shows a superseded result as historical without changing its stored value", () => {
    const m = inspectorModel(detail({ lineage: "SUPERSEDED" }), input());
    expect(m.authority!.currentlyAuthoritative).toBe(false);
    expect(m.primary!.exact).toBe(String(fixture.energy));
  });
  it("does not mutate its inputs", () => {
    const d = detail(), i = input(), before = JSON.stringify([d, i]);
    inspectorModel(d, i);
    expect(JSON.stringify([d, i])).toBe(before);
  });
});

describe("viewer kinds and unsupported types", () => {
  it("maps known result types and fails closed for everything else", () => {
    expect(viewerKind("chemdft.energy")).toBe("energy");
    expect(viewerKind("chemdft.molecular-orbitals")).toBe("orbitals");
    expect(viewerKind("chemdft.optimization")).toBe("optimization");
    expect(viewerKind("chemdft.conformer-ensemble")).toBe("conformers");
    expect(viewerKind("chemdft.dispersion-corrected-energy")).toBe("dispersion");
    expect(viewerKind("chemdft.thermochemistry")).toBe("unsupported");
    expect(viewerKind(undefined)).toBe("unsupported");
  });
  it("gives an unsupported type no primary value and an honest note", () => {
    const m = inspectorModel(detail({ type: "chemdft.thermochemistry" }), input());
    expect(m.viewer).toBe("unsupported");
    expect(m.primary).toBeNull();
    expect(m.note).toMatch(/no viewer in Results yet/);
    expect(m.authority).not.toBeNull();
  });
  it("shows nothing instead of a default when the stored energy is invalid", () => {
    const d = detail();
    (d.result!.payload as unknown as { total_energy: { value: number } }).total_energy.value = Number.NaN;
    const m = inspectorModel(d, input());
    expect(m.primary).toBeNull();
    expect(m.note).toMatch(/no valid total energy/);
  });
  it("handles a calculation without a published result", () => {
    const d = detail(); d.result = null;
    const m = inspectorModel(d, null);
    expect(m.authority).toBeNull();
    expect(m.note).toMatch(/No published result/);
  });
});

describe("immutable input coordinates", () => {
  it("returns the coordinates only when version, project and source agree", () => {
    expect(verifiedInputCoordinates(detail(), input())?.atoms).toHaveLength(2);
    const foreignProject = input(); foreignProject.version.project_id = "other";
    expect(verifiedInputCoordinates(detail(), foreignProject)).toBeNull();
    const wrongVersion = input(); wrongVersion.version.coordinates!.structure_version_id = "other";
    expect(verifiedInputCoordinates(detail(), wrongVersion)).toBeNull();
    const nonFinite = input(); nonFinite.version.coordinates!.atoms[0]!.x = Number.NaN;
    expect(verifiedInputCoordinates(detail(), nonFinite)).toBeNull();
    expect(verifiedInputCoordinates(detail(), null)).toBeNull();
  });
  it("states the coordinate unit", () => {
    expect(coordinateUnitText({ coordinate_system: "CARTESIAN", unit: "angstrom" })).toBe("Angstrom");
    expect(coordinateUnitText({ coordinate_system: "CARTESIAN", unit: "bohr" })).toBe("Bohr");
    expect(coordinateUnitText({ coordinate_system: "FRACTIONAL" })).toBe("Fractional (dimensionless)");
    expect(coordinateUnitText({ coordinate_system: "CARTESIAN" })).toBe("Unavailable");
  });
});
