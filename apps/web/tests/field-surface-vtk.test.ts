import { describe, expect, it } from "vitest";
import { buildVtkFieldSurface, vtkOrderedScalars } from "../src/lib/visualization/field-surface-vtk";
import { sampleTrilinear, type VolumetricField } from "../../../packages/scientific-scene/src/volumetric";
function field(kind = "ELECTRON_DENSITY"): VolumetricField {
  return { manifest: { dimensions: [7,7,7], origin_angstrom: [-3,-3,-3], spacing_angstrom: 1, calculation_result_id: "r", result_sha256: "saved", grid_sha256: kind, field_quantity: kind }, field_values: Array.from({length:343},(_,i)=> {
    const x=Math.floor(i/49), y=Math.floor(i/7)%7,z=i%7;
    return kind === "ELECTRON_DENSITY" ? .01*Math.exp(-((x-3)**2+(y-3)**2+(z-3)**2)) : x+2*y-z;
  }) };
}
describe("VTK rendering derivative", () => {
  it("permutes ChemDFT z-fast scalars exactly to VTK x-fast", () => {
    const input=field("ELECTROSTATIC_POTENTIAL");const reordered=vtkOrderedScalars(input);
    for(let x=0;x<7;x++) for(let y=0;y<7;y++) for(let z=0;z<7;z++) expect(reordered[x+7*(y+7*z)]).toBe(input.field_values[(x*7+y)*7+z]);
  });
  it("makes a deterministic finite indexed watertight surface with smooth outward normals", () => {
    const input=field(),before=JSON.stringify(input),a=buildVtkFieldSurface(input,.001),b=buildVtkFieldSurface(input,.001);
    expect(a.positions).toEqual(b.positions);expect(a.indices).toEqual(b.indices);
    expect(a.triangleCount).toBeGreaterThan(0);expect(a.positions.length).toBe(a.normals.length);
    expect([...a.positions,...a.normals].every(Number.isFinite)).toBe(true);
    const edges=new Map<string,number>();
    for(let i=0;i<a.indices.length;i+=3){
      const ids=[a.indices[i]!,a.indices[i+1]!,a.indices[i+2]!];
      for(let j=0;j<3;j++){const p=ids[j]!,q=ids[(j+1)%3]!;const key=p<q?`${p}:${q}`:`${q}:${p}`;edges.set(key,(edges.get(key)??0)+1);}
    }
    expect([...edges.values()].every(count=>count===2)).toBe(true);
    for(let i=0;i<a.positions.length;i+=3) expect(a.positions[i]!*a.normals[i]!+a.positions[i+1]!*a.normals[i+1]!+a.positions[i+2]!*a.normals[i+2]!).toBeGreaterThan(0);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("samples the unchanged ESP grid analytically at each density vertex", () => {
    const density=field(),esp=field("ELECTROSTATIC_POTENTIAL"),before=JSON.stringify([density,esp]);
    const surface=buildVtkFieldSurface(density,.001,false,esp);
    for(let i=0;i<surface.potentials!.length;i++){
      const p=[surface.positions[i*3]!+3,surface.positions[i*3+1]!+3,surface.positions[i*3+2]!+3] as const;
      expect(surface.potentials![i]).toBeCloseTo(sampleTrilinear(esp,p),5);
    }
    expect(surface.minimum).toBeLessThan(surface.maximum!);expect(JSON.stringify([density,esp])).toBe(before);
  });
  it("returns a meaningful empty mesh at high thresholds, without clamping", () => {
    expect(buildVtkFieldSurface(field(),999).triangleCount).toBe(0);
    expect(()=>buildVtkFieldSurface(field(),-.001)).toThrow();
    expect(()=>buildVtkFieldSurface({...field(),field_values:[NaN]},.001)).toThrow();
    expect(()=>buildVtkFieldSurface(field(),.001,false,{...field("ELECTROSTATIC_POTENTIAL"),manifest:{...field().manifest,field_quantity:"ELECTROSTATIC_POTENTIAL",result_sha256:"another"}})).toThrow();
  });
});
