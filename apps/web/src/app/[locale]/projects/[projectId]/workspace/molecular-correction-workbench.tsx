"use client";

import dynamic from "next/dynamic";
import { useOptionalWorkspaceState } from "@/app/_components/workspace-state-provider";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CandidateRepresentationDetail, CandidateRepresentationReviewChecklist, CandidateRepresentationView, MolecularGraphValidateOutput, StructureCandidate } from "@chemdft/schemas";
import { buildCandidatePreviewScene, DEFAULT_VISUALIZATION_STATE, type VisualizationState } from "@chemdft/scientific-scene";
import { ActionButton, StatusTag } from "@chemdft/ui";
import { CandidateApiError, createCandidateRepresentation, generateCandidateConformer, getCandidateFigureUrl, getCandidateRepresentation, listCandidateRepresentations, promoteStructureCandidate, reviewCandidateRepresentation, reviewStructureCandidate, validateCandidateGraph } from "@/lib/phase7-api";
import { latestRecognitionRepresentations } from "@/lib/recognition-proposal";
import { KetcherHost, type KetcherApi } from "./ketcher-editor";

const ThreeDMolViewport = dynamic(() => import("./visualization/three-dmol-viewport"), { ssr: false, loading: () => <p role="status">Loading 3Dmol.js…</p> });
const REVIEW_ITEMS = [
  ["inspected_source", "I inspected the original paper and figure."],
  ["understands_missing_paper_coordinates", "I understand this figure does not establish full atomic coordinates."],
  ["coordinate_source_declared", "I inspected the graph and coordinate provenance, including RDKit generation."],
  ["units_checked", "I checked the coordinate units."],
  ["cell_checked_if_used", "I checked the cell parameters, if used."],
  ["validation_warnings_reviewed", "I inspected the corrected graph and all validation warnings."],
  ["differences_acknowledged", "I inspected the differences from the original proposal and source figure."],
  ["stereochemistry_reviewed", "I explicitly reviewed R/S and E/Z stereochemistry, including unassigned sites."],
  ["charges_reviewed", "I explicitly reviewed formal charges, charge placement and isotopes."],
] as const satisfies readonly (readonly [keyof CandidateRepresentationReviewChecklist, string])[];
const emptyReview = (): CandidateRepresentationReviewChecklist => Object.fromEntries(REVIEW_ITEMS.map(([key]) => [key, false]));
const isGraph = (row: CandidateRepresentationView) => ["SMILES", "MOL", "MOL_BLOCK"].includes(row.representation_type);
// The MOL header line carries a timestamp, so unsaved-edit detection compares only the atom/bond body.
const molBody = (mol: string) => mol.split("\n").slice(3).join("\n");
const UNSAVED_WARNING = "You have unsaved molecular edits in Ketcher. Closing or leaving will discard them. Discard the edits?";
const graphContent = (row: CandidateRepresentationDetail) => row.mol_block ? { content: row.mol_block, format: "MOL" as const } : row.smiles ? { content: row.smiles, format: "SMILES" as const } : null;

export function MolecularCorrectionWorkbench({ projectId, candidate, onChanged, expectedRepresentationId }: {
  projectId: string; candidate: StructureCandidate; onChanged: () => void; expectedRepresentationId?: string | undefined;
}) {
  const workspace = useOptionalWorkspaceState();
  const setUnsavedWork = workspace?.setUnsavedWork;
  const [rows, setRows] = useState<CandidateRepresentationView[]>([]);
  const [selected, setSelected] = useState<CandidateRepresentationDetail | null>(null);
  const [graph, setGraph] = useState<CandidateRepresentationDetail | null>(null);
  const [validation, setValidation] = useState<MolecularGraphValidateOutput | null>(null);
  const [editorInput, setEditorInput] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editor, setEditor] = useState<KetcherApi | null>(null);
  const [draftValidation, setDraftValidation] = useState<MolecularGraphValidateOutput | null>(null);
  const [review, setReview] = useState(emptyReview);
  const [candidateReviewed, setCandidateReviewed] = useState(candidate.candidate_state === "REVIEWED");
  const [promoted, setPromoted] = useState(candidate.candidate_state === "PROMOTED");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<VisualizationState>({ ...DEFAULT_VISUALIZATION_STATE, representation: "ball-stick" });
  const lock = useRef(false);
  const drawingEpoch = useRef(0);
  const baseline = useRef<string | null>(null);
  const unsaved = useRef(false);
  const selectionEpoch = useRef(0);
  const knownRevision = useRef(0);
  const parentId = useRef<string | null>(null);
  const originalId = useRef<string | null>(null);
  const storageKey = `chemdft:b3-revision:${projectId}:${candidate.id}`;
  const complete = REVIEW_ITEMS.every(([key]) => review[key] === true);
  const recordedComplete = REVIEW_ITEMS.every(([key]) => selected?.review_checklist?.[key] === true);
  const explicitConformer = selected?.coordinate_provenance?.origin === "GENERATED_CONFORMER" && selected.representation_origin !== "DERIVED_PREVIEW";
  const derivedPreview = selected?.representation_origin === "DERIVED_PREVIEW";
  const closed = promoted || candidate.candidate_state === "PROMOTED" || candidate.candidate_state === "REJECTED";

  const preview = useMemo(() => selected?.coordinate_representation ? buildCandidatePreviewScene({
    candidateId: candidate.id, representationId: selected.id, representationRevision: selected.revision, representation: selected.coordinate_representation,
  }) : null, [candidate.id, selected]);

  const fetchRows = useCallback(async () => {
    const out = await listCandidateRepresentations(projectId, candidate.id);
    const next = [...(out.representations ?? [])].sort((a, b) => a.revision - b.revision);
    if (!originalId.current) originalId.current = latestRecognitionRepresentations(next).smiles?.id ?? null;
    return next;
  }, [projectId, candidate.id]);

  const selectRevision = useCallback(async (id: string) => {
    const epoch = ++selectionEpoch.current;
    const detail = await getCandidateRepresentation(projectId, candidate.id, id);
    let source = detail;
    const visited = new Set<string>();
    while (!isGraph(source) && source.source_representation_id && !visited.has(source.id)) {
      visited.add(source.id);
      source = await getCandidateRepresentation(projectId, candidate.id, source.source_representation_id);
    }
    // Compare with this correction's actual recognition ancestor, even if a newer recognition
    // was appended elsewhere in the candidate history.
    let ancestor = source;
    const lineage = new Set<string>();
    while (!(ancestor.representation_origin === "IMAGE_RECONSTRUCTION" && ancestor.representation_type === "SMILES") && ancestor.source_representation_id && !lineage.has(ancestor.id)) {
      lineage.add(ancestor.id);
      ancestor = await getCandidateRepresentation(projectId, candidate.id, ancestor.source_representation_id);
    }
    const comparisonId = ancestor.representation_origin === "IMAGE_RECONSTRUCTION" && ancestor.representation_type === "SMILES" ? ancestor.id : originalId.current;
    const content = graphContent(source);
    const result = content ? await validateCandidateGraph(projectId, candidate.id, { ...content, ...(comparisonId ? { parent_representation_id: comparisonId } : {}) }) : null;
    if (epoch !== selectionEpoch.current) return;
    originalId.current = comparisonId;
    setSelected(detail);
    setGraph(isGraph(source) ? source : null);
    setValidation(result);
    setReview({ ...emptyReview(), ...(detail.review_state === "REVIEWED" ? detail.review_checklist : {}) });
    try { localStorage.setItem(storageKey, id); } catch { /* Server revisions remain available without local preferences. */ }
  }, [projectId, candidate.id, storageKey]);

  useEffect(() => {
    let alive = true;
    void fetchRows().then(async (next) => {
      if (!alive) return;
      setRows(next);
      knownRevision.current = next.at(-1)?.revision ?? 0;
      let saved: string | null = null;
      try { saved = localStorage.getItem(storageKey); } catch { /* Optional selection preference. */ }
      const initial = expectedRepresentationId ? next.find(r => r.id === expectedRepresentationId) : next.find((r) => r.id === saved) ?? [...next].reverse().find((r) => isGraph(r) || r.coordinate_provenance?.origin === "GENERATED_CONFORMER");
      if (expectedRepresentationId && !initial) throw new Error("The requested representation is unavailable. No other revision was selected.");
      if (initial) await selectRevision(initial.id);
    }).catch((cause: unknown) => { if (alive) setError(cause instanceof Error ? cause.message : "Unable to load revisions."); });
    return () => { alive = false; selectionEpoch.current += 1; drawingEpoch.current += 1; };
  }, [fetchRows, selectRevision, storageKey, expectedRepresentationId]);

  // Register the open correction drawing with the shared workstation navigation guard.
  useEffect(() => {
    if (!editing) return;
    setUnsavedWork?.("An open molecular correction drawing in Ketcher may contain unsaved edits.");
    return () => setUnsavedWork?.(null);
  }, [editing, setUnsavedWork]);

  useEffect(() => {
    if (!editor?.changeEvent) return;
    let alive = true;
    baseline.current = null;
    unsaved.current = false;
    void editor.getMolfile().then((mol) => { if (alive && baseline.current === null) baseline.current = molBody(mol); }).catch(() => { /* Dirty tracking is best effort; the backend remains authoritative. */ });
    const changed = () => {
      drawingEpoch.current += 1;
      setDraftValidation(null);
      void editor.getMolfile().then((mol) => { if (alive && baseline.current !== null) unsaved.current = molBody(mol) !== baseline.current; }).catch(() => { unsaved.current = true; });
    };
    editor.changeEvent.add(changed);
    return () => { alive = false; editor.changeEvent?.remove(changed); };
  }, [editor]);

  useEffect(() => {
    if (!editing) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!unsaved.current) return;
      event.preventDefault();
      event.returnValue = UNSAVED_WARNING;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editing]);

  async function closeEditor() {
    let dirty = unsaved.current;
    if (editor && baseline.current !== null) {
      try { dirty = molBody(await editor.getMolfile()) !== baseline.current; } catch { /* Fall back to the tracked flag. */ }
    }
    if (dirty && !window.confirm(UNSAVED_WARNING)) return;
    unsaved.current = false;
    setEditing(false); setEditor(null); setDraftValidation(null);
  }

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed; your drawing is still open."); }
    finally { lock.current = false; setBusy(false); }
  }

  async function refresh(id?: string) {
    const next = await fetchRows();
    setRows(next);
    knownRevision.current = next.at(-1)?.revision ?? 0;
    if (id) await selectRevision(id);
    onChanged();
  }

  async function checkRevision() {
    const next = await fetchRows();
    if ((next.at(-1)?.revision ?? 0) !== knownRevision.current) {
      setRows(next);
      throw new CandidateApiError(409, "HTTP 409: Revision history changed since you opened it. Your edits are kept. Reload revision history, inspect the new revisions, then explicitly save again if appropriate.");
    }
  }

  function openEditor() {
    if (!graph) return;
    parentId.current = graph.id;
    setEditorInput(graph.mol_block ?? graph.smiles ?? null);
    setDraftValidation(null);
    setEditor(null);
    drawingEpoch.current += 1;
    setEditing(true);
    setNotice("Editing a 2D molecular graph. Saving appends a revision; it does not accept the molecule.");
  }

  async function validateDraft(save: boolean) {
    if (!editor || !parentId.current) return;
    const epoch = drawingEpoch.current;
    const mol = await editor.getMolfile(); // Preserve header and blank title line verbatim.
    const result = await validateCandidateGraph(projectId, candidate.id, {
      content: mol, format: "MOL", parent_representation_id: originalId.current ?? parentId.current,
    });
    if (epoch !== drawingEpoch.current) throw new Error("Drawing changed during validation. Validate the current drawing again.");
    setDraftValidation(result);
    if (!save) return;
    if (!result.is_valid) throw new Error("Invalid molecular graph. Correct the validation diagnostics before saving.");
    await checkRevision();
    if (epoch !== drawingEpoch.current) throw new Error("Drawing changed before saving. Validate and save again.");
    const out = await createCandidateRepresentation(projectId, candidate.id, {
      representation_type: "MOL", mol_block: mol, parent_representation_id: parentId.current,
    });
    await refresh(out.representation.id);
    // If the researcher continued drawing while the server saved, keep their newer drawing open.
    if (epoch === drawingEpoch.current) { unsaved.current = false; setEditing(false); setEditor(null); }
    setNotice(`Saved R${out.representation.revision}. Original prediction retained. Any automatic derived preview is non-promotable; explicitly generate a conformer to continue.`);
  }

  async function generate() {
    if (!graph || !validation?.can_generate_3d) return;
    await checkRevision();
    const out = await generateCandidateConformer(projectId, candidate.id, graph.id, {
      name: `Researcher conformer from R${graph.revision}`, multiplicity: 1,
    });
    await refresh(out.representation.id);
    setNotice("Explicit ETKDGv3 conformer generated. Review is still required; physical spin-state correctness is not established.");
  }

  return <section className="candidate-representation-workbench b3-workbench" aria-label="Molecular correction workflow" data-testid="b3-workbench">
    <div className="candidate-representation-heading"><strong>Correct molecular graph · generate · review · promote</strong><span>Validated graph, researcher reviewed representation, and promoted structure are separate states.</span></div>
    <p className="candidate-preview-warning" role="note">Deterministic RDKit validation checks chemical consistency. It does not prove that DECIMER recognized the source diagram correctly, or that the structure is experimentally correct.</p>
    {promoted ? <p role="status"><StatusTag intent="success">PROMOTED STRUCTURE</StatusTag> Researcher acceptance recorded. The source proposal and revision history remain available.</p> : null}
    {error ? <p role="alert" className="workspace-document-error">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <div className="phase7-actions">
      <ActionButton text="Reload revision history" disabled={busy} onClick={() => void run(async () => { await refresh(); setNotice("History reloaded. Inspect revisions before resubmitting; no mutation was retried."); })} />
      <ActionButton text="Correct graph in Ketcher" disabled={busy || !graph || editing || closed} onClick={openEditor} />
    </div>
    <label>Saved representation revision <select aria-label="Saved representation revision" disabled={busy || editing} value={selected?.id ?? ""} onChange={(e) => { const id = e.currentTarget.value; void run(() => selectRevision(id)); }}>
      <option value="" disabled>Choose revision</option>
      {rows.map((r) => <option key={r.id} value={r.id}>R{r.revision} · {r.representation_type} · {r.representation_origin} · {r.review_state}</option>)}
    </select></label>
    {selected ? <p data-testid="b3-current-revision">Current saved revision: R{selected.revision} · {selected.validation_state} · {selected.review_state} · parent {selected.source_representation_id ?? "none"}</p> : null}
    <details><summary>Immutable revision history ({rows.length})</summary>{rows.map((r) => <p key={r.id}>R{r.revision} · {r.method} · {r.representation_origin} · {r.validation_state} · {r.review_state}<br />Parent: {r.source_representation_id ?? "none"} · {r.created_at}<br />{r.validation_diagnostics?.join(" ")}</p>)}</details>
    {editing ? <div className="b3-correction-comparison">
      <div><strong>Original scientific figure</strong>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={getCandidateFigureUrl(projectId, candidate.id)} alt="Original scientific figure for molecular correction" />
        <p>Compare atom identity, bonds, charges, isotopes, and stereochemical markings with the source.</p>
      </div>
      <div><strong>Researcher-corrected graph · Ketcher</strong><div className="ketcher-frame"><KetcherHost initialMolfile={editorInput} onInit={setEditor} onError={setError} /></div>
        <div className="phase7-actions">
          <ActionButton text="Validate edited graph" disabled={busy || !editor} onClick={() => void run(() => validateDraft(false))} />
          <ActionButton intent="primary" text="Save corrected representation" disabled={busy || !editor || draftValidation?.is_valid === false} onClick={() => void run(() => validateDraft(true))} />
          <ActionButton text="Close editor" disabled={busy} onClick={() => void closeEditor()} />
        </div>
        <p role="note">Unsaved edits remain in this open editor after API errors. Closing the editor or leaving this page discards them; you will be asked to confirm. There is no autosave.</p>
      </div>
    </div> : null}
    {editing && !draftValidation ? <p role="status">The current drawing has not been validated. Edits invalidate earlier validation.</p> : null}
    {(editing ? draftValidation : validation) ? <GraphValidationResults result={(editing ? draftValidation : validation)!} /> : null}
    {!editing && graph && !closed ? <div className="phase7-actions"><ActionButton text="Generate 3D conformer explicitly" intent="primary" disabled={busy || !validation?.can_generate_3d || graph.validation_state === "INVALID"} onClick={() => void run(generate)} /></div> : null}
    <p className="workspace-muted">3D generation is synchronous and restricted to supported single closed-shell molecules, ≤200 heavy atoms, with assigned stereochemistry. Coordination chemistry, salts, and radicals are restricted. No quantum mechanical optimization is performed; O₂ spin multiplicity may be misclassified.</p>
    {preview ? <section className="candidate-preview" aria-label="Generated geometry inspection">
      <strong>{explicitConformer ? "GENERATED CONFORMER — NOT QM OPTIMIZED" : derivedPreview ? "DERIVED PREVIEW — NOT PROMOTABLE" : "IMPORTED COORDINATES — GRAPH CONSISTENCY NOT VERIFIED"}</strong>
      <p className="candidate-preview-warning" role="note">{explicitConformer || derivedPreview ? "This geometry was generated using RDKit ETKDGv3 and is not an experimentally determined or DFT-optimized structure. Physical spin-state correctness is not established." : "Imported coordinates require separate graph consistency verification. Their origin does not establish agreement with the recognized graph or experimental correctness."}</p>
      <p>Formula: {validation?.formula ?? "Unavailable"} · Formal charge: {validation?.formal_charge ?? "Unavailable"}</p>
      <div className="candidate-preview-toolbar">
        <label>Conformer style <select aria-label="Conformer style" value={view.representation} onChange={(e) => setView({ ...view, representation: e.currentTarget.value as VisualizationState["representation"] })}><option value="ball-stick">Ball and stick</option><option value="sticks">Sticks</option><option value="space-fill">Space fill</option></select></label>
        <label>Conformer atom labels <select aria-label="Conformer atom labels" value={view.labels} onChange={(e) => setView({ ...view, labels: e.currentTarget.value as VisualizationState["labels"] })}><option value="none">Off</option><option value="element">Element</option><option value="index">Atom index</option></select></label>
      </div>
      <div className="candidate-preview-viewport" data-testid="b3-conformer-viewport"><ThreeDMolViewport key={selected!.id} scene={preview.renderable} state={view} selectedAtomIndex={null} measurementAtomIndices={[]} onSelectAtom={() => {}} cameraStorageKey={`chemdft:b3-camera:${selected!.id}`} /></div>
      <p>Drag to rotate · scroll to zoom · right-drag to pan. Colors identify elements.</p>
      <details><summary>Graph, coordinate and generation provenance</summary><pre>{JSON.stringify({ graph_revision: graph?.revision, graph_id: graph?.id, source_representation_id: selected?.source_representation_id, method: selected?.method, method_version: selected?.method_version, coordinate_provenance: selected?.coordinate_provenance, generation_parameters: selected?.generation_parameters }, null, 2)}</pre></details>
    </section> : null}
    {explicitConformer && !editing && !closed ? <>
      {selected?.review_state === "REVIEWED" && !recordedComplete ? <p role="note" className="candidate-preview-warning">The recorded review lacks explicit confirmations. Complete and resubmit the checklist before promotion.</p> : null}
      <fieldset className="candidate-review-checklist" disabled={busy || (selected?.review_state === "REVIEWED" && recordedComplete)}><legend>Scientific review · explicit researcher confirmations</legend>{REVIEW_ITEMS.map(([key, label]) => <label key={key}><input type="checkbox" checked={review[key] === true} onChange={(e) => setReview({ ...review, [key]: e.currentTarget.checked })} />{label}</label>)}</fieldset>
      <div className="phase7-actions">
        <ActionButton text="Record source candidate review" disabled={busy || candidateReviewed || candidate.candidate_state === "REVIEWED"} onClick={() => void run(async () => { await reviewStructureCandidate(projectId, candidate.id); setCandidateReviewed(true); onChanged(); })} />
        <ActionButton text="Record conformer review" disabled={busy || !complete || (selected?.review_state === "REVIEWED" && recordedComplete)} onClick={() => void run(async () => {
          if (!selected) return;
          const out = await reviewCandidateRepresentation(projectId, candidate.id, selected.id, review);
          setSelected(out.representation);
          setNotice("RESEARCHER REVIEWED. This is still a candidate until explicit promotion.");
          onChanged();
        })} />
        <ActionButton text="Promote reviewed structure" intent="primary" disabled={busy || !(candidateReviewed || candidate.candidate_state === "REVIEWED") || !complete || !recordedComplete || selected?.review_state !== "REVIEWED"} onClick={() => void run(async () => {
          if (!selected) return;
          await promoteStructureCandidate(projectId, candidate.id, selected.id);
          setPromoted(true);
          setNotice("PROMOTED STRUCTURE. An immutable StructureVersion was created with source lineage and researcher review.");
          onChanged();
        })} />
      </div>
      <p role="note">All confirmations start unchecked. The backend determines required reviews and remains authoritative for promotion eligibility.</p>
    </> : null}
  </section>;
}

export function GraphValidationResults({ result }: { result: MolecularGraphValidateOutput }) {
  const differences = result.differences_from_parent ?? [];
  return <section aria-label="Scientific graph validation" data-testid="b3-validation">
    <h3>{result.is_valid ? "VALIDATED GRAPH" : "INVALID GRAPH"}</h3>
    <dl className="provenance-list">
      <div><dt>Molecular formula</dt><dd>{result.formula ?? "Unavailable"}</dd></div>
      <div><dt>Canonical isomeric SMILES</dt><dd><code>{result.canonical_isomeric_smiles ?? "Unavailable"}</code></dd></div>
      <div><dt>Formal charge</dt><dd>{result.formal_charge ?? "Unavailable"}</dd></div>
      <div><dt>Heavy atom count</dt><dd>{result.heavy_atom_count ?? "Unavailable"}</dd></div>
      <div><dt>Elements</dt><dd>{result.elements?.join(", ") || "None reported"}</dd></div>
      <div><dt>Stereocenters (backend atom indices)</dt><dd>{result.stereocenters?.map((s) => `${s.element} ${s.atom_index}: ${s.stereo}${s.is_assigned ? "" : " (unassigned)"}`).join("; ") || "None reported"}</dd></div>
      <div><dt>E/Z double bonds (backend indices)</dt><dd>{result.double_bond_stereochemistry?.map((b) => `Bond ${b.bond_index}, atoms ${b.begin_atom_index}–${b.end_atom_index}: ${b.stereo}${b.is_assigned ? "" : " (unassigned)"}`).join("; ") || "None reported"}</dd></div>
      <div><dt>Unassigned stereochemistry</dt><dd>{[...(result.unassigned_stereocenters ?? []), ...(result.unassigned_double_bonds ?? [])].join("; ") || "None reported"}</dd></div>
      <div><dt>Unsupported elements</dt><dd>{result.unsupported_elements?.join(", ") || "None reported"}</dd></div>
      <div><dt>Disconnected fragments</dt><dd>{result.disconnected_fragments ?? "Unavailable"} · {result.fragment_formulas?.join(", ")}</dd></div>
      <div><dt>3D generation eligibility</dt><dd>{result.can_generate_3d ? "Eligible for explicit generation" : "Blocked — inspect diagnostics"}</dd></div>
    </dl>
    <div className="candidate-preview-warning" role="note"><strong>Backend validation warnings and diagnostics</strong><ul>{[...(result.validation_warnings ?? []), ...(result.validation_diagnostics ?? [])].map((warning, i) => <li key={i}>{warning}</li>)}</ul></div>
    <div data-testid="b3-differences"><h4>Original DECIMER proposal → corrected graph</h4>
      <p>These structured differences come from the backend. Summaries are not an atom mapping; no individual atom highlights are inferred.</p>
      {differences.length ? <table><thead><tr><th>Change</th><th>Original</th><th>Corrected</th></tr></thead><tbody>{differences.map((d, i) => <tr key={i}><td><strong>{d.category}</strong><br />{d.description}</td><td>{d.original_value ?? "Unavailable"}</td><td>{d.corrected_value ?? "Unavailable"}</td></tr>)}</tbody></table> : <p>{result.is_valid ? "No differences reported by the backend." : "Differences unavailable until the graph is valid."}</p>}
    </div>
  </section>;
}
