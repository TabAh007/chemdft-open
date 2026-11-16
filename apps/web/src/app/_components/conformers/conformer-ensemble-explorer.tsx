"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { ArtifactReference, CalculationDetail, ConformerEnsembleResult, StructureVersionDetail } from "@chemdft/schemas";
import { inferVisualBonds, type VisualizationState } from "@chemdft/scientific-scene";
import { associatedConformerEnsemble, convergenceLabel, ensembleSelectionKey, groupArtifacts, memberLabel, sceneForConformerMember, selectedEnsembleMember, shortId } from "@/lib/conformer-ensemble";
import { formatCoordinateAngstrom } from "@/lib/quantity-format";
import { ViewerToolbar, ViewerCaption, STATIC_VIEWER_CAPTION } from "@/app/_components/viewer-toolbar";
import { downloadCalculationArtifact } from "@/lib/structure-workspace-api";
import { saveArtifact } from "./conformer-search-panel";

const coordinateText = (value: number) => formatCoordinateAngstrom(Object.is(value, -0) ? 0 : value);

const StructureViewport = dynamic(() => import("@/app/[locale]/projects/[projectId]/workspace/visualization/structure-viewport").then((m) => m.StructureViewport), {
  ssr: false, loading: () => <div className="viewport-fallback">Loading retained geometry…</div>,
});

export function ConformerEnsembleExplorer({ projectId, calculationId, resultId, detail, inputStructure, onInspectInput, active = true }: {
  projectId: string; calculationId: string; resultId: string; detail: CalculationDetail;
  inputStructure?: StructureVersionDetail | undefined; onInspectInput?: (() => void) | undefined; active?: boolean;
}) {
  let payload: ConformerEnsembleResult;
  try {
    payload = associatedConformerEnsemble(detail, projectId, calculationId, resultId);
    if (inputStructure && (inputStructure.structure.project_id !== projectId || inputStructure.version.id !== payload.manifest.input_structure_version_id)) {
      throw new Error("The input StructureVersion does not match this ensemble.");
    }
  } catch (cause) {
    return <p role="alert" data-testid="conformer-association-error">{cause instanceof Error ? cause.message : "The selected ensemble cannot be displayed."}</p>;
  }
  return <BoundEnsemble key={ensembleSelectionKey(projectId, calculationId, resultId, payload)}
    projectId={projectId} calculationId={calculationId} resultId={resultId} detail={detail} payload={payload} active={active}
    inputLabel={inputStructure ? `${inputStructure.structure.name} V${inputStructure.version.revision}` : "Original StructureVersion"}
    onInspectInput={onInspectInput} />;
}

function BoundEnsemble({ projectId, calculationId, resultId, detail, payload, inputLabel, onInspectInput, active }: {
  projectId: string; calculationId: string; resultId: string; detail: CalculationDetail; payload: ConformerEnsembleResult;
  active: boolean; inputLabel: string; onInspectInput: (() => void) | undefined;
}) {
  const manifest = payload.manifest;
  const storageKey = ensembleSelectionKey(projectId, calculationId, resultId, payload);
  const [selectedId, setSelectedId] = useState<string>(() => {
    let saved: string | null = null;
    try { if (typeof window !== "undefined") saved = window.localStorage.getItem(storageKey); } catch { /* Selection remains usable without storage. */ }
    return selectedEnsembleMember(payload, saved).conformer.id;
  });
  const member = selectedEnsembleMember(payload, selectedId);
  const conformer = member.conformer;
  const scene = useMemo(() => sceneForConformerMember(payload, selectedId), [payload, selectedId]);
  const visualBonds = useMemo(() => inferVisualBonds(scene), [scene]);
  const [representation, setRepresentation] = useState<VisualizationState["representation"]>("ball-stick");
  const [fitToken, setFitToken] = useState(0);
  const [artifactNotice, setArtifactNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; text: string } | null>(null);
  useEffect(() => {
    try { window.localStorage.setItem(storageKey, conformer.id); } catch { /* No scientific state depends on local storage. */ }
    if (!active) return;
    window.dispatchEvent(new CustomEvent("chemdft:workspace-selection", { detail: {
      projectId, calculationId, resultId,
      currentView: `CREST ensemble · ${inputLabel} → ${memberLabel(member.application_rank, manifest.members.length)} · member ${shortId(conformer.id)} · ensemble ${shortId(manifest.execution_id)} · minimum not verified`,
    } }));
  }, [active, storageKey, conformer.id, projectId, calculationId, resultId, inputLabel, member.application_rank, manifest.members.length, manifest.execution_id]);

  async function artifactAction(artifact: ArtifactReference, name: string, inspect: boolean) {
    setArtifactNotice(null);
    try {
      const { blob, filename } = await downloadCalculationArtifact({ projectId, calculationId, artifactId: artifact.artifact_id });
      const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (sha256 !== artifact.sha256) throw new Error("Downloaded evidence hash does not match this ensemble.");
      if (inspect) setPreview({ name, text: await blob.slice(0, 65536).text() });
      else saveArtifact(blob, filename);
    } catch (cause) { setArtifactNotice(cause instanceof Error ? cause.message : "Native artifact could not be read."); }
  }
  function keyboardSelect(event: React.KeyboardEvent<HTMLTableElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !(event.target instanceof HTMLButtonElement)) return;
    event.preventDefault();
    const index = manifest.members.findIndex((item) => item.conformer.id === conformer.id);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? manifest.members.length - 1 : Math.max(0, Math.min(manifest.members.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    const next = manifest.members[nextIndex]!; setSelectedId(next.conformer.id);
    event.currentTarget.querySelector<HTMLButtonElement>(`button[data-member-id="${next.conformer.id}"]`)?.focus();
  }
  return <section className="conformer-explorer" aria-label="CREST conformer ensemble" data-testid="conformer-ensemble"
    data-project-id={projectId} data-calculation-id={calculationId} data-result-id={resultId}
    data-ensemble-id={manifest.execution_id} data-manifest-sha256={payload.manifest_artifact.sha256} data-member-id={conformer.id}>
    <header className="conformer-header"><div><h2>CREST ensemble</h2><p>{inputLabel} · {manifest.members.length} retained {manifest.members.length === 1 ? "member" : "members"}</p></div>
      <strong className="conformer-complete">Search completed</strong></header>
    <div className="conformer-disclosure" role="note"><strong>Minimum status: not verified</strong>
      <p>The engine result is {String(detail.result!.validation_state).toLowerCase()}; the lowest-energy structure is not verified as a minimum, because no vibrational (Hessian) check was run. Native geometry convergence: {convergenceLabel(String(member.geometry_convergence))}. Gradient convergence does not prove that a structure is a local minimum.</p>
      <details className="conformer-technical"><summary>Technical details</summary><code>geometry_convergence = {String(member.geometry_convergence)} · minimum status = UNVERIFIED</code></details>
    </div>
    <div className="conformer-workspace">
      <div className="conformer-geometry">
        <div className="conformer-toolbar"><strong>Retained geometry · {memberLabel(member.application_rank, manifest.members.length)}</strong></div>
        <div className="conformer-viewport" data-testid="conformer-geometry" data-scene-id={scene.id} data-native-record-sha256={member.native_record_sha256}>
          <StructureViewport scene={scene} visualBonds={visualBonds} representation={representation} fitToken={fitToken} cameraStorageKey={`${storageKey}:camera`} />
        </div>
        <ViewerToolbar testIdPrefix="conformer" style={representation}
          styleOptions={[{ value: "ball-stick", label: "Ball and stick" }, { value: "sticks", label: "Sticks" }, { value: "wireframe", label: "Wireframe" }, { value: "space-fill", label: "Space filling" }]}
          onStyleChange={(value) => setRepresentation(value as VisualizationState["representation"])} onReset={() => setFitToken((value) => value + 1)} />
        <ViewerCaption testId="conformer-viewer-caption">{STATIC_VIEWER_CAPTION}</ViewerCaption>
        <p className="conformer-caption">Coordinates from the selected CREST member in Å. Bonds are inferred for display; connectivity is not independently verified.</p>
      </div>
      <div className="conformer-ranking">
        <h3>Native electronic energy ranking</h3><p>{manifest.members.length === 1 ? "One retained member; no inter-member comparison is available." : "Select a member to inspect its geometry and reported energies."}</p>
        <div className="conformer-table-scroll"><table onKeyDown={keyboardSelect} aria-label="Retained CREST members">
          <thead><tr><th scope="col">Member / native rank</th><th scope="col">Application rank</th><th scope="col">Energy <span>Eh</span></th><th scope="col">Relative <span>kcal/mol</span></th></tr></thead>
          <tbody>{manifest.members.map((item) => <tr key={item.conformer.id} aria-selected={item.conformer.id === conformer.id}>
            <th scope="row"><button type="button" data-member-id={item.conformer.id} aria-pressed={item.conformer.id === conformer.id} onClick={() => setSelectedId(item.conformer.id)} aria-label={`Select member ${item.application_rank}`}>
              {item.native_rank}{item.application_rank === 1 ? <small>Lowest reported energy</small> : null}<small title={item.conformer.id}>{item.conformer.id.slice(0, 8)}</small>
            </button></th><td>{item.application_rank}</td><td>{item.native_electronic_energy.value.toFixed(item.native_electronic_energy.precision?.decimal_places ?? 8)}</td><td>{item.conformer.relative_energy!.value.toString()}</td>
          </tr>)}</tbody>
        </table></div>
        <dl className="conformer-selected-energy" data-testid="conformer-selected-energy">
          <div><dt>Native electronic energy</dt><dd>{member.native_electronic_energy.value.toFixed(member.native_electronic_energy.precision?.decimal_places ?? 8)} Eh</dd></div>
          <div><dt>Relative electronic energy</dt><dd>{conformer.relative_energy!.value.toString()} kcal/mol</dd></div>
          <div><dt>Native / application rank</dt><dd>{member.native_rank} / {member.application_rank}</dd></div>
        </dl>
        <p className="conformer-identity">Member <span data-testid="conformer-member-id" title={conformer.id}>{shortId(conformer.id)}</span> <button type="button" className="conformer-copy-id" onClick={() => { void navigator.clipboard?.writeText(conformer.id).catch(() => undefined); }} aria-label="Copy the full member id">Copy full id</button></p>
      </div>
    </div>
    <details className="conformer-coordinates"><summary>Selected member coordinates (Å)</summary><table aria-label="Selected member coordinates"><thead><tr><th scope="col">Atom</th><th scope="col">Element</th><th scope="col">x / Å</th><th scope="col">y / Å</th><th scope="col">z / Å</th></tr></thead>
      <tbody>{conformer.coordinates.atoms.map((atom) => <tr key={atom.index}><th scope="row">{atom.index}</th><td>{atom.element}</td><td title={`Full value: ${atom.x}`}>{coordinateText(atom.x)}</td><td>{coordinateText(atom.y)}</td><td>{coordinateText(atom.z)}</td></tr>)}</tbody></table></details>
    <details className="conformer-provenance" data-testid="conformer-provenance"><summary>Scientific provenance and native evidence</summary>
      <p>Scientific validation: {detail.result!.validation_state}. Evidence consistency validation independently reparses native files; it is not independent numerical recomputation.</p>
      <dl className="conformer-facts">
        <div><dt>Input StructureVersion</dt><dd>{manifest.input_structure_version_id}{onInspectInput ? <button type="button" onClick={onInspectInput}>Open original input version</button> : null}</dd></div>
        <div><dt>Engine / patch</dt><dd>CREST {manifest.engine_version}</dd></div>
        <div><dt>Calculator / method</dt><dd>{manifest.calculator} / {manifest.method?.toUpperCase()}</dd></div>
        <div><dt>Requested / effective EWIN</dt><dd>{manifest.requested_ewin_kcal_mol} / {manifest.effective_ewin_kcal_mol} kcal/mol</dd></div>
        <div><dt>Execution / attempt</dt><dd>{manifest.execution_id} / {manifest.attempt_number}</dd></div>
        <div><dt>Calculation / result</dt><dd>{calculationId}<small>{resultId}</small></dd></div>
        <div><dt>Producer / provenance record</dt><dd>{detail.result!.trusted_producer_id}<small>{detail.result!.provenance_record_id}</small></dd></div>
        <div><dt>Native output counts</dt><dd>Optimized {manifest.native_optimized_count}; duplicates {manifest.native_duplicate_count}; rotamers {manifest.native_rotamer_count}; outer restarts {manifest.restart_count}</dd></div>
        <div><dt>Canonical input SHA-256</dt><dd>{manifest.calculation_input_sha256}</dd></div>
        <div><dt>Normalized geometry SHA-256</dt><dd>{manifest.input_structure_sha256}</dd></div>
        <div><dt>Executable SHA-256</dt><dd>{manifest.executable_sha256}</dd></div>
        <div><dt>Member native record SHA-256</dt><dd>{member.native_record_sha256}</dd></div>
        <div><dt>Ensemble manifest SHA-256</dt><dd>{payload.manifest_artifact.sha256}</dd></div>
      </dl>
      <p>Embedded tblite 0.3.0-fork executes inside patched CREST 3.0.2. This is not an external xTB 6.7.1 execution.</p>
      <details><summary>Authorized settings recorded by the backend</summary><pre>{JSON.stringify(detail.specification.conformer_search, null, 2)}</pre></details>
      <h3>Reported limitations</h3><ul>{manifest.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
      <h3>Native output artifacts</h3><p>Inspect shows the first 64 KiB as text. Download retains the complete file; downloaded bytes are checked against the recorded SHA-256.</p>
      {groupArtifacts([{ name: "ensemble-manifest.json", artifact: payload.manifest_artifact }, ...manifest.native_artifacts]).map((group) => {
        const list = <ul className="conformer-artifacts">{group.items.map(({ name, artifact }) => <li key={name}>
          <span>{name}</span><button type="button" onClick={() => void artifactAction(artifact, name, true)} aria-label={`Inspect ${name}`}>Inspect</button><button type="button" onClick={() => void artifactAction(artifact, name, false)} aria-label={`Download ${name}`}>Download</button>
        </li>)}</ul>;
        return group.id === "internal"
          ? <details key={group.id} className="conformer-artifact-group" data-group={group.id}><summary>{group.label} ({group.items.length})</summary>{list}</details>
          : <div key={group.id} className="conformer-artifact-group" data-group={group.id}><h4>{group.label} ({group.items.length})</h4>{list}</div>;
      })}
      {artifactNotice ? <p role="alert">{artifactNotice}</p> : null}
      {preview ? <div className="conformer-artifact-preview" role="region" aria-label="Native artifact preview"><h4>{preview.name}</h4><button type="button" onClick={() => setPreview(null)}>Close preview</button><pre>{preview.text}</pre></div> : null}
    </details>
  </section>;
}
