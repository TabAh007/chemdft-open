"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildScientificScene, DEFAULT_VISUALIZATION_STATE, inferVisualBonds, measureScene, type MeasurementKind, type VisualizationState } from "@chemdft/scientific-scene";
import type { StructureVersionDetail } from "@chemdft/schemas";
import { compactStructureTitle, restoredStructureDisplay, structureReview, type StructureInspectorContext } from "@/lib/structure-workbench";
import { listWorkspaceFiles } from "@/lib/workspace-api";

const StructureViewport = dynamic(() => import("./structure-viewport"), {ssr:false, loading:() => <div className="viewport-fallback" role="status">Loading Scientific View…</div>});

export function StructureVersionWorkbench({detail, active}: {detail:StructureVersionDetail; active:boolean}) {
  const [state,setState]=useState<VisualizationState>(DEFAULT_VISUALIZATION_STATE);
  const [displayReady,setDisplayReady]=useState(false);
  const [visualBondsEnabled,setVisualBondsEnabled]=useState(true);
  const [selectedAtomIndex,setSelectedAtomIndex]=useState<number|null>(null);
  const [measurementKind,setMeasurementKind]=useState<MeasurementKind|"none">("none");
  const [measurementAtomIndices,setMeasurementAtomIndices]=useState<number[]>([]);
  const [fitToken,setFitToken]=useState(0);
  const [summaryVisible,setSummaryVisible]=useState(false);
  const [sourceName,setSourceName]=useState<string>();
  const viewportRef=useRef<HTMLDivElement>(null);
  const restored=useRef(false);
  const key=`chemdft:structure-view:${detail.version.id}`;
  const sceneResult=useMemo(() => {try {return {scene:buildScientificScene(detail),error:null};} catch(error) {return {scene:null,error:error instanceof Error?error.message:"Structure coordinates unavailable."};}},[detail]);
  const scene=sceneResult.scene;
  const perceived=useMemo(() => scene ? inferVisualBonds(scene) : [],[scene]);
  const visualBonds=useMemo(()=>visualBondsEnabled?perceived:[],[visualBondsEnabled,perceived]);
  const measurement=useMemo(() => {
    const required=measurementKind==="distance"?2:measurementKind==="angle"?3:4;
    if (!scene || measurementKind==="none" || measurementAtomIndices.length!==required) return null;
    return measureScene(scene,measurementKind,measurementAtomIndices);
  },[scene,measurementKind,measurementAtomIndices]);
  function selectAtom(index:number) {
    if (!scene?.atoms.some(atom=>atom.index===index)) return;
    setSelectedAtomIndex(index);
    if(measurementKind!=="none") {
      const count=measurementKind==="distance"?2:measurementKind==="angle"?3:4;
      setMeasurementAtomIndices(old=>[...old.filter(i=>i!==index),index].slice(-count));
    }
    window.dispatchEvent(new Event("chemdft:open-inspector"));
  }
  useEffect(() => {
    queueMicrotask(() => {
      let raw: string | null = null;
      try { raw=localStorage.getItem(key); } catch { /* Display preferences are optional. */ }
      const saved=restoredStructureDisplay(raw,DEFAULT_VISUALIZATION_STATE);
      setState(saved.state); setVisualBondsEnabled(saved.visualBondsEnabled); restored.current=true; setDisplayReady(true);
    });
  },[key]);
  useEffect(() => {
    if(restored.current) {
      try { localStorage.setItem(key,JSON.stringify({representation:state.representation,labels:state.labels,colorScheme:state.colorScheme,projection:state.camera.projection,cellContents:state.cellContents,polyhedraVisible:state.polyhedraVisible,atomScale:state.atomScale,labelScale:state.labelScale,legendVisible:state.legendVisible,presetView:state.presetView,visualBondsEnabled})); } catch { /* Rendering works without browser storage. */ }
    }
  },[key,state,visualBondsEnabled]);
  useEffect(() => {
    let alive=true;
    void listWorkspaceFiles(detail.structure.project_id).then(files=>{
      if(alive) setSourceName(files.find(file=>file.sha256===detail.provenance?.source_artifact?.sha256)?.original_name);
    }).catch(()=>{/* Artifact references remain available if file metadata is missing. */});
    return ()=>{alive=false;};
  },[detail]);
  useEffect(() => {
    if(!active) return;
    const context:StructureInspectorContext={projectId:detail.structure.project_id,detail,scene,visualBonds,visualBondsEnabled,selectedAtomIndex,measurementKind,measurementAtomIndices,measurement,...(sourceName?{sourceName}:{})};
    window.dispatchEvent(new CustomEvent("chemdft:structure-inspector",{detail:context}));
    window.dispatchEvent(new CustomEvent("chemdft:workspace-selection",{detail:{projectId:detail.structure.project_id,structureName:detail.structure.name,structureVersionRevision:detail.version.revision,currentView:compactStructureTitle(detail.structure.name,detail.version.revision)}}));
  },[active,detail,scene,visualBonds,visualBondsEnabled,selectedAtomIndex,measurementKind,measurementAtomIndices,measurement,sourceName]);
  useEffect(() => {
    if(!active) return;
    const fit=()=>setFitToken(n=>n+1);
    const select=(event:Event)=> {const choice=(event as CustomEvent<{versionId:string;atomIndex:number}>).detail;if(choice.versionId===detail.version.id) selectAtom(choice.atomIndex);};
    window.addEventListener("chemdft:fit-active-structure",fit);
    window.addEventListener("chemdft:select-structure-atom",select);
    return ()=>{window.removeEventListener("chemdft:fit-active-structure",fit);window.removeEventListener("chemdft:select-structure-atom",select);};
    // Selection changes are reflected through the current measurement mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[active,detail.version.id,measurementKind,scene]);
  function update(next:Partial<VisualizationState>) {setState(old=>({...old,...next}));}
  function inspect() {window.dispatchEvent(new Event("chemdft:open-inspector"));}
  return <div className={`structure-version-workbench ${summaryVisible?"summary-visible":""}`} data-testid="structure-version-workbench">
    <aside className="structure-version-summary" aria-label="Structure summary">
      <h2 title={detail.structure.name}>{compactStructureTitle(detail.structure.name,detail.version.revision)}</h2>
      <p className="structure-exact-name">{detail.structure.name}</p>
      <dl className="mo-facts">
        <div><dt>Version</dt><dd>V{detail.version.revision} · committed</dd></div>
        <div><dt>Authority</dt><dd>{detail.provenance?.source_class??detail.version.origin}</dd></div>
        <div><dt>Review</dt><dd>{structureReview(detail)}</dd></div>
        <div><dt>Atoms</dt><dd>{scene?.atoms.length??detail.version.coordinates?.atoms.length??0}</dd></div>
        <div><dt>Authoritative bonds</dt><dd>{detail.version.coordinates?.bonds?.length??0}</dd></div>
        <div><dt>Coordinates</dt><dd>{detail.version.coordinates?.coordinate_system??"Unavailable"}</dd></div>
        <div><dt>Source units</dt><dd>{detail.version.coordinates?.unit??"Unavailable"}</dd></div>
        <div><dt>Origin</dt><dd>{detail.version.origin}</dd></div>
      </dl>
      {detail.version.origin==="IMPORTED"?<p className="structure-external-note" data-testid="externally-built-note"><strong>Externally built, not app-generated.</strong> These coordinates were imported from a file ({sourceName??"source file"}); ChemDFT did not build or optimize them.</p>:null}
      <h3>Coordinate source</h3><p>{sourceName??detail.provenance?.coordinate_origin??"See source artifact in Inspector"}</p>
      <p>{detail.provenance?.operation??"Operation not recorded"}</p>
      <button type="button" className="dock-switch-button" onClick={inspect}>Coordinates & provenance</button>
    </aside>
    <section className="structure-scene-panel" aria-label="Scientific View">
      <div className="structure-viewer-toolbar" aria-label="Structure view controls">
        <button type="button" className="structure-summary-toggle" aria-expanded={summaryVisible} onClick={()=>setSummaryVisible(v=>!v)}>Structure summary</button>
        <label>Representation<select value={state.representation} onChange={e=>update({representation:e.currentTarget.value as VisualizationState["representation"]})}><option value="ball-stick">Ball & stick</option><option value="space-fill">Spacefill</option><option value="wireframe">Wireframe</option><option value="sticks">Sticks</option></select></label>
        <label>Labels<select value={state.labels} onChange={e=>update({labels:e.currentTarget.value as VisualizationState["labels"]})}><option value="none">None</option><option value="element">Element</option><option value="index">Atom index</option></select></label>
        <label>Palette<select value={state.colorScheme} onChange={e=>update({colorScheme:e.currentTarget.value as VisualizationState["colorScheme"]})}><option value="conventional">Conventional</option><option value="colorblind">Colorblind</option><option value="monochrome">Monochrome</option></select></label>
        <label>Projection<select value={state.camera.projection} onChange={e=>update({camera:{...state.camera,projection:e.currentTarget.value as VisualizationState["camera"]["projection"]}})}><option value="perspective">Perspective</option><option value="orthographic">Orthographic</option></select></label>
        <label>Visual bonds<select value={visualBondsEnabled?"auto":"off"} title="Display only; inferred from distances, not passed to calculations or structure exports." onChange={e=>setVisualBondsEnabled(e.currentTarget.value==="auto")}><option value="auto">Auto</option><option value="off">Off</option></select></label>
        <label>View<select value={state.presetView??"oblique"} onChange={e=>update({presetView:e.currentTarget.value as VisualizationState["presetView"]})}><option value="oblique">Oblique</option><option value="along-a">Along a</option><option value="along-b">Along b</option><option value="along-c">Along c</option><option value="along-a-star">Along a*</option></select></label>
        <label>Atom size<select value={String(state.atomScale??1)} onChange={e=>update({atomScale:Number(e.currentTarget.value)})}><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
        <label>Label size<select value={String(state.labelScale??1)} onChange={e=>update({labelScale:Number(e.currentTarget.value)})}><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
        <label>Measure<select value={measurementKind} onChange={e=>{setMeasurementKind(e.currentTarget.value as MeasurementKind|"none");setMeasurementAtomIndices([]);inspect();}}><option value="none">Off</option><option value="distance">Distance</option><option value="angle">Angle</option><option value="dihedral">Dihedral</option></select></label>
        <span className="viz-hint" data-testid="viewer-hints">Drag to rotate · scroll to zoom · right-drag or Shift-drag to pan{measurementKind!=="none"?` · Measure ${measurementKind}: click ${measurementKind==="distance"?2:measurementKind==="angle"?3:4} atoms on the canvas (or pick them by index in the Inspector's exact-coordinates list)`:""}</span>
        {scene?.cell?<><label>Supercell<select value={`${state.supercell.nx}x${state.supercell.ny}x${state.supercell.nz}`} onChange={e=>{const [nx,ny,nz]=e.currentTarget.value.split("x").map(Number);update({supercell:{nx:nx!,ny:ny!,nz:nz!}});}}><option value="1x1x1">1×1×1</option><option value="2x1x1">2×1×1</option><option value="2x2x1">2×2×1</option><option value="2x2x2">2×2×2</option></select></label><label>Cell contents<select value={state.cellContents??"coordination"} onChange={e=>update({cellContents:e.currentTarget.value as "coordination"|"cell"})}><option value="coordination">Complete coordination</option><option value="cell">Atoms in cell</option></select></label><label><input type="checkbox" checked={state.polyhedraVisible??false} onChange={e=>update({polyhedraVisible:e.currentTarget.checked})}/>Polyhedra</label><label><input type="checkbox" checked={state.legendVisible??true} onChange={e=>update({legendVisible:e.currentTarget.checked})}/>Legend</label><label><input type="checkbox" checked={state.unitCellVisible} onChange={e=>update({unitCellVisible:e.currentTarget.checked})}/>Unit cell</label></>:null}
      </div>
      <div className="structure-viewport-frame" ref={viewportRef}>
        {scene&&scene.atoms.length>0?displayReady?<StructureViewport scene={scene} state={state} visualBonds={visualBonds} fitToken={fitToken} selectedAtomIndex={selectedAtomIndex} measurementAtomIndices={measurementAtomIndices} onSelectAtom={selectAtom} onStateChange={update} cameraStorageKey={`${key}:camera`}/>:<div className="viewport-fallback" role="status">Loading Scientific View…</div>:<div className="viewport-fallback" role="status">{sceneResult.error??"This StructureVersion contains no atoms. Inspect its source and diagnostics."}</div>}
      </div>
      <div className="structure-view-status" role="status"><span>{scene?.atoms.length??0} atoms · {detail.version.coordinates?.bonds?.length??0} authoritative bonds</span><span>{visualBonds.length} inferred visual bonds · display Å</span></div>
      {visualBonds.length>0?<p className="visual-bond-disclaimer">Visual bonds and polyhedra are inferred for display; not authoritative connectivity.</p>:<p className="visual-bond-disclaimer">{(detail.version.coordinates?.bonds?.length??0)===0?"No authoritative bond connectivity is stored.":"Source-provided connectivity is retained."}</p>}
    </section>
  </div>;
}
