import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildScientificScene } from "@chemdft/scientific-scene";
import { describe, expect, it } from "vitest";
import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";

import { deriveGeometry } from "../../src/app/_components/molecular-renderer/derive";
import { computeFit } from "../../src/app/_components/molecular-renderer/layers/framing";
import { convexHullFaces } from "../../src/app/_components/molecular-renderer/hull";
import { PRESETS } from "../../src/app/_components/molecular-renderer/presets";
import { presetStyle, representationStyle } from "../../src/app/_components/molecular-renderer/radii";
import { CR2O3_STRUCTURE } from "../../src/app/_components/molecular-renderer/structures/cr2o3";
import { structureFromScene } from "../../src/app/_components/molecular-renderer/structures/from-scene";
import { elementDisplay } from "../../src/app/_components/molecular-renderer/elements";
import { presentedColor } from "../../src/app/_components/molecular-renderer/tone";
import type { Representation, Vec3 } from "../../src/app/_components/molecular-renderer/types";

const water = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../packages/scientific-scene/tests/fixtures/water-version.json"), "utf8"));
const waterStructure = structureFromScene(buildScientificScene(water), {
  title: "Water",
  provenance: { kind: "stored-structure-version", label: "ChemDFT acceptance fixture" },
});

describe("structure switching: a validated StructureVersion renders through the same pipeline", () => {
  it("adapts the stored water scene without changing a coordinate", () => {
    const scene = buildScientificScene(water);
    expect(waterStructure.kind).toBe("molecule");
    expect(waterStructure.formula).toBe("H2O");
    waterStructure.sites.forEach((site, i) => expect(site.position).toEqual(scene.atoms[i]!.position));
    const geometry = deriveGeometry(waterStructure);
    expect(geometry.atoms.map((a) => a.position)).toEqual(scene.atoms.map((a) => a.position));
    expect(geometry.cell).toBeNull();
  });

  it("keeps inferred bonds labelled display-only and never canonical", () => {
    const geometry = deriveGeometry(waterStructure);
    expect(geometry.bonds).toHaveLength(2);
    for (const bond of geometry.bonds) expect(bond.source).toBe("inferred");
    expect(waterStructure.inferredBonds?.label).toMatch(/not authoritative connectivity/);
  });

  it("uses van der Waals radii for a molecule's space-filling model (documented central table)", () => {
    const geometry = deriveGeometry(waterStructure);
    const style = representationStyle(waterStructure, "space-fill", geometry.coordination);
    expect(style.model.id).toBe("vdw-bondi");
    expect(style.atomRadius.O).toBe(1.52);
    expect(style.atomRadius.H).toBe(1.2);
  });

  it("switches structure without sharing derived state", () => {
    expect(deriveGeometry(CR2O3_STRUCTURE).atoms.length).not.toBe(deriveGeometry(waterStructure).atoms.length);
    expect(deriveGeometry(CR2O3_STRUCTURE)).toBe(deriveGeometry(CR2O3_STRUCTURE)); // memoised per structure, not mutated
  });
});

describe("representations change radii and visibility, never geometry", () => {
  const geometry = deriveGeometry(CR2O3_STRUCTURE, [1, 1, 1]);
  const reps: Representation[] = ["ball-stick", "unit-cell", "polyhedra", "wireframe", "space-fill"];

  it("leaves the derived atoms untouched by any representation", () => {
    const before = JSON.stringify(geometry.atoms);
    for (const rep of reps) representationStyle(CR2O3_STRUCTURE, rep, geometry.coordination);
    expect(JSON.stringify(geometry.atoms)).toBe(before);
  });

  it("states what each representation shows", () => {
    const styles = Object.fromEntries(reps.map((r) => [r, representationStyle(CR2O3_STRUCTURE, r, geometry.coordination)]));
    expect(styles["polyhedra"]!.showPolyhedra).toBe(true);
    expect(reps.filter((r) => r !== "polyhedra").every((r) => !styles[r]!.showPolyhedra)).toBe(true);
    expect(styles["space-fill"]!.showBonds).toBe(false);
    expect(styles["unit-cell"]!.forceCell).toBe(true);
    expect(styles["wireframe"]!.atomRadius.Cr!).toBeLessThan(styles["ball-stick"]!.atomRadius.Cr!);
    expect(styles["polyhedra"]!.atomRadius.Cr!).toBeLessThan(styles["ball-stick"]!.atomRadius.Cr!);
  });

  it("gives ball-and-stick atoms bigger than their bonds, so sphere intersections stay clean", () => {
    for (const rep of ["ball-stick", "unit-cell", "wireframe", "polyhedra"] as const) {
      const style = representationStyle(CR2O3_STRUCTURE, rep, geometry.coordination);
      for (const radius of Object.values(style.atomRadius)) expect(radius).toBeGreaterThan(style.bondRadius * 1.5);
    }
  });
});

describe("presets are finishes, not geometry", () => {
  it("never enables bloom-like or lens effects: only ambient occlusion exists, and only in Editorial", () => {
    expect(PRESETS.editorial.ao.enabled).toBe(true);
    expect(PRESETS.scientific.ao.enabled).toBe(false);
    expect(PRESETS.publication.ao.enabled).toBe(false);
    const source = readFileSync(resolve(import.meta.dirname, "../../src/app/_components/molecular-renderer/layers/effects.tsx"), "utf8");
    for (const forbidden of ["Bloom", "ChromaticAberration", "Noise", "Vignette", "DepthOfField", "LensFlare", "Glitch", "Pixelation"]) expect(source).not.toContain(forbidden);
  });

  it("keeps atom materials moderately rough and non-metallic", () => {
    for (const preset of Object.values(PRESETS)) {
      expect(preset.material.roughness).toBeGreaterThanOrEqual(0.35);
      expect(preset.material.roughness).toBeLessThanOrEqual(0.55);
      expect(preset.material.metalness).toBeLessThanOrEqual(0.05);
    }
  });

  it("makes Publication reproducible: orthographic, white, dashed rear edges, no occlusion", () => {
    const p = PRESETS.publication;
    expect(p.projection).toBe("orthographic");
    expect(p.background).toBe("#ffffff");
    expect(p.edges.dashedRear).toBe(true);
    expect(p.reproducible).toBe(true);
    expect(PRESETS.editorial.fov).toBeLessThanOrEqual(35);
    expect(PRESETS.editorial.fov).toBeGreaterThanOrEqual(20);
  });

  it("scales only display-scale spheres and bonds: Editorial thins them, Scientific and Publication leave them, physical radii are never touched", () => {
    const coordination = deriveGeometry(CR2O3_STRUCTURE).coordination;
    for (const representation of ["ball-stick", "unit-cell", "polyhedra", "wireframe"] as const) {
      const base = representationStyle(CR2O3_STRUCTURE, representation, coordination);
      const finished = presetStyle(base, PRESETS.editorial);
      for (const element of Object.keys(base.atomRadius)) expect(finished.atomRadius[element]).toBeCloseTo(base.atomRadius[element]! * PRESETS.editorial.display.atomScale, 10);
      expect(finished.bondRadius).toBeCloseTo(base.bondRadius * PRESETS.editorial.display.bondScale, 10);
      expect(presetStyle(base, PRESETS.scientific)).toBe(base);
      expect(presetStyle(base, PRESETS.publication)).toBe(base);
    }
    const space = representationStyle(CR2O3_STRUCTURE, "space-fill", coordination);
    expect(presetStyle(space, PRESETS.editorial)).toBe(space); // Shannon radii are physical: no finish may shrink them
    expect(PRESETS.editorial.display.atomScale).toBeGreaterThan(0.7);
    expect(PRESETS.editorial.display.atomScale).toBeLessThan(1);
  });

  it("keeps polyhedra translucent: 0.12–0.25 opacity in every preset", () => {
    for (const preset of Object.values(PRESETS)) {
      expect(preset.polyhedra.opacity).toBeGreaterThanOrEqual(0.12);
      expect(preset.polyhedra.opacity).toBeLessThanOrEqual(0.25);
    }
  });

  it("tones colours without changing element hue", () => {
    const hue = (c: { getHSL: (t: { h: number; s: number; l: number }) => unknown }) => {
      const t = { h: 0, s: 0, l: 0 };
      c.getHSL(t);
      return t;
    };
    for (const element of ["O", "N", "Cr", "S", "Cl"]) {
      const base = elementDisplay(element).color;
      const standard = hue(presentedColor(base, PRESETS.scientific));
      const editorial = hue(presentedColor(base, PRESETS.editorial));
      expect(editorial.h).toBeCloseTo(standard.h, 6);
    }
    const hydrogen = hue(presentedColor(elementDisplay("H").color, PRESETS.editorial));
    expect(hydrogen.s).toBeLessThan(0.1); // white stays neutral
  });
});

describe("camera framing keeps the structure in view", () => {
  const cases = [
    ["Cr2O3 1x1x1", deriveGeometry(CR2O3_STRUCTURE, [1, 1, 1])],
    ["Cr2O3 2x2x2", deriveGeometry(CR2O3_STRUCTURE, [2, 2, 2])],
    ["Cr2O3 2x2x1", deriveGeometry(CR2O3_STRUCTURE, [2, 2, 1])],
    ["water", deriveGeometry(waterStructure)],
  ] as const;
  const stages = [
    ["phone portrait", 390, 600],
    ["desktop wide", 1440, 760],
    ["square", 800, 800],
  ] as const;
  const FOV = PRESETS.editorial.fov;
  const MARGIN = PRESETS.editorial.framingMargin;
  const PAD = 0.5;

  function maxNdc(geometry: ReturnType<typeof deriveGeometry>, azimuth: number, polar: number, fit: { distance: number }, width: number, height: number) {
    const camera = new PerspectiveCamera(FOV, width / height, 0.1, 1000);
    camera.position.set(fit.distance * Math.sin(polar) * Math.sin(azimuth), fit.distance * Math.cos(polar), fit.distance * Math.sin(polar) * Math.cos(azimuth));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const c = geometry.bounds.center;
    const points: Vec3[] = [...geometry.atoms.map((a) => a.position), ...(geometry.cell?.corners ?? [])];
    let worst = 0;
    for (const p of points) {
      // lattice (x, y, z) about the centre -> scene (x, z, -y)
      const v = new Vector3(p[0] - c[0], p[2] - c[2], -(p[1] - c[1])).project(camera);
      worst = Math.max(worst, Math.abs(v.x), Math.abs(v.y));
    }
    return worst;
  }

  it.each(cases)("%s: no atom or cell corner leaves the frame at any azimuth (start polar), on every stage", (_name, geometry) => {
    for (const [, width, height] of stages) {
      for (const polar of [1.0, 1.2, 1.3]) {
        const fit = computeFit({
          extent: { horizontalRadius: geometry.bounds.horizontalRadius + PAD, halfHeight: geometry.bounds.halfHeight + PAD },
          margin: MARGIN,
          projection: "perspective",
          fov: FOV,
          width,
          height,
          polar,
          zoom: 1,
        });
        for (let azimuth = 0; azimuth < Math.PI * 2; azimuth += 0.2) expect(maxNdc(geometry, azimuth, polar, fit, width, height)).toBeLessThanOrEqual(1);
      }
    }
  });

  it.each(cases)("%s: stays within the frame (≤ 1.06×) over the whole polar range", (_name, geometry) => {
    for (const [, width, height] of stages) {
      const fit = computeFit({
        extent: { horizontalRadius: geometry.bounds.horizontalRadius + PAD, halfHeight: geometry.bounds.halfHeight + PAD },
        margin: MARGIN,
        projection: "perspective",
        fov: FOV,
        width,
        height,
        polar: 1.2,
        zoom: 1,
      });
      for (let polar = 0.15; polar < Math.PI - 0.1; polar += 0.15)
        for (let azimuth = 0; azimuth < Math.PI * 2; azimuth += 0.4) expect(maxNdc(geometry, azimuth, polar, fit, width, height)).toBeLessThanOrEqual(1.06);
    }
  });

  it("is not wasteful: the 2×2×2 supercell fills most of a landscape stage's height", () => {
    const geometry = cases[1][1];
    const width = 1440;
    const height = 760;
    const fit = computeFit({
      extent: { horizontalRadius: geometry.bounds.horizontalRadius + PAD, halfHeight: geometry.bounds.halfHeight + PAD },
      margin: MARGIN,
      projection: "perspective",
      fov: FOV,
      width,
      height,
      polar: 1.2,
      zoom: 1,
    });
    const worst = maxNdc(geometry, 0.62, 1.2, fit, width, height);
    // Conservative depth fitting trades a little occupancy for safety during arbitrary camera movement.
    expect(worst).toBeGreaterThan(0.65);
    expect(worst).toBeLessThan(0.9);
  });

  it("supports an orthographic camera for Publication with the same guarantee", () => {
    const geometry = cases[0][1];
    const width = 700;
    const height = 700;
    const fit = computeFit({
      extent: { horizontalRadius: geometry.bounds.horizontalRadius + PAD, halfHeight: geometry.bounds.halfHeight + PAD },
      margin: 1.05,
      projection: "orthographic",
      fov: 30,
      width,
      height,
      polar: 1.2,
      zoom: 1,
    });
    const camera = new OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 1000);
    camera.zoom = fit.zoom;
    camera.position.set(0, fit.distance * Math.cos(1.2), fit.distance * Math.sin(1.2));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const c = geometry.bounds.center;
    for (const p of geometry.cell!.corners) {
      const v = new Vector3(p[0] - c[0], p[2] - c[2], -(p[1] - c[1])).project(camera);
      expect(Math.abs(v.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(v.y)).toBeLessThanOrEqual(1);
    }
  });
});

describe("convex hull faces", () => {
  it("triangulates an octahedron into 8 faces and a cube into 12 triangles (6 merged squares)", () => {
    const octahedron: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    expect(convexHullFaces(octahedron)).toHaveLength(8);
    const cube: Vec3[] = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) cube.push([x, y, z]);
    expect(convexHullFaces(cube)).toHaveLength(12);
  });

  it("ignores interior points", () => {
    const tetra: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
    expect(convexHullFaces(tetra)).toHaveLength(4);
    expect(convexHullFaces([...tetra, [0.1, 0.1, 0.1]])).toHaveLength(4);
  });
});
