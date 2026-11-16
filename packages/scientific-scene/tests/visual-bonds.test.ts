import { describe, expect, it } from "vitest";
import { buildScientificScene, inferVisualBonds, DEFAULT_VISUALIZATION_STATE, measureScene, type ScientificScene } from "../src/index";
import type { StructureVersionDetail } from "@chemdft/schemas";
import water from "./fixtures/water-version.json";
const detail=water as unknown as StructureVersionDetail;
const snapshot=JSON.stringify(detail);
function varied(elements:string[], positions:readonly (readonly [number,number,number])[]):ScientificScene {
  const scene=buildScientificScene(detail);
  return {...scene,atoms:positions.map((position,index)=>({...scene.atoms[0]!,id:`atom:${index}`,index,element:elements[index]!,position,sourcePosition:position})),bonds:[]};
}
describe("display-only visual connectivity",()=>{
  it("finds exactly two O–H display edges for water and never adds canonical bonds",()=>{
    const scene=buildScientificScene(detail), original=JSON.stringify(scene);
    expect(inferVisualBonds(scene)).toEqual([{atomIndexA:0,atomIndexB:1,displayOnly:true},{atomIndexA:0,atomIndexB:2,displayOnly:true}]);
    expect(inferVisualBonds(scene)).toEqual(inferVisualBonds(scene));
    expect(scene.bonds).toEqual([]);expect(JSON.stringify(scene)).toBe(original);expect(JSON.stringify(detail)).toBe(snapshot);
  });
  it("rejects distant, overlapping and unsupported atoms instead of using fallback radii",()=>{
    for(const scene of [varied(["H","H"],[[0,0,0],[10,0,0]]),varied(["O","H"],[[0,0,0],[0,0,0]]),varied(["O","H"],[[0,0,0],[.01,0,0]]),varied(["Xx","H"],[[0,0,0],[.9,0,0]]),varied(["O","H"],[[0,0,0],[NaN,0,0]])])expect(inferVisualBonds(scene)).toEqual([]);
  });
  it("retains canonical edges without duplicating them or inferring periodic connectivity",()=>{
    const scene=buildScientificScene(detail);
    expect(inferVisualBonds({...scene,bonds:[{id:"source",atomIndexA:1,atomIndexB:0,order:1,source:"canonical"}]})).toHaveLength(1);
    expect(inferVisualBonds({...scene,kind:"PERIODIC"})).toEqual([]);
  });
  it("is deterministic with shuffled atom arrays and sparse source indices",()=>{
    const scene=buildScientificScene(detail);
    expect(inferVisualBonds({...scene,atoms:[...scene.atoms].reverse()})).toEqual(inferVisualBonds(scene));
    expect(inferVisualBonds(varied(["H"],[[0,0,0]]))).toEqual([]);
    expect(inferVisualBonds({...scene,atoms:[]})).toEqual([]);
  });
  it("does not promote visualization/measurements into coordinates or authority",()=>{
    const scene=buildScientificScene(detail);
    const states=["ball-stick","space-fill","wireframe","sticks"].map(representation=>({...DEFAULT_VISUALIZATION_STATE,representation,labels:"index",colorScheme:"colorblind",camera:{...DEFAULT_VISUALIZATION_STATE.camera,distance:2}}));
    expect(states).toHaveLength(4);
    inferVisualBonds(scene);expect(measureScene(scene,"distance",[0,1]).value).toBe(.9572);
    expect(JSON.stringify(detail)).toBe(snapshot);expect(scene.cell).toBeUndefined();expect(scene.bonds).toEqual([]);
    // VisualBond lacks canonical bond order/source/id and is not a canonical export/edit record.
    expect(Object.keys(inferVisualBonds(scene)[0]!)).toEqual(["atomIndexA","atomIndexB","displayOnly"]);
  });
});
