declare module "@kitware/vtk.js/Filters/General/ImageMarchingCubes" {
  import type { vtkImageData } from "@kitware/vtk.js/Common/DataModel/ImageData";
  import type { vtkPolyData } from "@kitware/vtk.js/Common/DataModel/PolyData";
  const vtkMarchingCubes: {
    newInstance(options: { contourValue: number; computeNormals: boolean; mergePoints: boolean }): {
      setInputData(image: vtkImageData): void;
      update(): void;
      getOutputData(): vtkPolyData;
      delete(): void;
    };
  };
  export default vtkMarchingCubes;
}
