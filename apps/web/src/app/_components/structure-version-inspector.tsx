"use client";
import { useState } from "react";
import { HelpTip } from "@/app/_components/help/help-tip";
import { cellVolume, formatMeasurement, type Vec3 } from "@chemdft/scientific-scene";
import { structureReview, type StructureInspectorContext } from "@/lib/structure-workbench";
import { approvalCoordinate } from "@/lib/approval-geometry";

export function StructureVersionInspector({context}: {context:StructureInspectorContext}) {
  const {detail,scene,visualBonds,visualBondsEnabled,selectedAtomIndex,measurementKind,measurementAtomIndices,measurement,sourceName}=context;
  const coordinates=detail.version.coordinates;
  const atom=coordinates?.atoms.find(a=>a.index===selectedAtomIndex);
  const periodicCell = detail.version.periodic_cell;
  const cell = scene?.cell ?? (periodicCell ? {
    a: periodicCell.a,
    b: periodicCell.b,
    c: periodicCell.c,
    alpha: periodicCell.alpha,
    beta: periodicCell.beta,
    gamma: periodicCell.gamma,
    latticeVectors: periodicCell.lattice_vectors as readonly [Vec3, Vec3, Vec3] | undefined,
  } : null);

  const [sourceRef, setSourceRef] = useState<string>(detail.provenance?.source_reference ?? "");
  const [isEditingRef, setIsEditingRef] = useState(false);
  const [savingRef, setSavingRef] = useState(false);

  async function handleSaveRef() {
    setSavingRef(true);
    try {
      const res = await fetch(`/api/v1/projects/${detail.structure.project_id}/structures/${detail.structure.id}/versions/${detail.version.id}/source-reference`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_reference: sourceRef }),
      });
      if (res.ok) {
        setIsEditingRef(false);
      }
    } catch {
      // Fallback
    } finally {
      setSavingRef(false);
    }
  }

  function select(index:number) {window.dispatchEvent(new CustomEvent("chemdft:select-structure-atom",{detail:{versionId:detail.version.id,atomIndex:index}}));}
  return <section className="structure-version-inspector" aria-label="StructureVersion inspector" data-testid="structure-version-inspector">
    <h2>Structure V{detail.version.revision}</h2><p title={detail.structure.name}>{detail.structure.name}</p>
    <dl className="mo-facts">
      <div><dt>Origin</dt><dd>{detail.version.origin}</dd></div><div><dt>Authority</dt><dd>{detail.provenance?.source_class??detail.version.origin}</dd></div><div><dt>Review</dt><dd>{structureReview(detail)}</dd></div>
      <div><dt>Atoms</dt><dd>{coordinates?.atoms.length??0}</dd></div><div><dt>Coordinate source</dt><dd>{sourceName??detail.provenance?.coordinate_origin??"Source artifact below"}</dd></div><div><dt>Coordinate units</dt><dd>{coordinates?.unit??"Unavailable"}</dd></div>
    </dl>
    <h3>Data source & citation</h3>
    {detail.provenance?.source_reference || sourceRef ? (
      <div className="source-reference-container">
        <dl className="mo-facts">
          <div>
            <dt>Source reference found in file</dt>
            <dd data-testid="source-reference-display">{sourceRef || detail.provenance?.source_reference}</dd>
          </div>
        </dl>
        {!isEditingRef ? (
          <button
            type="button"
            className="bp5-button bp5-minimal bp5-small"
            onClick={() => setIsEditingRef(true)}
            data-testid="edit-source-reference-btn"
            style={{ marginTop: 4 }}
          >
            Edit reference
          </button>
        ) : null}
      </div>
    ) : (
      <div>
        <p className="no-source-reference" data-testid="no-source-reference">
          No source reference in the file — add one
        </p>
        {!isEditingRef ? (
          <button
            type="button"
            className="bp5-button bp5-small"
            onClick={() => setIsEditingRef(true)}
            data-testid="add-source-reference-btn"
          >
            Add source reference
          </button>
        ) : null}
      </div>
    )}
    {isEditingRef ? (
      <div className="source-reference-edit-box" style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        <input
          type="text"
          className="bp5-input bp5-fill"
          placeholder="e.g. Sawada (1994) Materials Research Bulletin 29, 239. DOI: 10.1016/..."
          value={sourceRef}
          onChange={(e) => setSourceRef(e.target.value)}
          data-testid="source-reference-input"
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="bp5-button bp5-intent-primary bp5-small"
            onClick={handleSaveRef}
            disabled={savingRef}
            data-testid="save-source-reference-btn"
          >
            {savingRef ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="bp5-button bp5-small"
            onClick={() => {
              setSourceRef(detail.provenance?.source_reference ?? "");
              setIsEditingRef(false);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    ) : null}
    <h3>Connectivity</h3><dl className="mo-facts"><div><dt>Authoritative bonds</dt><dd data-testid="authoritative-bond-count">{coordinates?.bonds?.length??0}</dd></div><div><dt>Visual bonds</dt><dd>{visualBondsEnabled?`${visualBonds?.length??0} inferred` : "Off"}</dd></div></dl>
    <p>Visual bonds are display only. Calculations and structure exports use committed coordinates and source connectivity.</p>
    <h3>Selection & measurement</h3>
    {atom?<p data-testid="selected-atom">Atom {atom.index} · {atom.element}<br/>{String(atom.x)}, {String(atom.y)}, {String(atom.z)} {coordinates?.unit}</p>:<p>No atom selected. Click an atom or choose a coordinate row.</p>}
    <p data-testid="structure-measurement">{measurement?`${formatMeasurement(measurement)} · ${measurement.convention}`:measurementKind==="none"?"Measurement off":`${measurementKind}: select ${measurementKind==="distance"?2:measurementKind==="angle"?3:4} atoms in order (${measurementAtomIndices?.length??0} selected).`}</p>
    <details className="structure-coordinates"><summary>Exact coordinates · {coordinates?.coordinate_system??"Unavailable"} · {coordinates?.unit??"—"}</summary>
      <p className="coordinate-scroll-hint">Scroll horizontally to see all coordinates. Focus the table and use the arrow keys, or swipe.</p>
      <div className="structure-coordinate-scroll" role="region" tabIndex={0} aria-label={`Exact atomic coordinates (${coordinates?.unit??"units unavailable"})`}><table><thead><tr>{["Index","Element","X","Y","Z"].map(h=><th scope="col" key={h}>{h}</th>)}</tr></thead><tbody>{coordinates?.atoms.map(a=><tr key={a.index} data-selected={selectedAtomIndex===a.index}><td><button type="button" aria-label={`Select atom ${a.index} ${a.element}`} onClick={()=>select(a.index)}>{a.index}</button></td><td>{a.element}</td><td>{approvalCoordinate(a.x)}</td><td>{approvalCoordinate(a.y)}</td><td>{approvalCoordinate(a.z)}</td></tr>)}</tbody></table></div>
      {!coordinates?.atoms.length?<p>No coordinates available.</p>:null}
    </details>
    <h3>Unit cell <HelpTip topic="crystal.unit_cell" /></h3>{cell?<dl className="mo-facts"><div><dt>Lengths / Å</dt><dd data-testid="cell-lengths">{cell.a}, {cell.b}, {cell.c}</dd></div><div><dt>Angles / °</dt><dd data-testid="cell-angles">{cell.alpha}, {cell.beta}, {cell.gamma}</dd></div><div><dt>Volume / Å³</dt><dd data-testid="cell-volume">{cellVolume(cell).toFixed(2)}</dd></div></dl>:<p>No unit cell is stored for this StructureVersion.</p>}
    <h3>Provenance</h3><p>{detail.provenance?.operation??"Operation not recorded"}</p><p>{detail.provenance?.source_artifact?"Original source artifact retained":"Source artifact unavailable"}</p>
    <details className="electronic-provenance"><summary>Advanced provenance</summary><dl className="mo-facts"><div><dt>Version ID</dt><dd>{detail.version.id}</dd></div><div><dt>Source artifact</dt><dd>{detail.provenance?.source_artifact?.artifact_id??"Unavailable"}</dd></div><div><dt>Source SHA-256</dt><dd>{detail.provenance?.source_artifact?.sha256??"Unavailable"}</dd></div></dl><pre>{JSON.stringify({provenance:detail.provenance,representations:detail.version.representation_artifacts,charge:detail.version.overall_charge,multiplicity:detail.version.multiplicity,parent:detail.version.parent_version_id,created_at:detail.version.created_at,periodic_cell:detail.version.periodic_cell},null,2)}</pre></details>
    <details><summary>Source diagnostics · {(detail.diagnostics??detail.version.diagnostics??[]).length}</summary>{(detail.diagnostics??detail.version.diagnostics??[]).map((d,i)=><p key={i}>{d.severity} · {d.code}: {d.message}</p>)}</details>
  </section>;
}
