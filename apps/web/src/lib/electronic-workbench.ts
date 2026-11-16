import type { MolecularOrbital, MolecularOrbitalAnalysis, VolumetricFieldOutput } from "@chemdft/schemas";
export type FieldMode = "MO" | "Density" | "ESP";
export type ElectronicInspectorContext = {
  projectId?: string;
  resultId: string; calculationId: string; result: MolecularOrbitalAnalysis;
  mode: FieldMode; orbital: MolecularOrbital; grid: VolumetricFieldOutput | null;
  potential: VolumetricFieldOutput | undefined;
};
