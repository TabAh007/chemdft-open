"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { OptimizationOptions, StructureVersionDetail } from "@chemdft/schemas";
import type { CalculationConfig } from "./guided-calculation";
import { basisCoverage, coverageMessage } from "./basis-element-limits";
import { classifyEngineChoice, type EngineChoice } from "./guided-capability-state";
import { checkElectronicState, isElectronicStateLocked } from "./electronic-state";
import { draftKey, inputsKey, loadDraft, loadInputs, saveDraft, saveInputs, type GuidedDraft, type GuidedInputs } from "./guided-draft";
import {
  getPsi4SupportedBases, getPsi4SupportedMethods, isPsi4Available, isPsi4PairSupported, validatePsi4Structure,
} from "./psi4-calculation";
import { useCalculationCapabilities } from "./use-calculation-capabilities";
import { useGeometryEligibility } from "./use-geometry-eligibility";

export type GuidedTask = "energy" | "optimization" | "tddft" | "ir" | "raman";
export type GuidedEngine = "pyscf" | "xtb" | "psi4";
const ENGINE_ORDER: GuidedEngine[] = ["xtb", "pyscf", "psi4"];

export function taskTypeOf(task: GuidedTask): NonNullable<CalculationConfig["taskType"]> {
  return task === "ir" || task === "raman" ? "FREQUENCY" : task === "tddft" ? "TDDFT" : task === "optimization" ? "GEOMETRY_OPTIMIZATION" : "ENERGY";
}

function defaults(task: GuidedTask): GuidedDraft {
  const energyLike = task === "energy" || task === "optimization";
  return {
    engine: energyLike ? "xtb" : "pyscf",
    method: task === "tddft" || task === "ir" || task === "raman" ? "b3lyp" : energyLike ? "gfn2" : "hf",
    basis: task === "tddft" || task === "ir" || task === "raman" ? "def2-svp" : "sto-3g",
    convergence: task === "tddft" || task === "ir" || task === "raman" ? "1e-7" : "1e-9",
    maxSteps: 100,
    nstates: 5,
  };
}

function defaultInputs(structure: StructureVersionDetail): GuidedInputs {
  return { charge: structure.version.overall_charge ?? 0, multiplicity: structure.version.multiplicity ?? 1, confirmed: false };
}

type DraftStore = { key: string; draft: GuidedDraft; picked: boolean };

/**
 * The Guided draft calculation: the researcher's choices, what the capability contract says about them,
 * and the exact submission config. Held by the workspace so it survives moving between stages; persisted
 * per (project, version, task) so it also survives a reload or a Guided↔Advanced switch.
 */
export function useGuidedConfig(params: { projectId: string; structure: StructureVersionDetail; task: GuidedTask; canExecute: boolean }) {
  const { projectId, structure, task, canExecute } = params;
  const key = draftKey(projectId, structure.version.id, task);
  const inKey = inputsKey(projectId, structure.version.id);
  const [store, setStore] = useState<DraftStore>(() => {
    const saved = loadDraft(key);
    return { key, draft: saved ?? defaults(task), picked: saved !== null };
  });
  // A different task or structure version swaps the whole draft during render (no stale first frame).
  let current = store;
  if (store.key !== key) {
    const saved = loadDraft(key);
    current = { key, draft: saved ?? defaults(task), picked: saved !== null };
    setStore(current);
  }
  const draft = current.draft;
  useEffect(() => { saveDraft(key, draft); }, [key, draft]);

  const [inputState, setInputState] = useState<{ key: string; inputs: GuidedInputs }>(() => ({ key: inKey, inputs: loadInputs(inKey) ?? defaultInputs(structure) }));
  const electronicLocked = isElectronicStateLocked(structure.electronic_state_authority);
  const structureCharge = structure.version.overall_charge ?? 0;
  const structureMultiplicity = structure.version.multiplicity ?? 1;
  const storedValues = useMemo(() => ({ charge: structureCharge, multiplicity: structureMultiplicity }), [structureCharge, structureMultiplicity]);
  let storedInputs = inputState.inputs;
  if (inputState.key !== inKey) {
    storedInputs = loadInputs(inKey) ?? defaultInputs(structure);
    setInputState({ key: inKey, inputs: storedInputs });
  }
  // Where the server would refuse a change, the structure's own values are the only values (a saved draft cannot override them).
  if (electronicLocked && (storedInputs.charge !== storedValues.charge || storedInputs.multiplicity !== storedValues.multiplicity)) {
    storedInputs = { ...storedInputs, ...storedValues };
  }
  const electronicState = useMemo(
    () => checkElectronicState(structure.version.coordinates?.atoms, storedInputs.charge, storedInputs.multiplicity, { periodic: Boolean(structure.version.periodic_cell) }),
    [structure.version.coordinates, structure.version.periodic_cell, storedInputs.charge, storedInputs.multiplicity],
  );
  // A confirmation restored from storage never outlives a state that cannot exist or has missing charge.
  const inputs: GuidedInputs = useMemo(
    () => (electronicState.status === "invalid" || storedInputs.charge === null ? { ...storedInputs, confirmed: false } : storedInputs),
    [electronicState.status, storedInputs],
  );
  useEffect(() => { saveInputs(inKey, storedInputs); }, [inKey, storedInputs]);
  const setInputs = useCallback((next: { charge?: number | null; multiplicity?: number }) => {
    if (electronicLocked) return;
    setInputState((state) => ({ key: state.key, inputs: { ...state.inputs, ...next, confirmed: false } }));
  }, [electronicLocked]);
  const electronicAtoms = structure.version.coordinates?.atoms;
  const periodic = Boolean(structure.version.periodic_cell);
  const confirmInputs = useCallback(() => setInputState((state) => (
    // An impossible electronic state or unentered charge can never be confirmed, whatever calls this.
    state.inputs.charge === null || !Number.isInteger(state.inputs.charge)
      ? state
      : checkElectronicState(electronicAtoms, state.inputs.charge, state.inputs.multiplicity, { periodic }).status === "invalid"
        ? state
        : { key: state.key, inputs: { ...state.inputs, ...(electronicLocked ? storedValues : {}), confirmed: true } }
  )), [electronicAtoms, periodic, electronicLocked, storedValues]);
  const resetInputs = useCallback(() => setInputState((state) => ({ key: state.key, inputs: defaultInputs(structure) })), [structure]);

  const geometry = useGeometryEligibility(projectId, structure.structure.id, structure.version.id);
  const { capabilities, error: capabilityError, loading: capabilitiesLoading, psi4Capability, refresh } = useCalculationCapabilities(projectId);

  const energyLike = task === "energy" || task === "optimization";
  const isEnergy = task === "energy";
  const isOpt = task === "optimization";
  const isTddft = task === "tddft";
  const taskType = taskTypeOf(task);
  const activeEngine: GuidedEngine = energyLike ? draft.engine : "pyscf";
  const isXtb = energyLike && activeEngine === "xtb";
  const isPsi4 = isEnergy && activeEngine === "psi4";
  const capability = capabilities.find((item) => item.engine === activeEngine);

  const psi4Structure = validatePsi4Structure(structure, false);
  const psi4Cap = psi4Capability ?? null; // null (not undefined) = fail closed, never the built-in fallback list
  const psi4Methods = useMemo(() => getPsi4SupportedMethods(psi4Cap), [psi4Cap]);
  const psi4Bases = useMemo(() => getPsi4SupportedBases(draft.method, psi4Cap), [draft.method, psi4Cap]);
  const methods = useMemo(() => (isPsi4 ? psi4Methods : capability?.supported_methods ?? []), [isPsi4, psi4Methods, capability]);
  const bases = useMemo(() => (isPsi4 ? psi4Bases : capability?.supported_basis_sets ?? []), [isPsi4, psi4Bases, capability]);
  const optimizer = capability?.supported_optimizers?.find((item) => item === (activeEngine === "xtb" ? "xtb-ancopt" : "geometric"));
  const level = capability?.supported_optimization_levels?.find((item) => item === "normal");
  const atomicNumbers = useMemo(() => (structure.version.coordinates?.atoms ?? []).map((atom) => atom.atomic_number), [structure.version.coordinates]);
  const basisCovers = useCallback((id: string) => basisCoverage(capability, id, atomicNumbers), [capability, atomicNumbers]);
  const selectedBasisCoverage = useMemo(() => (activeEngine === "pyscf" ? basisCovers(draft.basis) : { usable: true, limit: null, offending: [] as number[] }), [activeEngine, basisCovers, draft.basis]);

  const choices = useMemo(() => {
    const result: Partial<Record<GuidedEngine, EngineChoice>> = {};
    for (const engine of ENGINE_ORDER) {
      if (engine === "psi4" && task !== "energy") continue;
      const psi4 = engine === "psi4";
      result[engine] = classifyEngineChoice({
        engine: engine, task: taskType, capabilities, capabilityError, loading: capabilitiesLoading, canExecute,
        restriction: psi4 && !psi4Structure.valid ? `Psi4 molecular restriction: ${psi4Structure.reason}` : null,
      });
      if (psi4 && result[engine]!.kind === "selectable" && !isPsi4Available(psi4Cap)) {
        result[engine] = { kind: "worker-unavailable", label: "Worker unavailable", reason: "Psi4 isn't configured on this deployment.", selectable: false };
      }
    }
    return result;
  }, [task, taskType, capabilities, capabilityError, capabilitiesLoading, canExecute, psi4Structure.valid, psi4Structure.reason, psi4Cap]);

  const patch = useCallback((next: Partial<GuidedDraft>, picked = false) => setStore((state) => ({ key: state.key, draft: { ...state.draft, ...next }, picked: state.picked || picked })), []);

  const changeEngine = useCallback((next: GuidedEngine, byUser = true) => {
    if (next === "psi4") {
      const pMethods = getPsi4SupportedMethods(psi4Capability ?? null);
      const nextMethod = pMethods.includes("hf") ? "hf" : pMethods[0] ?? "hf";
      const pBases = getPsi4SupportedBases(nextMethod, psi4Capability ?? null);
      patch({ engine: next, method: nextMethod, basis: pBases.includes("def2-svp") ? "def2-svp" : pBases[0] ?? "sto-3g", }, byUser);
    } else {
      const target = capabilities.find((item) => item.engine === next);
      patch({
        engine: next,
        method: target?.supported_methods.find((item) => item === (next === "xtb" ? "gfn2" : "hf")) ?? target?.supported_methods[0] ?? (next === "xtb" ? "gfn2" : "hf"),
        basis: target?.supported_basis_sets.find((item) => item === "sto-3g") ?? target?.supported_basis_sets[0] ?? "sto-3g",
      }, byUser);
    }
  }, [capabilities, patch, psi4Capability]);

  // Until the researcher picks an engine, never leave an unavailable one selected: take the first usable engine.
  const choiceKinds = ENGINE_ORDER.map((engine) => choices[engine]?.kind ?? "-").join(",");
  useEffect(() => {
    if (current.picked || !energyLike || capabilitiesLoading || capabilityError || capabilities.length === 0) return;
    if (choices[draft.engine]?.selectable) return;
    const first = ENGINE_ORDER.find((engine) => choices[engine]?.selectable);
    if (first && first !== draft.engine) queueMicrotask(() => changeEngine(first, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choiceKinds, capabilities.length, capabilitiesLoading, capabilityError, energyLike, draft.engine]);

  const changeMethod = useCallback((method: string) => {
    if (isPsi4) {
      const pBases = getPsi4SupportedBases(method, psi4Capability ?? null);
      patch({ method, ...(pBases.includes(draft.basis.toLowerCase()) ? {} : { basis: pBases[0] ?? "def2-svp" }) }, true);
    } else patch({ method }, true);
  }, [draft.basis, isPsi4, patch, psi4Capability]);

  const settingsIssues: string[] = useMemo(() => {
    const list: string[] = [];
    const engineChoice = choices[activeEngine];
    if (engineChoice && !engineChoice.selectable) list.push(`${activeEngine === "xtb" ? "xTB" : activeEngine === "psi4" ? "Psi4" : "PySCF"}: ${engineChoice.label.toLowerCase()}${engineChoice.reason ? ` — ${engineChoice.reason}` : ""}`);
    else if (capability) {
      if (!methods.includes(draft.method) && !(activeEngine === "xtb" && draft.method === "gfn2")) list.push(`${draft.method.toUpperCase()} is not reported as supported by this engine.`);
      if (!isXtb && !bases.includes(draft.basis)) list.push(`Basis set ${draft.basis.toUpperCase()} is not reported as supported by this engine.`);
      if (!selectedBasisCoverage.usable) list.push(`${coverageMessage(draft.basis, selectedBasisCoverage)} Choose a basis that covers every element, or use xTB.`);
      if (isPsi4) {
        if (!isPsi4PairSupported(draft.method, draft.basis, psi4Cap)) list.push("This Psi4 method/basis pair is not an accepted combination.");
        if (inputs.charge !== 0 || inputs.multiplicity !== 1) list.push("Psi4 requires charge 0 and multiplicity 1.");
      }
      if (isTddft && inputs.multiplicity !== 1) list.push("TDDFT supports closed-shell singlets only (multiplicity 1).");
      if (isOpt) {
        if (!optimizer || (activeEngine === "xtb" && !level)) list.push("The engine reports no supported optimizer settings.");
        if (!Number.isInteger(draft.maxSteps) || draft.maxSteps < 1 || draft.maxSteps > 500) list.push("Maximum optimization cycles must be between 1 and 500.");
      }
      if (!isXtb && !isPsi4 && !(Number.isFinite(Number(draft.convergence)) && Number(draft.convergence) > 0)) list.push("SCF convergence must be a positive number.");
    }
    return list;
  }, [choices, activeEngine, capability, methods, bases, draft, inputs, isXtb, isPsi4, isOpt, optimizer, level, selectedBasisCoverage, psi4Cap, isTddft]);

  /** Problems with the structure's geometry (server verdict), kept apart from problems with the chosen settings. */
  const geometryIssues: string[] = useMemo(() => {
    if (geometry.loading) return ["Checking calculation eligibility…"];
    if (geometry.error) return [`Calculation eligibility could not be verified. ${geometry.error}`];
    if (geometry.eligibility && !geometry.eligibility.eligible) return [geometry.eligibility.detail || "This structure has no calculation-ready 3D geometry."];
    return [];
  }, [geometry.loading, geometry.error, geometry.eligibility]);
  const electronicIssues: string[] = useMemo(() => {
    if (storedInputs.charge === null) return ["Enter a total charge."];
    if (electronicState.status === "invalid") return [electronicState.message];
    return [];
  }, [storedInputs.charge, electronicState]);
  const issues = useMemo(() => [...geometryIssues, ...electronicIssues, ...settingsIssues], [geometryIssues, electronicIssues, settingsIssues]);

  const config: CalculationConfig | null = useMemo(() => {
    if (inputs.charge === null) return null;
    return {
      engine: activeEngine,
      allowedVersion: isPsi4 ? (psi4Capability?.version ?? "1.11") : (capability?.version ?? undefined),
      optimizationOptions: isOpt && optimizer
        ? { optimizer: optimizer as NonNullable<OptimizationOptions["optimizer"]>, max_steps: draft.maxSteps, ...(isXtb ? { xtb_level: level as "normal" } : {}) }
        : undefined,
      method: isXtb ? "gfn2" : draft.method.toLowerCase(),
      basis: isXtb ? null : draft.basis.toLowerCase(),
      charge: inputs.charge,
      multiplicity: inputs.multiplicity,
      convergence: isPsi4 ? 1e-10 : Number(draft.convergence),
      taskType,
      tddftOptions: isTddft ? { nstates: draft.nstates, spin: "singlet", gauge: "length", conv_tol: Number(draft.convergence) } : undefined,
      ramanOptions: task === "raman" ? {
        enabled: true, strategy: "PLACZEK_STATIC", polarizability_strategy: "FINITE_ELECTRIC_FIELD",
        electric_field_step_au: 0.0010, derivative_step_angstrom_amu_half: 0.0100,
        symmetrize_polarizability: true, antisymmetry_tolerance: 0.0001,
      } : undefined,
    };
  }, [activeEngine, isPsi4, psi4Capability, capability, isOpt, optimizer, draft, inputs, isXtb, level, taskType, isTddft, task]);

  return {
    draft, patch, inputs, electronicState, electronicLocked, setInputs, confirmInputs, resetInputs, task, taskType, activeEngine, isXtb, isPsi4, isOpt, isEnergy, isTddft,
    capability, capabilities, capabilityError, capabilitiesLoading, refresh, psi4Capability, psi4Structure,
    methods, bases, psi4Methods, psi4Bases, optimizer, level, basisCovers, selectedBasisCoverage,
    choices, geometry, issues, settingsIssues, geometryIssues, config, changeEngine, changeMethod,
  };
}
export type GuidedConfig = ReturnType<typeof useGuidedConfig>;
