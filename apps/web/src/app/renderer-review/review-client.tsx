"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";

import type { MolecularRendererProps } from "../_components/molecular-renderer";
import { CR2O3_STRUCTURE } from "../_components/molecular-renderer/structures/cr2o3";
import { representationStyle } from "../_components/molecular-renderer/radii";
import { deriveGeometry } from "../_components/molecular-renderer/derive";
import type { AtomSelection, PresetId, ProjectionMode, Representation, RendererHandle, ScientificStructure } from "../_components/molecular-renderer/types";

const REPRESENTATIONS: [Representation, string][] = [
  ["ball-stick", "Ball & stick"],
  ["unit-cell", "Unit cell"],
  ["polyhedra", "Polyhedra"],
  ["wireframe", "Wireframe"],
  ["space-fill", "Space filling"],
];

export type ReviewQuery = Record<"rep" | "preset" | "n" | "sc" | "structure" | "rotate" | "cell" | "labels" | "projection" | "zoom" | "az" | "pol" | "ui" | "w" | "h" | "ao" | "offx", string | null>;

/** Loads the committed water scene (a real ChemDFT StructureVersion fixture) and adapts it to the renderer's structure. */
async function loadWater(): Promise<ScientificStructure> {
  const [{ buildScientificScene }, { structureFromScene }, fixture] = await Promise.all([
    import("@chemdft/scientific-scene"),
    import("../_components/molecular-renderer/structures/from-scene"),
    import("../../../../../packages/scientific-scene/tests/fixtures/water-version.json"),
  ]);
  const scene = buildScientificScene(fixture.default as never);
  return structureFromScene(scene, {
    title: "Water — stored StructureVersion fixture",
    provenance: { kind: "stored-structure-version", label: "ChemDFT acceptance fixture", note: "Test user-supplied water geometry from the repository's scientific-scene fixtures." },
  });
}

export function RendererReview({ query }: { query: ReviewQuery }) {
  const [Renderer, setRenderer] = useState<ComponentType<MolecularRendererProps> | null>(null);
  const [water, setWater] = useState<ScientificStructure | null>(null);
  const [which, setWhich] = useState<"cr2o3" | "water">(query.structure === "water" ? "water" : "cr2o3");
  const [representation, setRepresentation] = useState<Representation>((query.rep as Representation | null) ?? "ball-stick");
  const [preset, setPreset] = useState<PresetId>((query.preset as PresetId | null) ?? "editorial");
  const [n, setN] = useState(query.n ? Number(query.n) : 1);
  const [sc] = useState<[number, number, number] | null>(query.sc ? (query.sc.split(",").map(Number) as [number, number, number]) : null);
  const [rotate, setRotate] = useState(query.rotate === "1");
  const [showCell, setShowCell] = useState(query.cell !== "0");
  const [labels, setLabels] = useState(query.labels === "1");
  const [projection, setProjection] = useState<ProjectionMode | "preset">((query.projection as ProjectionMode | null) ?? "preset");
  const [selection, setSelection] = useState<AtomSelection>(null);
  const [handle, setHandle] = useState<RendererHandle | null>(null);
  const [stats, setStats] = useState("");
  const compact = typeof window !== "undefined" && window.innerWidth < 680;

  useEffect(() => {
    void import("../_components/molecular-renderer/MolecularRenderer").then((module) => setRenderer(() => module.default));
  }, []);
  useEffect(() => {
    void loadWater().then(setWater);
  }, []);
  useEffect(() => {
    if (handle) (window as unknown as { __chemdftRenderer: RendererHandle }).__chemdftRenderer = handle;
  }, [handle]);

  const structure = which === "water" && water ? water : CR2O3_STRUCTURE;
  const info = useMemo(() => {
    const geometry = deriveGeometry(structure, sc ?? [n, n, n]);
    const style = representationStyle(structure, representation, geometry.coordination);
    return { geometry, style };
  }, [structure, n, sc, representation]);

  const bare = query.ui === "0";
  const width = query.w;
  const height = query.h;

  const stage = (
    <div style={{ width: width ? Number(width) : "100%", height: height ? Number(height) : bare ? "100vh" : 640, position: "relative", outline: "none" }}>
      {Renderer ? (
        <Renderer
          structure={structure}
          presentation={{
            representation,
            preset,
            supercell: sc ?? [n, n, n],
            showCell,
            labels: labels ? "element" : "none",
            autoRotate: rotate,
            selection,
            ...(projection === "preset" ? {} : { projection }),
          }}
          compact={compact}
          {...(query.offx ? { composition: { offsetX: Number(query.offx), offsetY: 0, regionWidth: 0.5, regionHeight: 0.8 } } : {})}
          {...(query.ao ? { ambientOcclusion: query.ao === "1" } : {})}
          initialView={{
            ...(query.zoom ? { zoom: Number(query.zoom) } : {}),
            ...(query.az ? { azimuth: Number(query.az) } : {}),
            ...(query.pol ? { polar: Number(query.pol) } : {}),
          }}
          onSelect={setSelection}
          onReady={setHandle}
        />
      ) : null}
    </div>
  );
  if (bare) return stage;

  const button = (active: boolean) => ({ padding: "4px 10px", border: "1px solid #b8c2cc", background: active ? "#e3effc" : "#fff", font: "13px system-ui", cursor: "pointer" }) as const;
  return (
    <div style={{ padding: 16, font: "13px system-ui", maxWidth: 1400, margin: "0 auto" }}>
      <h1 style={{ font: "600 16px system-ui", margin: "0 0 8px" }}>Molecular renderer review (development only)</h1>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 10 }}>
        <span>
          Structure:{" "}
          {(["cr2o3", "water"] as const).map((id) => (
            <button key={id} style={button(which === id)} onClick={() => setWhich(id)} disabled={id === "water" && !water}>
              {id === "cr2o3" ? "α-Cr₂O₃ (COD 9014036)" : "Water (fixture)"}
            </button>
          ))}
        </span>
        <span>
          Preset: {(["scientific", "editorial", "publication"] as const).map((id) => <button key={id} style={button(preset === id)} onClick={() => setPreset(id)}>{id}</button>)}
        </span>
        <span>
          Representation: {REPRESENTATIONS.map(([id, label]) => <button key={id} style={button(representation === id)} onClick={() => setRepresentation(id)}>{label}</button>)}
        </span>
        <span>
          Supercell: {[1, 2].map((v) => <button key={v} style={button(n === v)} onClick={() => setN(v)} disabled={structure.kind === "molecule"}>{v}×{v}×{v}</button>)}
        </span>
        <span>
          <button style={button(showCell)} onClick={() => setShowCell((v) => !v)}>cell</button>
          <button style={button(labels)} onClick={() => setLabels((v) => !v)}>labels</button>
          <button style={button(rotate)} onClick={() => setRotate((v) => !v)}>rotate</button>
          <button style={button(projection === "orthographic")} onClick={() => setProjection((p) => (p === "orthographic" ? "perspective" : "orthographic"))}>ortho</button>
          <button style={button(false)} onClick={() => handle?.resetView(true)}>reset view</button>
          <button style={button(false)} onClick={() => setStats(JSON.stringify(handle?.stats()))}>stats</button>
        </span>
      </div>
      {stage}
      <p style={{ margin: "8px 0 0", color: "#52606d" }}>
        Radius model: <strong>{info.style.model.label}</strong> — {info.style.model.citation} · atoms drawn: {info.geometry.atoms.length}, bonds: {info.geometry.bonds.length}, polyhedra: {info.geometry.polyhedra.length}
        {selection ? ` · selected ${selection.element} #${selection.index}` : ""} {stats}
      </p>
    </div>
  );
}
