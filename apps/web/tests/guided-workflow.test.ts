import { describe, expect, it } from "vitest";
import { createActor } from "xstate";
import { guidedWorkflowMachine } from "../src/lib/guided-workflow-machine";
import { projectRecommendedNextStep } from "../src/lib/recommended-next-step";

describe("Guided Workflow Machine", () => {
  it("initializes in empty state", () => {
    const actor = createActor(guidedWorkflowMachine).start();
    expect(actor.getSnapshot().value).toBe("empty");
  });

  it("handles input selection and real multi-stage import lifecycle", () => {
    const actor = createActor(guidedWorkflowMachine).start();

    actor.send({
      type: "SELECT_INPUT",
      inputKind: "structure",
      file: { name: "water.xyz", size: 120 },
    });
    expect(actor.getSnapshot().value).toBe("newProject");
    expect(actor.getSnapshot().context.inputKind).toBe("structure");

    actor.send({ type: "START_IMPORT", stage: "uploading" });
    expect(actor.getSnapshot().value).toBe("importing");
    expect(actor.getSnapshot().context.importStage).toBe("uploading");

    actor.send({ type: "UPDATE_IMPORT_STAGE", stage: "detecting" });
    expect(actor.getSnapshot().context.importStage).toBe("detecting");

    actor.send({
      type: "IMPORT_SUCCESS",
      structureId: "struct-1",
      structureVersionId: "ver-1",
      structureSummary: {
        name: "Water",
        revision: 1,
        atomCount: 3,
        hasAuthoritativeBonds: false,
        coordinateSystem: "CARTESIAN",
        origin: "IMPORTED",
      },
    });
    expect(actor.getSnapshot().value).toBe("whatFound");
    expect(actor.getSnapshot().context.structureSummary?.atomCount).toBe(3);
    expect(actor.getSnapshot().context.structureSummary?.hasAuthoritativeBonds).toBe(false);

    actor.send({ type: "ACKNOWLEDGE_FOUND" });
    expect(actor.getSnapshot().value).toBe("projectHome");
  });

  it("transitions between guided structure view, calculation setup, and result view", () => {
    const actor = createActor(guidedWorkflowMachine).start();

    // Reconcile with Water structure
    actor.send({
      type: "RECONCILE_SERVER_STATE",
      payload: {
        projectId: "water-project-1",
        projectName: "Water Acceptance",
        structures: [{ id: "struct-1", name: "Water" }],
        latestVersion: {
          id: "ver-1",
          revision: 1,
          atomCount: 3,
          hasAuthoritativeBonds: false,
          coordinateSystem: "CARTESIAN",
          origin: "IMPORTED",
        },
      },
    });

    expect(actor.getSnapshot().value).toBe("projectHome");

    actor.send({ type: "VIEW_STRUCTURE" });
    expect(actor.getSnapshot().value).toBe("structureView");

    actor.send({ type: "SETUP_CALCULATION", calculationType: "energy" });
    expect(actor.getSnapshot().value).toBe("calculationSetup");
    expect(actor.getSnapshot().context.calculationType).toBe("energy");

    actor.send({ type: "START_CALCULATION", calculationId: "calc-1" });
    expect(actor.getSnapshot().value).toBe("calculationRunning");

    actor.send({
      type: "CALCULATION_SUCCEEDED",
      resultId: "res-1",
      resultSummary: {
        method: "HF",
        basis: "STO-3G",
        totalEnergy: -74.962928,
        homoEnergy: -0.4998,
        lumoEnergy: 0.6074,
        gap: 1.1072,
        hasDensity: true,
        hasEsp: true,
      },
    });
    expect(actor.getSnapshot().value).toBe("resultView");
    expect(actor.getSnapshot().context.resultSummary?.totalEnergy).toBe(-74.962928);
  });

  it("reconciles server truth deterministically on reload without losing accepted results", () => {
    const actor = createActor(guidedWorkflowMachine).start();

    // Simulate browser reload on Water project with existing calculation result
    actor.send({
      type: "RECONCILE_SERVER_STATE",
      payload: {
        projectId: "f39aefcf-a1cd-4606-8f03-f9b18eadb96d",
        projectName: "Electronic structure acceptance — water (USER_SUPPLIED)",
        structures: [{ id: "s-1", name: "water" }],
        latestVersion: {
          id: "de89ad41-298b-43ee-9eea-c796f6347391",
          revision: 1,
          atomCount: 3,
          hasAuthoritativeBonds: false,
          coordinateSystem: "CARTESIAN",
          origin: "IMPORTED",
        },
        latestResult: {
          id: "0746b1d9-eadb-4028-95dc-8bf8c87a5990",
          method: "HF",
          basis: "STO-3G",
          totalEnergy: -74.962928,
          homoEnergy: -0.4998,
          lumoEnergy: 0.6074,
          gap: 1.1072,
          hasDensity: true,
          hasEsp: true,
        },
      },
    });

    expect(actor.getSnapshot().value).toBe("resultView");
    expect(actor.getSnapshot().context.resultId).toBe("0746b1d9-eadb-4028-95dc-8bf8c87a5990");
    expect(actor.getSnapshot().context.resultSummary?.method).toBe("HF");
    expect(actor.getSnapshot().context.resultSummary?.basis).toBe("STO-3G");
  });
});

describe("Deterministic Recommended Next Step Engine", () => {
  it("recommends exploring existing electronic structure for Water", () => {
    const next = projectRecommendedNextStep({
      hasStructure: true,
      structureName: "Water V1",
      structureVersionRevision: 1,
      atomCount: 3,
      hasElectronicResult: true,
      electronicMethod: "HF",
      electronicBasis: "STO-3G",
      currentView: "Water V1",
    });

    expect(next.primary.kind).toBe("VIEW_ELECTRONIC_STRUCTURE");
    expect(next.primary.label).toContain("electronic structure");
    expect(next.secondary.some((s) => s.kind === "VIEW_ESP")).toBe(true);
    expect(next.secondary.some((s) => s.kind === "PREPARE_GEOMETRY_OPTIMIZATION")).toBe(true);
    expect(next.secondary.some((s) => s.kind === "ASK_AI_SCIENTIST")).toBe(true);
  });

  it("recommends reviewing UV/Vis result when both electronic structure and spectroscopy are complete", () => {
    const next = projectRecommendedNextStep({
      hasStructure: true,
      structureName: "Water V1",
      structureVersionRevision: 1,
      atomCount: 3,
      hasElectronicResult: true,
      electronicMethod: "HF",
      electronicBasis: "STO-3G",
      hasSpectraResult: true,
      currentView: "Water V1",
    });

    expect(next.primary.kind).toBe("REVIEW_UVVIS");
    expect(next.primary.label).toBe("Review UV/Vis result");
    expect(next.primary.badge).toBe("TDDFT spectra ready");
    expect(next.secondary.some((s) => s.kind === "VIEW_ELECTRONIC_STRUCTURE")).toBe(true);
    expect(next.secondary.some((s) => s.kind === "ASK_AI_SCIENTIST")).toBe(true);
  });

  it("recommends density when already viewing electronic structure", () => {
    const next = projectRecommendedNextStep({
      hasStructure: true,
      structureName: "Water V1",
      hasElectronicResult: true,
      currentView: "Water V1 → Electronic structure",
    });

    expect(next.primary.kind).toBe("VIEW_ELECTRON_DENSITY");
  });

  it("recommends reviewing candidate for paper projects", () => {
    const next = projectRecommendedNextStep({
      hasStructure: false,
      hasUnreviewedCandidate: true,
      candidateCount: 1,
      hasPaper: true,
    });

    expect(next.primary.kind).toBe("REVIEW_CANDIDATE");
    expect(next.secondary.some((s) => s.kind === "COMPARE_PAPER")).toBe(true);
  });

  it("recommends uploading input for empty projects", () => {
    const next = projectRecommendedNextStep({
      hasStructure: false,
      hasUnreviewedCandidate: false,
      hasPaper: false,
    });

    expect(next.primary.kind).toBe("UPLOAD_INPUT");
  });
});
