import vtkImageData from "@kitware/vtk.js/Common/DataModel/ImageData";
import vtkDataArray from "@kitware/vtk.js/Common/Core/DataArray";
import vtkMarchingCubes from "@kitware/vtk.js/Filters/General/ImageMarchingCubes";
import { assertCompatibleFields, sampleTrilinear, type FieldSurface, type VolumetricField } from "@chemdft/scientific-scene";

export const VTK_SURFACE_VERSION = "vtk-js-37.3.1-image-marching-cubes-1";
export type IndexedFieldSurface = FieldSurface & { indices: Uint32Array };

/** Lossless array-order adapter; no interpolation or filtering of scientific samples. */
export function vtkOrderedScalars(field: VolumetricField, invert = false): Float64Array {
  const [nx, ny, nz] = field.manifest.dimensions as [number, number, number];
  const result = new Float64Array(field.field_values.length);
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
    result[x + nx * (y + ny * z)] = (invert ? -1 : 1) * field.field_values[(x * ny + y) * nz + z]!;
  }
  return result;
}

/** Rendering derivative only: exact saved grid → indexed mesh → unchanged ESP sampler. */
export function buildVtkFieldSurface(field: VolumetricField, iso: number, invert = false, esp?: VolumetricField): IndexedFieldSurface {
  const dims = field.manifest.dimensions;
  if (!Number.isFinite(iso) || iso <= 0 || dims.length !== 3 || dims.some(n => !Number.isInteger(n) || n < 2 || n > 160)
    || dims.reduce((a,b) => a*b,1) !== field.field_values.length || field.field_values.length > 250000
    || field.field_values.some(v => !Number.isFinite(v)) || !Number.isFinite(field.manifest.spacing_angstrom)
    || field.manifest.spacing_angstrom <= 0 || field.manifest.origin_angstrom.length !== 3 || field.manifest.origin_angstrom.some(v => !Number.isFinite(v))) {
    throw new Error("Invalid scientific field or threshold");
  }
  if (esp) assertCompatibleFields(field, esp);
  const image = vtkImageData.newInstance();
  const contour = vtkMarchingCubes.newInstance({ contourValue: iso, computeNormals: true, mergePoints: true });
  try {
    image.setDimensions(dims[0]!, dims[1]!, dims[2]!);
    image.setOrigin([...field.manifest.origin_angstrom] as [number, number, number]);
    image.setSpacing(Array(3).fill(field.manifest.spacing_angstrom));
    image.getPointData().setScalars(vtkDataArray.newInstance({ name: "validated-saved-field", values: vtkOrderedScalars(field, invert), numberOfComponents: 1 }));
    contour.setInputData(image); contour.update();
    const poly = contour.getOutputData();
    const positions = Float32Array.from(poly.getPoints().getData());
    const normals = Float32Array.from(poly.getPointData().getNormals()?.getData() ?? []);
    const cells = poly.getPolys().getData();
    const indices = new Uint32Array(cells.length / 4 * 3);
    for (let i = 0; i < indices.length / 3; i++) {
      if (cells[i*4] !== 3) throw new Error("Expected triangular rendering surface");
      indices.set([cells[i*4+1]!, cells[i*4+2]!, cells[i*4+3]!],i*3);
    }
    if (positions.length !== normals.length || [...positions, ...normals].some(v => !Number.isFinite(v))) throw new Error("Non-finite rendering surface");
    let minimum: number | null = null, maximum: number | null = null;
    const potentials = esp ? new Float32Array(positions.length / 3) : null;
    if (esp && potentials) {
      for (let i = 0; i < potentials.length; i++) {
        const point = [0,1,2].map(j => {
          const v = (positions[i*3+j]! - field.manifest.origin_angstrom[j]!) / field.manifest.spacing_angstrom;
          // Float32 mesh coordinates may exceed an exact endpoint by a few ulps.
          if (v < -1e-5 || v > dims[j]! - 1 + 1e-5) throw new Error("Surface outside saved field frame");
          return Math.min(dims[j]! - 1, Math.max(0, v));
        }) as [number, number, number];
        const value = sampleTrilinear(esp, point);
        potentials[i] = value; minimum = Math.min(minimum ?? value, value); maximum = Math.max(maximum ?? value, value);
      }
    }
    return { positions, normals, indices, potentials, minimum, maximum, triangleCount: indices.length / 3 };
  } finally { contour.delete(); image.delete(); }
}
