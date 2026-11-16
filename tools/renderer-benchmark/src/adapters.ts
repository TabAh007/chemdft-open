import { buildFieldSurface, sampleTrilinear, assertCompatibleFields, type VolumetricField } from '../../../packages/scientific-scene/src/volumetric';
export type BenchMesh = { positions: Float32Array; normals: Float32Array; indices?: Uint32Array; potentials: Float32Array | null; minimum: number | null; maximum: number | null; triangles: number; native?: unknown };
export function mapPotential(mesh: BenchMesh, field: VolumetricField, esp?: VolumetricField): BenchMesh {
  if (!esp) return mesh;
  assertCompatibleFields(field, esp);
  const values = new Float32Array(mesh.positions.length / 3);
  let minimum = Infinity, maximum = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const point = [0,1,2].map(j => Math.min(field.manifest.dimensions[j]! - 1, Math.max(0, (mesh.positions[i*3+j]! - field.manifest.origin_angstrom[j]!) / field.manifest.spacing_angstrom))) as [number,number,number];
    const v = sampleTrilinear(esp, point); values[i] = v; minimum = Math.min(minimum,v); maximum = Math.max(maximum,v);
  }
  return { ...mesh, potentials: values, minimum, maximum };
}
export function currentMesh(field: VolumetricField, iso: number, invert: boolean, esp?: VolumetricField): BenchMesh {
  const mesh = buildFieldSurface(field, iso, invert, esp);
  return { ...mesh, triangles: mesh.triangleCount };
}
export async function vtkMesh(field: VolumetricField, iso: number, invert: boolean, esp?: VolumetricField): Promise<BenchMesh> {
  const [{default:ImageData},{default:DataArray},{default:MarchingCubes}] = await Promise.all([
    import('@kitware/vtk.js/Common/DataModel/ImageData'), import('@kitware/vtk.js/Common/Core/DataArray'), import('@kitware/vtk.js/Filters/General/ImageMarchingCubes'),
  ]);
  const [nx,ny,nz] = field.manifest.dimensions; const sign = invert ? -1 : 1;
  // ChemDFT z-fast → VTK x-fast: exact permutation, no resampling/filtering.
  const values = new Float64Array(field.field_values.length);
  for (let x=0;x<nx;x++) for(let y=0;y<ny;y++) for(let z=0;z<nz;z++) values[x + nx*(y+ny*z)] = sign*field.field_values[(x*ny+y)*nz+z];
  const image = ImageData.newInstance(); image.setDimensions(nx,ny,nz); image.setOrigin(...field.manifest.origin_angstrom); image.setSpacing(...Array(3).fill(field.manifest.spacing_angstrom));
  image.getPointData().setScalars(DataArray.newInstance({ name:'immutable-field', values, numberOfComponents:1 }));
  const contour = MarchingCubes.newInstance({ contourValue:iso, computeNormals:true, mergePoints:true }); contour.setInputData(image); contour.update();
  const poly = contour.getOutputData(); const cells = poly.getPolys().getData(); const indices = new Uint32Array(cells.length/4*3);
  for(let i=0;i<indices.length/3;i++) indices.set(cells.subarray(i*4+1,i*4+4),i*3);
  const mesh = { positions:Float32Array.from(poly.getPoints().getData()), normals:Float32Array.from(poly.getPointData().getNormals().getData()), indices, triangles:indices.length/3, potentials:null, minimum:null, maximum:null };
  contour.delete(); image.delete();
  return mapPotential(mesh,field,esp);
}
export async function molstarMesh(field: VolumetricField, iso: number, invert: boolean, esp?: VolumetricField): Promise<BenchMesh> {
  const [{Tensor,Mat4},{computeMarchingCubesMesh},{Mesh}] = await Promise.all([
    import('molstar/lib/mol-math/linear-algebra'), import('molstar/lib/mol-geo/util/marching-cubes/algorithm'), import('molstar/lib/mol-geo/geometry/mesh/mesh'),
  ]);
  const values = Float64Array.from(field.field_values, v => (invert ? -1 : 1)*v);
  const tensor = Tensor.create(Tensor.Space([...field.manifest.dimensions],[0,1,2],Float64Array), values);
  const native = await computeMarchingCubesMesh({ isoLevel:iso, scalarField:tensor }).run();
  const t = Mat4.identity(); const s=field.manifest.spacing_angstrom; t[0]=t[5]=t[10]=s; [t[12],t[13],t[14]]=field.manifest.origin_angstrom;
  Mesh.transform(native,t); Mesh.computeNormals(native);
  const mesh = { positions:native.vertexBuffer.ref.value.subarray(0,native.vertexCount*3), normals:native.normalBuffer.ref.value.subarray(0,native.vertexCount*3), indices:native.indexBuffer.ref.value.subarray(0,native.triangleCount*3), native, triangles:native.triangleCount, potentials:null, minimum:null, maximum:null };
  return mapPotential(mesh,field,esp);
}
