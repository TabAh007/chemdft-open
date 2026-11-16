import { describe, expect, it } from "vitest";
import { assertCompatibleFields, buildFieldSurface, isovalueBounds, potentialColor, sampleTrilinear, type VolumetricField } from "./volumetric";

function field(kind="ELECTRON_DENSITY"): VolumetricField {
  return { manifest: { dimensions:[5,5,5],origin_angstrom:[0,0,0],spacing_angstrom:1,
    calculation_result_id:"result",result_sha256:"hash",grid_sha256:kind,field_quantity:kind },
    field_values: Array.from({length:125},(_,i) => {
      const x=Math.floor(i/25),y=Math.floor(i/5)%5,z=i%5;
      return kind === "ELECTRON_DENSITY" ? 0.002*Math.exp(-((x-2)**2+(y-2)**2+(z-2)**2)) : x+2*y-z;
    }) };
}
describe("immutable electronic fields", () => {
  it("interpolates an analytic linear potential including boundary", () => {
    expect(sampleTrilinear(field("ELECTROSTATIC_POTENTIAL"),[1.2,2.3,0.4])).toBeCloseTo(5.4);
    expect(sampleTrilinear(field("ELECTROSTATIC_POTENTIAL"),[4,4,4])).toBe(8);
    expect(() => sampleTrilinear(field(),[-1,0,0])).toThrow();
  });
  it("maps ESP on density geometry and keeps hashes/values immutable across isovalues", () => {
    const density=field(),esp=field("ELECTROSTATIC_POTENTIAL"),before=JSON.stringify([density,esp]);
    const mesh=buildFieldSurface(density,0.001,false,esp);
    expect(mesh.triangleCount).toBeGreaterThan(0);
    for (let i=0;i<mesh.positions.length;i+=9) {
      const p=mesh.positions,n=mesh.normals;
      const u=[p[i+3]!-p[i]!,p[i+4]!-p[i+1]!,p[i+5]!-p[i+2]!];
      const v=[p[i+6]!-p[i]!,p[i+7]!-p[i+1]!,p[i+8]!-p[i+2]!];
      const cross=[u[1]!*v[2]!-u[2]!*v[1]!,u[2]!*v[0]!-u[0]!*v[2]!,u[0]!*v[1]!-u[1]!*v[0]!];
      expect(cross.reduce((sum,value,j)=>sum+value*n[i+j]!,0)).toBeGreaterThanOrEqual(-1e-7);
    }
    expect(mesh.minimum).toBeLessThan(mesh.maximum!);
    expect([...mesh.normals,...mesh.potentials!].every(Number.isFinite)).toBe(true);
    expect(buildFieldSurface(density,0.0003,false,esp).positions.length).not.toBe(mesh.positions.length);
    expect(JSON.stringify([density,esp])).toBe(before);
  });
  it("rejects missing/mismatched ESP source frames and invalid density isovalues", () => {
    const density=field(),esp=field("ELECTROSTATIC_POTENTIAL");
    expect(() => assertCompatibleFields(density,{...esp,manifest:{...esp.manifest,result_sha256:"other"}})).toThrow();
    expect(() => buildFieldSurface(density,-0.001)).toThrow();
    expect(() => buildFieldSurface({...density,field_values:[NaN]},0.001)).toThrow();
  });
  it("has adaptive bounds and distinct scalar color semantics", () => {
    const bounds=isovalueBounds(field(),true);
    expect(bounds.minimum).toBeLessThan(bounds.defaultValue);
    expect(bounds.maximum).toBeGreaterThan(bounds.defaultValue);
    expect(potentialColor(0,1)).toEqual([1,1,1]);
    expect(potentialColor(-1,1)[0]).toBeGreaterThan(potentialColor(-1,1)[2]);
    expect(potentialColor(1,1)[2]).toBeGreaterThan(potentialColor(1,1)[0]);
  });
});
