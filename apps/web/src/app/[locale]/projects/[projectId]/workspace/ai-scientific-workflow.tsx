"use client";
import { CalculationScientificSummary } from "@/app/_components/calculation-scientific-summary";

import { useEffect, useState } from "react";
import type { AIApprovalView, AIRunView, CalculationDetail, CandidateRepresentationDetail, CoordinateSet, EngineCapabilityView, StructureVersionDetail } from "@chemdft/schemas";
import { ActionButton } from "@chemdft/ui";
import { useOptionalWorkspaceState } from "@/app/_components/workspace-state-provider";
import { getCandidateFigureUrl, getCandidateRepresentation, getDocument, listCandidateRepresentations, listStructureCandidates } from "@/lib/phase7-api";
import { recognitionProposalFromDetail } from "@/lib/recognition-proposal";
import { getCalculation, listCalculationCapabilities, listStructures, listStructureVersions } from "@/lib/structure-workspace-api";
import { deriveMolecularFormula } from "@/lib/scientific-format";
import { aiErrorLabel, humanizeDetail } from "@/lib/scientific-labels";
import { AiErrorDetails } from "./ai-scientist-error-details";
import { plainAiError } from "@/lib/ai-plain-errors";
import { calculationInputStructure } from "@/lib/calculation-result-association";
import { approvalCoordinate, approvalGeometry, approvalGeometryKey } from "@/lib/approval-geometry";
import { describeScientificState } from "@/lib/scientific-state";
import { coordinateOriginLabel, researcherGateSelection, scientificCalculationEnergy, scientificResultProvenance, scientificWorkflowPhase } from "@/lib/ai-scientist-workflow";
import { CandidateFigureRecognitionPanel, type MolecularRecognitionCandidateView } from "./visualization/candidate-figure-recognition-panel";
import { EnergyPrecisionPlate } from "./visualization/energy-precision-plate";

export function ScientificWorkflow({ run, submitting, onResume, onRefresh }: {
  run: AIRunView; submitting: boolean; onResume: () => void; onRefresh: () => void;
}) {
  const workspace = useOptionalWorkspaceState();
  const gate = run.status === "PAUSED" ? run.pending_researcher_gate : null;
  const [proposal, setProposal] = useState<{ key: string; view?: MolecularRecognitionCandidateView; error?: string } | null>(null);
  const [calculation, setCalculation] = useState<{ projectId: string; id: string; detail: CalculationDetail } | null>(null);
  const [calculationError, setCalculationError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const gateCandidateId = gate?.candidate_id;
  const gateRepresentationId = gate?.expected_representation_id;
  const gateKey = gate ? `${run.project_id}:${gate.candidate_id}:${gate.expected_representation_id}` : "";
  const calculationId = run.waiting_calculation_id;
  const detail = calculation && calculation.projectId === run.project_id && calculation.id === calculationId ? calculation.detail : null;
  const refusedProposals = (run.steps ?? []).filter(step => step.error_code === "TOOL_REJECTED").length;

  useEffect(() => {
    if (!gateCandidateId || !gateRepresentationId) return;
    let alive = true;
    const candidateId = gateCandidateId, representationId = gateRepresentationId;
    void Promise.all([
      listStructureCandidates(run.project_id),
      getCandidateRepresentation(run.project_id, candidateId, representationId),
      listCandidateRepresentations(run.project_id, candidateId),
    ]).then(async ([candidates, expected, history]) => {
      const candidate = candidates.candidates?.find(item => item.id === candidateId);
      if (!candidate) throw new Error("Requested candidate is unavailable. Nothing was substituted.");
      // Follow the exact gate lineage, never the latest unrelated recognition attempt.
      let ancestor = expected;
      const visited = new Set<string>();
      while (!recognitionProposalFromDetail(ancestor) && ancestor.source_representation_id && !visited.has(ancestor.id)) {
        visited.add(ancestor.id);
        ancestor = await getCandidateRepresentation(run.project_id, candidateId, ancestor.source_representation_id);
      }
      const saved = recognitionProposalFromDetail(ancestor);
      if (!saved) throw new Error("No saved recognition proposal exists in the requested representation lineage.");
      const drawingRow = history.representations?.find(item => item.representation_origin === "IMAGE_RECONSTRUCTION" && item.representation_type === "MOL_BLOCK" && item.revision === ancestor.revision + 1);
      const [document, drawing] = await Promise.all([
        getDocument(run.project_id, candidate.source_document_id),
        drawingRow ? getCandidateRepresentation(run.project_id, candidateId, drawingRow.id) : Promise.resolve<CandidateRepresentationDetail | null>(null),
      ]);
      if (alive) setProposal({ key: gateKey, view: {
        candidateId, projectId: run.project_id, documentTitle: document.document.title ?? "Scientific document",
        documentId: candidate.source_document_id, pageNumber: candidate.source_page ?? saved.source_page_number ?? null,
        figureNumber: saved.source_figure_number ?? "Unavailable", figureUrl: getCandidateFigureUrl(run.project_id, candidateId),
        figureRegion: saved.figure_region, recognitionEngine: saved.recognition_engine, engineVersion: saved.engine_version,
        proposedSmiles: saved.proposed_smiles, formula: saved.formula, formalCharge: saved.formal_charge,
        heavyAtomCount: saved.heavy_atom_count, drawingMol: drawing?.mol_block ?? null, status: saved.status,
        confidence: saved.confidence, validationWarnings: saved.validation_warnings,
        diagnostics: saved.diagnostics, unresolvedAmbiguities: saved.unresolved_ambiguities,
      } });
    }).catch((cause: unknown) => { if (alive) setProposal({ key: gateKey, error: cause instanceof Error ? cause.message : "Proposal unavailable." }); });
    return () => { alive = false; };
  }, [gateCandidateId, gateRepresentationId, gateKey, run.project_id, retry]);

  useEffect(() => {
    if (!calculationId) return;
    let alive = true, reading = false;
    async function refresh() {
      if (reading) return;
      reading = true;
      try {
        const next = await getCalculation({ projectId: run.project_id, calculationId: calculationId! });
        if (next.calculation.id !== calculationId || next.calculation.project_id !== run.project_id) throw new Error("Calculation identity mismatch; reload the saved run.");
        if (alive) { setCalculation({ projectId: run.project_id, id: calculationId!, detail: next }); setCalculationError(null); }
      } catch (cause) { if (alive) setCalculationError(cause instanceof Error ? cause.message : "Calculation status unavailable."); }
      finally { reading = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [calculationId, run.project_id, retry]);

  function inspect() {
    if (!gate || !workspace) return;
    // Do not discard a molecular drawing, even when reopening its existing tab.
    if (workspace.unsavedWork) return;
    workspace.setWorkspaceMode("advanced");
    workspace.openSelection(researcherGateSelection(run.project_id, gate), "Requested molecular representation · researcher review");
  }

  return <section className="ai-scientific-workflow" aria-label="Scientific workflow" data-testid="ai-scientific-workflow">
    <p role="status" aria-live="polite" aria-atomic="true"><strong>{scientificWorkflowPhase(run, detail)}</strong> · <code className="ai-status-code" title="Stored run status">{run.status}</code></p>
    {/* A proposal ChemDFT refused before approval is not a failure of the run: one quiet note here, each reason in the timeline; a run that ended without a valid proposal is explained by its blocker notice. */}
    {(run.steps ?? []).filter(step => (step.error_code || step.error_detail) && step.error_code !== "TOOL_REJECTED").map(step => {
      const raw = step.error_detail ?? step.summary;
      const plain = plainAiError(raw);
      const prefix = step.tool_name ?? step.step_type;
      const detail = plain.detail ?? (step.error_code ? `${step.error_code}${step.error_detail ? `: ${step.error_detail}` : ""}` : null);
      return (
        <div role="alert" key={step.id}>
          {prefix}: {step.error_code && !plain.detail ? `${aiErrorLabel(step.error_code)}. ` : ""}{plain.text}
          <AiErrorDetails detail={detail ? `${prefix}: ${detail}` : null} />
        </div>
      );
    })}
    {!run.blocker && refusedProposals > 0 ? <p role="status" className="ai-refused-note" data-testid="ai-refused-proposals">ChemDFT refused {refusedProposals} proposal{refusedProposals === 1 ? "" : "s"} before approval; the activity timeline lists each reason.</p> : null}
    {!run.blocker && (run.error_detail || run.error_code) ? (() => {
      const plain = plainAiError(run.error_detail);
      const detail = plain.detail ?? (run.error_code ? `${run.error_code}${run.error_detail ? `: ${run.error_detail}` : ""}` : null);
      return (
        <div role="alert">
          {run.error_code && !plain.detail ? `${aiErrorLabel(run.error_code)}. ` : ""}{plain.text}
          <AiErrorDetails detail={detail} />
        </div>
      );
    })() : null}
    {["EXECUTING", "PLANNING", "CREATED"].includes(run.status) ? <p>Execution is synchronous. Molecular recognition may take up to 180 seconds. A recorded running step can remain after a backend interruption; refresh status before repeating an action.</p> : null}
    {gate ? <div className="ai-researcher-gate" data-testid="ai-researcher-gate">
      <strong>Researcher verification required</strong>
      <p>Waiting for structure approval. {gate.review_reason}</p>
      <dl className="ai-approval-parameters">
        <div><dt>Candidate</dt><dd>{gate.candidate_id}</dd></div>
        <div><dt>Expected representation</dt><dd>{gate.expected_representation_id}</dd></div>
        <div><dt>Source document</dt><dd>{gate.source_document_id ?? "Unavailable"}</dd></div>
      </dl>
      <strong>UNVERIFIED MOLECULAR PROPOSAL</strong>
      <p>DECIMER output requires human comparison with the source. Charge, isotopes and stereochemistry require explicit review. No experimental confirmation or quantum optimization is established.</p>
      <div className="phase7-actions">
        <ActionButton text="Inspect & Correct in Ketcher" onClick={inspect} disabled={!workspace || Boolean(workspace.unsavedWork)} />
        <ActionButton text="Resume after researcher promotion" onClick={onResume} disabled={submitting} />
      </div>
      {proposal?.key === gateKey && proposal.view ? <CandidateFigureRecognitionPanel candidate={proposal.view} /> : proposal?.key === gateKey && proposal.error ? (() => {
        const plain = plainAiError(proposal.error);
        return (
          <p role="alert">
            {plain.text} <button type="button" onClick={() => setRetry(value => value + 1)}>Reload proposal</button>
            <AiErrorDetails detail={plain.detail} />
          </p>
        );
      })() : <p role="status">Loading saved proposal and original source figure…</p>}
      {workspace?.unsavedWork ? <p role="alert">Finish or explicitly close your unsaved Ketcher work before opening the requested representation.</p> : null}
      <p>Resume asks the backend to verify this exact candidate and representation lineage. It does not approve the molecule. The run never resumes automatically after promotion.</p>
    </div> : null}
    {calculationId ? <div data-testid="ai-calculation-status">
      <p>Calculation {calculationId}: {detail ? detail.calculation.state : "Loading execution status…"}</p>
      {detail ? <p>{scientificResultProvenance(detail)}</p> : null}
      {detail ? <CalculationExecution key={`${run.project_id}:${calculationId}:${retry}`} detail={detail} projectId={run.project_id} calculationId={calculationId} fresh={!calculationError} /> : null}
      {calculationError ? (() => {
        const plain = plainAiError(calculationError);
        return (
          <p role="alert">
            {plain.text} <button type="button" onClick={() => setRetry(value => value + 1)}>Reload calculation</button>
            <AiErrorDetails detail={plain.detail} />
          </p>
        );
      })() : null}
    </div> : null}
    <ActionButton small minimal text="Refresh run status" onClick={onRefresh} />
  </section>;
}

/** Resolve the input using the existing hash-bound artifact/structure resolver, never active selection. */
export function CalculationExecution({ detail, projectId, calculationId, fresh = true }: {
  detail: CalculationDetail; projectId: string; calculationId: string; fresh?: boolean;
}) {
  const workspace = useOptionalWorkspaceState();
  const [input, setInput] = useState<StructureVersionDetail | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const inputHash = detail.calculation_input_hash;
  const inputAvailable = Boolean(detail.attempt?.raw_artifacts?.some(ref => ref.sha256 === inputHash));
  useEffect(() => {
    if (!inputAvailable) return;
    let alive = true;
    void calculationInputStructure(projectId, detail).then(version => {
      if (alive) { setInput(version); setInputError(null); }
    }).catch((cause: unknown) => { if (alive) setInputError(cause instanceof Error ? cause.message : "Immutable input unavailable."); });
    return () => { alive = false; };
    // The resolver depends on the immutable calculation/input identity, not each status poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, calculationId, inputHash, inputAvailable]);
  const spec = detail.specification;
  if (!("engine_preference" in spec)) return <p>Inspect this task in the calculation workspace.</p>;
  const energy = fresh ? scientificCalculationEnergy(detail, projectId, calculationId) : null;
  const result = detail.result;
  const openCalculation = () => workspace?.openSelection({ kind: "calculation", projectId, id: calculationId }, "Calculation · persisted engine evidence");
  return <section aria-label="Calculation execution and scientific result" data-testid="ai-calculation-result">
    <ActionButton small text="Inspect calculation & artifacts" onClick={openCalculation} disabled={!workspace || Boolean(workspace.unsavedWork)} />
    <details><summary>Calculation parameters & provenance</summary>
    <dl className="ai-approval-parameters">
      {[
        ["Task", spec.task_type], ["Engine", result ? `${result.producer_software.name} ${result.producer_software.version}` : spec.engine_preference.engine],
        ["Method / basis", `${spec.method.identifier} / ${spec.basis?.identifier ?? "not applicable"}`],
        ["Charge / multiplicity", `${spec.charge} / ${spec.multiplicity}`],
        ["Job status", detail.compute_job?.state ?? "Unavailable"], ["Execution status", detail.compute_execution?.state ?? "Not started"],
        ["Input structure version", input?.version.id ?? "Resolving immutable input…"],
        ["Recorded structure origin", input?.version.origin ?? "Unavailable"],
        ["Coordinate provenance", coordinateOriginLabel(input?.provenance?.coordinate_origin)],
        ["Input SHA-256", inputHash],
        ["Result validation", result?.validation_state ?? "No persisted result"],
        ["Independent verification", result ? describeScientificState(result).verification.label : "Not established"],
        ["Result provenance record", result?.provenance_record_id ?? "No persisted result"],
      ].map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}
    </dl>
    </details>
    {result ? <p>Independent verification: {describeScientificState(result).verification.label}.</p> : null}
    {spec.task_type === "ENERGY" ? <p>Single-point energy evaluates the recorded input coordinates; it does not establish a quantum-optimized geometry.</p> : null}
    {energy && result && input ? <EnergyPrecisionPlate projectId={projectId} calculationId={calculationId} resultId={result.id}
      calculationState={detail.calculation.state} method={energy.method ?? undefined} basis={energy.basis ?? null}
      engineName={result.producer_software.name} engineVersion={result.producer_software.version}
      energyValue={energy.total_energy.value} energyUnit={energy.total_energy.unit.code} converged={energy.converged}
      scfIterations={energy.scf_iterations} inputHash={inputHash} sourceClass={result.source_class} authority={result.authority}
      validationState={result.validation_state} verificationState={result.verification_state} effectiveState={result.effective_state}
      structureVersionId={input.version.id} structureId={input.structure.id} structureName={input.structure.name}
      provenanceRecordId={result.provenance_record_id} rawPayload={energy as unknown as Record<string, unknown>} compact /> :
      <p>{!fresh ? "Current result status unavailable. Reload calculation before relying on numerical values." : result ? "Numerical summary unavailable until current result authority and immutable input are established. Inspect the calculation for task-specific evidence." : "RESULT NOT AVAILABLE. No persisted engine result; no scientific values are inferred."}</p>}
    {inputError ? <p role="alert">{inputError} Use Reload calculation to retry.</p> : null}
    {energy && result && input ? <details><summary>Scientific summary & native log</summary><CalculationScientificSummary key={result.id} projectId={projectId} detail={detail} input={input} /></details> : null}
    {detail.attempt?.failure_code ? <p role="alert">{detail.attempt.failure_code}: {detail.attempt.diagnostic ?? "Execution failed. Inspect the calculation, then request a new proposal for recovery."}</p> : null}
  </section>;
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const label = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "Unavailable";

/** A preview of the exact fingerprint-bound approval, never an executable plan of its own. */
export function ApprovalGeometryTable({ coordinates }: { coordinates: CoordinateSet }) {
  const unit = coordinates.unit === "angstrom" ? "Angstrom" : coordinates.unit === "bohr" ? "Bohr" : "Fractional";
  return <div className="ai-approval-geometry" data-testid="ai-approval-geometry">
    <p>Units: {unit} · Coordinate system: {coordinates.coordinate_system === "CARTESIAN" ? "Cartesian" : coordinates.coordinate_system === "FRACTIONAL" ? "Fractional" : coordinates.coordinate_system}</p>
    <p className="coordinate-scroll-hint">Scroll horizontally to see all coordinates. Focus the table and use the arrow keys, or swipe.</p>
    <div className="ai-approval-coordinate-scroll" tabIndex={0} role="region" aria-label="Coordinates to be submitted">
      <table className="ai-approval-coordinates">
        <caption>Persisted coordinates of structure version {coordinates.structure_version_id} (shown to 0.01 Å; exact values in the raw bound arguments and the structure record)</caption>
        <thead><tr><th scope="col">Atom</th><th scope="col">Element</th><th scope="col">Atomic number</th><th scope="col">X</th><th scope="col">Y</th><th scope="col">Z</th></tr></thead>
        <tbody>{coordinates.atoms.map(atom => <tr key={atom.index}>
          <th scope="row">{atom.index + 1}</th><td>{atom.element}{atom.isotope ? ` (${atom.isotope})` : ""}</td><td>{atom.atomic_number}</td>
          <td>{approvalCoordinate(atom.x)}</td><td>{approvalCoordinate(atom.y)}</td><td>{approvalCoordinate(atom.z)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

export interface ResolvedProposalStructure {
  structureName: string | null;
  revision: number | null;
  formula: string | null;
  coordinateOrigin: string | null;
  engineAvailability: string | null;
}

/**
 * `full` (default) is the self-contained proposal. `geometry` is used by the approval screen,
 * which shows parameters, rationale and estimate itself: it keeps the exact-geometry check,
 * coordinate table, provenance, engine availability and limitations.
 */
export function CalculationProposal({ approval, onGeometryReady, onResolved, variant = "full" }: {
  approval: AIApprovalView;
  onGeometryReady?: (ready: boolean) => void;
  onResolved?: (structure: ResolvedProposalStructure) => void;
  variant?: "full" | "geometry";
}) {
  const args = approval.normalized_arguments ?? {};
  const spec = record(args.specification);
  const target = record(args.structure_version);
  const engine = label(record(spec.engine_preference).engine);
  const versionId = label(target.entity_id);
  const [metadata, setMetadata] = useState<{ key: string; version?: StructureVersionDetail | undefined; capabilities?: EngineCapabilityView[] | undefined; error?: string } | null>(null);
  const key = approvalGeometryKey(approval);
  useEffect(() => {
    if (!approval.project_id) return;
    let alive = true;
    const projectId = approval.project_id;
    const version = listStructures(projectId).then(async structures => {
      // Resolve only an exact authoritative version; no latest-version substitution.
      const versions = (await Promise.all(structures.map(structure => listStructureVersions(projectId, structure.id)))).flat();
      const match = versions.find(item => item.version.id === versionId);
      if (match) { approvalGeometry(approval, match); return match; }
      throw new Error("Target authoritative structure version is unavailable.");
    });
    void Promise.allSettled([version, listCalculationCapabilities(projectId)]).then(([structure, capabilities]) => {
      if (alive) setMetadata({ key, version: structure.status === "fulfilled" ? structure.value : undefined,
        capabilities: capabilities.status === "fulfilled" ? capabilities.value : undefined,
        error: [structure, capabilities].filter(result => result.status === "rejected").map(result => String((result as PromiseRejectedResult).reason)).join("; ") });
    });
    return () => { alive = false; };
  // The key includes the fingerprint and all bound arguments, so a changed
  // proposal cannot reuse geometry from a prior approval or electronic state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const saved = metadata?.key === key ? metadata : null;
  useEffect(() => { onGeometryReady?.(Boolean(saved?.version)); }, [saved?.version, onGeometryReady]);
  const capability = saved?.capabilities?.find(item => item.engine === engine);
  const formula = deriveMolecularFormula(saved?.version?.version.coordinates?.atoms, { useSubscripts: false });
  const estimate = approval.estimated_compute;
  const runtime = estimate?.runtime_low_seconds != null || estimate?.runtime_high_seconds != null
    ? `${estimate.runtime_low_seconds ?? "unavailable"}–${estimate.runtime_high_seconds ?? "unavailable"} seconds` : "Estimate unavailable";
  const engineAvailability = capability ? `${capability.availability}${capability.diagnostic ? ` · ${capability.diagnostic}` : ""}` : saved ? "Availability unavailable" : "Checking engine availability…";
  const coordinateOrigin = saved ? coordinateOriginLabel(saved.version?.provenance?.coordinate_origin) : null;
  const structureName = saved?.version?.structure.name ?? null;
  const revision = saved?.version?.version.revision ?? null;
  useEffect(() => {
    if (saved) onResolved?.({ structureName, revision, formula: formula || null, coordinateOrigin, engineAvailability });
  }, [saved, structureName, revision, formula, coordinateOrigin, engineAvailability, onResolved]);
  if (variant === "geometry") {
    return <section aria-label="Molecular geometry" data-testid="ai-calculation-proposal" className="ai-proposal-geometry-section">
      <dl className="ai-approval-parameters">
        {[
          ["Chemical formula (persisted coordinates)", formula || (saved ? "Unavailable" : "Resolving authoritative structure…")],
          ["Coordinate provenance", !saved ? "Resolving authoritative structure…"
            : saved.version?.provenance?.coordinate_origin ? humanizeDetail(coordinateOrigin)
            : saved.version?.version.origin ? humanizeDetail(`Origin: ${saved.version.version.origin} · coordinate origin not declared`) : humanizeDetail(coordinateOrigin)],
          ["Engine availability (reported)", engineAvailability === "AVAILABLE" ? "Available on this deployment" : humanizeDetail(engineAvailability)],
        ].map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}
      </dl>
      {saved?.version?.version.coordinates ? <ApprovalGeometryTable coordinates={saved.version.version.coordinates} /> :
        <p role="status">{saved?.error ? "Exact geometry unavailable; approval is blocked. Reload the approval." : "Loading exact geometry; approval is unavailable until it is verified."}</p>}
      {saved?.error ? <p role="alert">{saved.error}</p> : null}
      <ul className="ai-proposal-limitations-list" aria-label="Limitations">
        <li>Charge and spin multiplicity are the approval-bound values and must match any electronic state recorded with the accepted structure version.</li>
        <li>Electron-count parity is a necessary consistency check only; it does not establish the physical spin state.</li>
        <li>Elements and methods outside the validated range of the selected engine are refused by the backend.</li>
        <li>Human promotion establishes an accepted input structure, not an optimized or experimental geometry.</li>
        <li>Calculation results exist only when persisted engine records are available.</li>
      </ul>
    </section>;
  }
  return <section aria-label="Calculation proposal" data-testid="ai-calculation-proposal">
    <strong>Calculation proposed · awaiting human decision</strong>
    <dl className="ai-approval-parameters">
      {[
        ["Authoritative structure version", versionId], ["Chemical formula (persisted coordinates)", formula || (saved ? "Unavailable" : "Resolving authoritative structure…")],
        ["Coordinate provenance", coordinateOrigin ?? "Resolving authoritative structure…"],
        ["Charge", label(spec.charge)], ["Multiplicity", label(spec.multiplicity)],
        ["Calculation type", label(spec.task_type)], ["Engine", engine],
        ["Method", label(record(spec.method).identifier)], ["Basis set", label(record(spec.basis).identifier)],
        ["Engine availability", engineAvailability],
        ["Approval status", approval.status], ["Execution status", "Proposed; this approval has not submitted the calculation"],
      ].map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}
    </dl>
    {saved?.version?.version.coordinates ? <ApprovalGeometryTable coordinates={saved.version.version.coordinates} /> :
      <p role="status">{saved?.error ? "Exact geometry unavailable; approval is blocked. Reload the approval." : "Loading exact geometry; approval is unavailable until it is verified."}</p>}
    <p>Scientific rationale: {approval.scientific_summary} {approval.reason}</p>
    <p>{estimate ? `Compute provider: ${estimate.provider_summary} · Runtime: ${runtime} · confidence ${estimate.confidence}` : "Estimate unavailable"}</p>
    {approval.estimated_compute ? <details><summary>Recorded estimate and assumptions</summary><pre>{JSON.stringify(approval.estimated_compute, null, 2)}</pre></details> : null}
    {saved?.error ? <p role="alert">{saved.error}</p> : null}
    <p>Limitations: charge and spin multiplicity are the approval-bound values and must match any electronic state recorded with the accepted structure version. Electron-count parity is a necessary consistency check only; it does not establish the physical spin state. Elements and methods outside the validated range of the selected engine are refused by the backend. Human promotion establishes an accepted input structure, not an optimized or experimental geometry. Calculation results exist only when persisted engine records are available.</p>
  </section>;
}
