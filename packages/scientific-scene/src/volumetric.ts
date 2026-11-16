import type { Vec3 } from "./types";

/** Immutable engine field. Rendering never writes scientific values. */
export type VolumetricField = {
  readonly manifest: {
    readonly dimensions: readonly number[];
    readonly origin_angstrom: readonly number[];
    readonly spacing_angstrom: number;
    readonly calculation_result_id: string;
    readonly result_sha256: string;
    readonly field_quantity: string;
    readonly grid_sha256: string;
  };
  readonly field_values: readonly number[];
};
export const SURFACE_RENDERER_VERSION = "marching-tetrahedra-2.0.0";
export const FIELD_INTERPOLATOR_VERSION = "trilinear-1.0.0";
const corners = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]] as const;
const tetrahedra = [[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]] as const;
export type FieldSurface = {
  positions: Float32Array;
  normals: Float32Array;
  potentials: Float32Array | null;
  minimum: number | null;
  maximum: number | null;
  triangleCount: number;
};
function validate(field: VolumetricField) {
  const dims = field.manifest.dimensions;
  if (dims.length !== 3 || dims.some(n => !Number.isInteger(n) || n < 2 || n > 160)
    || dims.reduce((a,b) => a*b, 1) !== field.field_values.length
    || field.field_values.length > 250000 || field.field_values.some(v => !Number.isFinite(v))
    || !Number.isFinite(field.manifest.spacing_angstrom) || field.manifest.spacing_angstrom <= 0
    || field.manifest.origin_angstrom.length !== 3 || field.manifest.origin_angstrom.some(v => !Number.isFinite(v))) {
    throw new Error("Invalid immutable field geometry or values");
  }
}
export function assertCompatibleFields(density: VolumetricField, esp: VolumetricField) {
  validate(density); validate(esp);
  if (density.manifest.field_quantity !== "ELECTRON_DENSITY" || esp.manifest.field_quantity !== "ELECTROSTATIC_POTENTIAL"
    || density.manifest.calculation_result_id !== esp.manifest.calculation_result_id
    || density.manifest.result_sha256 !== esp.manifest.result_sha256
    || density.manifest.spacing_angstrom !== esp.manifest.spacing_angstrom
    || JSON.stringify(density.manifest.dimensions) !== JSON.stringify(esp.manifest.dimensions)
    || JSON.stringify(density.manifest.origin_angstrom) !== JSON.stringify(esp.manifest.origin_angstrom)) {
    throw new Error("ESP mapping requires density and ESP from the same SCF result and grid frame");
  }
}
/** Coordinates are grid indices, including exact upper boundary. */
export function sampleTrilinear(field: VolumetricField, point: Vec3): number {
  const [nx, ny, nz] = field.manifest.dimensions as [number,number,number];
  const dims = [nx,ny,nz];
  if (point.some((v,i) => !Number.isFinite(v) || v < 0 || v > dims[i]! - 1)) throw new Error("Sampling outside field");
  const lo = point.map((v,i) => Math.min(Math.floor(v), dims[i]! - 2));
  const f = point.map((v,i) => v - lo[i]!);
  let value = 0;
  for (const x of [0,1]) for (const y of [0,1]) for (const z of [0,1]) {
    const w = (x ? f[0]! : 1-f[0]!) * (y ? f[1]! : 1-f[1]!) * (z ? f[2]! : 1-f[2]!);
    value += field.field_values[((lo[0]!+x)*ny+lo[1]!+y)*nz+lo[2]!+z]! * w;
  }
  return value;
}
/** Deterministic mesh plus interpolated field gradients; no field resampling/smoothing. */
export function buildFieldSurface(field: VolumetricField, iso: number, invert = false, esp?: VolumetricField): FieldSurface {
  validate(field);
  if (!Number.isFinite(iso) || iso <= 0) throw new Error("Isovalue must be positive");
  if (esp) assertCompatibleFields(field, esp);
  const [nx,ny,nz] = field.manifest.dimensions as [number,number,number];
  const origin = field.manifest.origin_angstrom;
  const spacing = field.manifest.spacing_angstrom;
  const sign = invert ? -1 : 1;
  const at = (x:number,y:number,z:number) => sign * field.field_values[(x*ny+y)*nz+z]!;
  const gradient = (p: Vec3): Vec3 => {
    const dims = [nx,ny,nz];
    return dims.map((n,i) => {
      const a = [...p] as [number,number,number]; const b = [...p] as [number,number,number];
      a[i] = Math.max(0,p[i]!-0.5); b[i] = Math.min(n-1,p[i]!+0.5);
      return -sign * (sampleTrilinear(field,b)-sampleTrilinear(field,a))/(b[i]!-a[i]!);
    }) as [number,number,number];
  };
  const positions:number[] = [], normals:number[] = [], potentials:number[] = [];
  let minimum = Infinity, maximum = -Infinity;
  for (let x=0;x<nx-1;x++) for (let y=0;y<ny-1;y++) for (let z=0;z<nz-1;z++) {
    const values = corners.map(([dx,dy,dz]) => at(x+dx,y+dy,z+dz));
    if (Math.min(...values) >= iso || Math.max(...values) < iso) continue;
    const points = corners.map(([dx,dy,dz]) => [x+dx,y+dy,z+dz] as Vec3);
    for (const tetra of tetrahedra) {
      const inside = tetra.filter(i => values[i]! >= iso), outside = tetra.filter(i => values[i]! < iso);
      const edge = (a:number,b:number): Vec3 => {
        const t = (iso-values[a]!)/(values[b]!-values[a]!);
        return points[a]!.map((v,i) => v+(points[b]![i]!-v)*t) as [number,number,number];
      };
      const vertices: Vec3[] = [];
      if (inside.length === 1) vertices.push(...outside.map(i => edge(inside[0]!,i)));
      else if (inside.length === 3) vertices.push(...inside.map(i => edge(outside[0]!,i)));
      else if (inside.length === 2) {
        const [a,b] = inside, [c,d] = outside;
        const ac=edge(a!,c!),ad=edge(a!,d!),bc=edge(b!,c!),bd=edge(b!,d!);
        vertices.push(ac,ad,bd,ac,bd,bc);
      }
      // Consistent outward winding prevents alternating back-face lighting facets.
      for (let i=0; i<vertices.length; i+=3) {
        const a=vertices[i]!, b=vertices[i+1]!, c=vertices[i+2]!;
        const u=b.map((v,j)=>v-a[j]!), v=c.map((n,j)=>n-a[j]!);
        const cross=[u[1]!*v[2]!-u[2]!*v[1]!,u[2]!*v[0]!-u[0]!*v[2]!,u[0]!*v[1]!-u[1]!*v[0]!];
        const g=gradient(a);
        if (cross.reduce((sum,n,j)=>sum+n*g[j]!,0)<0) { vertices[i+1]=c; vertices[i+2]=b; }
      }
      for (const p of vertices) {
        positions.push(...p.map((v,i) => origin[i]!+v*spacing));
        const g = gradient(p), length = Math.hypot(...g) || 1;
        normals.push(...g.map(v => v/length));
        if (esp) { const v = sampleTrilinear(esp,p); potentials.push(v); minimum=Math.min(minimum,v); maximum=Math.max(maximum,v); }
      }
    }
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals),
    potentials: esp ? Float32Array.from(potentials) : null,
    minimum: esp && potentials.length ? minimum : null, maximum: esp && potentials.length ? maximum : null,
    triangleCount: positions.length/9 };
}
/** Symmetric, explicit scalar range. Red=negative, white=zero, blue=positive. */
export function potentialColor(value: number, range: number): Vec3 {
  if (!Number.isFinite(value) || !Number.isFinite(range) || range <= 0) throw new Error("Invalid scalar range");
  const t = Math.min(1,Math.abs(value)/range);
  const end = value < 0 ? [0.82,0.16,0.18] : [0.16,0.34,0.82];
  return end.map(v => 1+(v-1)*t) as [number,number,number];
}
export function isovalueBounds(field: VolumetricField, density: boolean) {
  const max = field.field_values.reduce((a,b) => Math.max(a,Math.abs(b)),0);
  const defaultValue = Math.min(density ? 0.001 : 0.035, max*0.5);
  // Useful positive range spans the default; core density peaks do not dominate the slider.
  return { minimum: Math.max(Number.MIN_VALUE, defaultValue/10), maximum: density
    ? Math.min(max*0.95,defaultValue*100) : max*0.8, defaultValue };
}
