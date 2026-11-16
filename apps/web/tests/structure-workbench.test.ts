import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { compactStructureTitle, compactTabTitle, restoredStructureDisplay, structureReview } from "../src/lib/structure-workbench";
import { DEFAULT_VISUALIZATION_STATE, buildScientificScene, inferVisualBonds } from "@chemdft/scientific-scene";
import type { StructureVersionDetail } from "@chemdft/schemas";
import water from "../../../packages/scientific-scene/tests/fixtures/water-version.json";
const detail=water as unknown as StructureVersionDetail;
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");
describe("committed structure workstation",()=>{
  it("derives concise version labels without changing exact saved names",()=>{
    expect(compactStructureTitle(detail.structure.name,1)).toBe("Water V1");
    expect(detail.structure.name).toBe("TEST USER-SUPPLIED WATER GEOMETRY");
    expect(compactStructureTitle("Ethane",2)).toBe("Ethane V2");
    expect(compactStructureTitle("",1)).toBe("Structure V1");
    expect(compactTabTitle({label:"Water structure · V1",selection:{kind:"structureVersion",id:"a",projectId:"p",sourceId:"s"}})).toBe("Water V1");
    expect(structureReview(detail)).toBe("NOT REVIEWED");
  });
  it("keeps the detected engine and version whole in imported structure labels",()=>{
    expect(compactStructureTitle("01a_water_hf_freq · imported from Gaussian 16 Rev C.01",1)).toBe("01a_water_hf_freq V1 · imported from Gaussian 16 Rev C.01");
    expect(compactStructureTitle("01a_water_hf_freq · imported from ORCA 6.1.0",2)).toBe("01a_water_hf_freq V2 · imported from ORCA 6.1.0");
    expect(compactStructureTitle("dvb_ir · imported from Gaussian 09 Rev D.01",1)).toBe("dvb_ir V1 · imported from Gaussian 09 Rev D.01");
    const long=compactStructureTitle(`${"x".repeat(90)} · imported from ORCA 6.0.1`,1);
    expect(long).toBe(`${"x".repeat(27)}… V1 · imported from ORCA 6.0.1`);
    expect(compactStructureTitle("01a_water_hf_freq · imported from Gaussian 16 Rev C.01",1)).not.toContain("Gaus V");
  });
  it("validates display preferences and restores projection without accepting chemistry",()=>{
    const original=JSON.stringify(detail);
    const saved=restoredStructureDisplay(JSON.stringify({representation:"wireframe",projection:"orthographic",visualBondsEnabled:false,coordinates:[1,2,3],bonds:[{order:1}],authority:"CALCULATED"}),DEFAULT_VISUALIZATION_STATE);
    expect(saved.state.representation).toBe("wireframe");expect(saved.state.camera.projection).toBe("orthographic");expect(saved.visualBondsEnabled).toBe(false);
    expect(saved.state).not.toHaveProperty("bonds");expect(saved.state).not.toHaveProperty("coordinates");expect(JSON.stringify(detail)).toBe(original);
    expect(restoredStructureDisplay("invalid",DEFAULT_VISUALIZATION_STATE).state).toEqual(DEFAULT_VISUALIZATION_STATE);
    expect(restoredStructureDisplay('{"representation":"editing","projection":"fake"}',DEFAULT_VISUALIZATION_STATE).state).toEqual(DEFAULT_VISUALIZATION_STATE);
  });
  it("keeps visual edges out of scene authority and calculation/export transport",()=>{
    const scene=buildScientificScene(detail);expect(inferVisualBonds(scene)).toHaveLength(2);expect(scene.bonds).toHaveLength(0);
    const api=read("../src/lib/structure-workspace-api.ts");
    expect(api).not.toContain("visualBonds");expect(api).not.toContain("inferVisualBonds");
    const viewer=read("../src/app/[locale]/projects/[projectId]/workspace/visualization/structure-version-workbench.tsx");
    expect(viewer).not.toMatch(/submitCalculation|createStructureVersion|importStructure/);
    expect(viewer).toContain("not authoritative connectivity.");
  });
  it("keeps committed controls, coordinates and provenance attached to their own panels",()=>{
    const viewer=read("../src/app/[locale]/projects/[projectId]/workspace/visualization/structure-version-workbench.tsx");
    const inspector=read("../src/app/_components/structure-version-inspector.tsx");
    expect(viewer).toContain('aria-label="Structure view controls"');expect(viewer).not.toContain("Scientific 3D");expect(viewer).not.toContain(">Studio<");
    expect(inspector).toContain("Exact coordinates");expect(inspector).toContain("No unit cell is stored");expect(inspector).toContain("Advanced provenance");
    const runtime=read("../src/app/[locale]/projects/[projectId]/workspace/visualization/structure-viewport.tsx");
    expect(runtime).toContain("if (!initialized)");expect(runtime).toContain("props.fitToken !== latestFitToken");expect(runtime).toContain("new ResizeObserver");
  });
});
