import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { CalculationDetail, ConformerEnsembleManifest, ConformerEnsembleResult, EngineCapabilityView, StructureVersionDetail } from "@chemdft/schemas";
import { associatedConformerEnsemble, buildConformerSubmission, conformerRunState, conformerUnavailableReason, CREST_VERSION, ensembleSelectionKey, sceneForConformerMember, selectedEnsembleMember } from "../src/lib/conformer-ensemble";

// Native values are the sealed Gate B.1 evidence, copied byte-for-byte; only metadata is constructed here.
const bytes = readFileSync(new URL("./fixtures/pf8c/ethanol-manifest.json", import.meta.url));
const manifest: ConformerEnsembleManifest = JSON.parse(bytes.toString());
const artifact = { project_id: manifest.project_id, artifact_id: "manifest-fixture", sha256: createHash("sha256").update(bytes).digest("hex") };
const payload: ConformerEnsembleResult = { payload_schema: "chemdft.conformer-ensemble", manifest, manifest_artifact: artifact, artifacts: manifest.native_artifacts.map((item) => item.artifact) as ConformerEnsembleResult["artifacts"] };
const detail = {
  calculation: { id: manifest.calculation_id, project_id: manifest.project_id, input_id: manifest.calculation_input_id, state: "SUCCEEDED" },
  calculation_input_hash: manifest.calculation_input_sha256,
  specification: buildConformerSubmission(manifest.project_id, manifest.input_structure_version_id, "test").specification,
  compute_execution: { id: manifest.execution_id, project_id: manifest.project_id, calculation_id: manifest.calculation_id },
  attempt: { attempt_number: manifest.attempt_number, project_id: manifest.project_id, calculation_id: manifest.calculation_id },
  result: { id: "real-manifest-test-wrapper", project_id: manifest.project_id, calculation_id: manifest.calculation_id,
    calculation_input_id: manifest.calculation_input_id, validation_state: "VALIDATED", trusted_producer_id: "local.crest.worker", result_type: "chemdft.conformer-ensemble", payload },
} as CalculationDetail;
const associated = (value: CalculationDetail) => associatedConformerEnsemble(value, manifest.project_id, manifest.calculation_id, detail.result!.id);
const structure = { structure: { kind: "MOLECULE" }, version: { overall_charge: 0, multiplicity: 1, coordinates: manifest.members[0].conformer.coordinates } } as StructureVersionDetail;
const capability: EngineCapabilityView = { engine: "crest", version: CREST_VERSION, availability: "AVAILABLE", supported_tasks: ["CONFORMER_SEARCH"], supported_methods: ["gfn2"], supported_basis_sets: [] };

describe("fixed native CREST submission and capabilities", () => {
  it("binds the immutable input and exact patched engine, without unsupported scientific settings", () => {
    const request = buildConformerSubmission("project", "immutable-version", "unique-key");
    expect(request.structure_version).toEqual({ project_id: "project", entity_type: "structure.version", entity_id: "immutable-version" });
    expect(request.specification.engine_preference).toEqual({ engine: "crest", allowed_version: CREST_VERSION });
    expect(request.specification).toMatchObject({ task_type: "CONFORMER_SEARCH", charge: 0, multiplicity: 1, basis: null,
      conformer_search: { workflow: "imtd-gc", optimization_level: "vtight", energy_window_kcal_mol: 6, threads: 2, timeout_seconds: 1800 } });
    expect(request.specification.solvation).toBeUndefined(); expect(request.specification.hessian).toBeUndefined();
  });
  it("fails closed for unavailable/unverified capabilities and unsupported input", () => {
    expect(conformerUnavailableReason(structure, capability)).toBeNull();
    expect(conformerUnavailableReason(structure)).toMatch(/unavailable/);
    expect(conformerUnavailableReason(structure, { ...capability, availability: "UNAVAILABLE", diagnostic: "Native executable missing" })).toBe("Native executable missing");
    expect(conformerUnavailableReason(structure, { ...capability, version: "3.0.2" })).toMatch(/patched/);
    expect(conformerUnavailableReason({ ...structure, version: { ...structure.version, overall_charge: 1 } }, capability)).toMatch(/neutral singlet/);
    expect(conformerUnavailableReason({ ...structure, structure: { ...structure.structure, kind: "PERIODIC" } }, capability)).toMatch(/nonperiodic/);
  });
});
describe("ensemble identity and member association using actual native evidence", () => {
  it("accepts the matching published run and preserves native values without browser recomputation", () => {
    expect(associated(detail)).toBe(payload);
    for (const member of manifest.members) {
      const scene = sceneForConformerMember(payload, member.conformer.id);
      expect(scene.atoms.map((atom) => atom.position)).toEqual(member.conformer.coordinates.atoms.map((atom) => [atom.x, atom.y, atom.z]));
      expect(scene.id).toContain(member.native_record_sha256);
      expect(selectedEnsembleMember(payload, member.conformer.id)).toBe(member);
    }
    expect(sceneForConformerMember(payload, manifest.members[0].conformer.id).atoms).not.toEqual(sceneForConformerMember(payload, manifest.members[1]!.conformer.id).atoms);
    expect(() => sceneForConformerMember(payload, "another-ensemble-member")).toThrow(/does not belong/);
  });
  it.each(["project", "calculation", "result", "input", "execution", "attempt", "member", "rank", "minimum", "units"])("rejects mismatched %s metadata", (field) => {
    const next = structuredClone(detail); const p = next.result!.payload as ConformerEnsembleResult;
    if (field === "project") next.result!.project_id = "other";
    if (field === "calculation") next.result!.calculation_id = "other";
    if (field === "result") next.result!.id = "other";
    if (field === "input") p.manifest.calculation_input_id = "other";
    if (field === "execution") p.manifest.execution_id = "other";
    if (field === "attempt") p.manifest.attempt_number += 1;
    if (field === "member") p.manifest.members[0].conformer.project_id = "other";
    if (field === "rank") p.manifest.members[0].application_rank += 1;
    if (field === "minimum") Object.assign(p.manifest.members[0], { minimum_status: "VERIFIED" });
    if (field === "units") p.manifest.members[0].native_electronic_energy.unit.code = "eV";
    expect(() => associated(next)).toThrow();
  });
  it("namespaces persisted selection by project, calculation, result, execution and manifest; foreign IDs fall back within this ensemble", () => {
    const key = ensembleSelectionKey(manifest.project_id, manifest.calculation_id, "r1", payload);
    expect(ensembleSelectionKey(manifest.project_id, manifest.calculation_id, "r2", payload)).not.toBe(key);
    expect(ensembleSelectionKey("other", manifest.calculation_id, "r1", payload)).not.toBe(key);
    expect(ensembleSelectionKey(manifest.project_id, manifest.calculation_id, "r1", { ...payload, manifest: { ...manifest, execution_id: "other" } })).not.toBe(key);
    expect(selectedEnsembleMember(payload, "foreign-member")).toBe(manifest.members[0]);
  });
});
describe("run states cannot imply an accepted partial ensemble", () => {
  it.each([ ["QUEUED", "Queued"], ["RUNNING", "Running"], ["CANCELED", "Canceled"], ["FAILED", "Failed"], ["SUCCEEDED", "Completed"] ] as const)("labels %s", (state, label) => {
    expect(conformerRunState({ ...detail, calculation: { ...detail.calculation, state } })).toBe(label);
  });
  it("distinguishes timeout, incomplete and success without publishable evidence", () => {
    expect(conformerRunState({ ...detail, calculation: { ...detail.calculation, state: "FAILED" }, attempt: { ...detail.attempt!, diagnostic: "Native wall timeout" } })).toBe("Timed out");
    expect(conformerRunState({ ...detail, calculation: { ...detail.calculation, state: "FAILED" }, attempt: { ...detail.attempt!, diagnostic: "Incomplete native evidence" } })).toBe("Incomplete native evidence");
    expect(conformerRunState({ ...detail, result: null })).toBe("Incomplete native evidence");
  });
});
