// @vitest-environment jsdom

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { GeometryCandidateView } from "@chemdft/schemas";
import { KetcherEditorPanel } from "../src/app/[locale]/projects/[projectId]/workspace/ketcher-editor";

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  ketcher: { getMolfile: vi.fn().mockResolvedValue("Test drawing\nM  END\n"),
    setMolecule: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("@/lib/structure-workspace-api", () => ({
  generateGeometryCandidate: mocks.generate, acceptGeometryCandidate: vi.fn(),
}));
vi.mock("next/dynamic", () => ({
  default: () => function EditorHost({ onInit }: { onInit: (value: unknown) => void }) {
    useEffect(() => { onInit(mocks.ketcher); }, [onInit]);
    return null;
  },
}));
vi.mock("../src/app/[locale]/projects/[projectId]/workspace/visualization/candidate-preview-panel",
  () => ({ CandidatePreviewPanel: () => null }));
vi.mock("@chemdft/scientific-scene", () => ({ buildCandidatePreviewScene: () => ({}) }));
vi.mock("@chemdft/ui", () => ({
  AppIcon: () => null,
  StatusTag: ({ children }: { children: ReactNode }) => createElement("span", null, children),
  ActionButton: ({ text, disabled, onClick, "data-testid": testId }: {
    text: string; disabled?: boolean; onClick?: () => void; "data-testid"?: string;
  }) => createElement("button", { disabled, onClick, "data-testid": testId }, text),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

it.each(["C/C=C/C", "C/C=C\\C"])(
  "shows the server's existing stereo identity %s in geometry review",
  async (smiles) => {
    mocks.generate.mockResolvedValue({
      id: "candidate-123", candidate_artifact: { artifact_id: "artifact-123", sha256: "a".repeat(64) },
      manifest: {
        canonical_smiles: smiles, formula: "C4H8",
        source_atom_count: 4, explicit_hydrogen_count: 8,
        generation_method: "rdkit.etkdg3.preview-conformer",
        generation_parameters: { rdkit_version: "2025.09.1" },
        coordinate_representation: { overall_charge: 0, multiplicity: 1,
          coordinates: { atoms: [], bonds: [] } },
      },
    } as unknown as GeometryCandidateView);
    await act(async () => {
      root.render(createElement(KetcherEditorPanel, {
        initialMolfile: null, mode: "new", projectId: "project-123", onCancel: vi.fn(),
      }));
    });
    const generate = container.querySelector<HTMLButtonElement>('[data-testid="generate-3d-btn"]')!;
    expect(generate.disabled).toBe(false);
    await act(async () => { generate.click(); });
    const identity = container.querySelector('[aria-label="Generated stereochemical identity"]')!;
    expect(identity).not.toBeNull();
    expect(identity.querySelector("code")?.textContent).toBe(smiles);
    expect(identity.textContent).toContain("preserves this displayed stereochemical identity");
    expect(identity.textContent).toContain("not an optimized minimum");
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  },
);

