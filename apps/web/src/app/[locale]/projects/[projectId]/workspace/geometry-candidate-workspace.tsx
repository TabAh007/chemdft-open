"use client";

import { plural } from "@/lib/overview-model";
import { useMemo, useState } from "react";

import { buildCandidatePreviewScene } from "@chemdft/scientific-scene";
import type { GeometryCandidateView } from "@chemdft/schemas";
import { acceptGeometryCandidate } from "@/lib/structure-workspace-api";
import { CandidatePreviewPanel } from "./visualization/candidate-preview-panel";

type DepictionAtom = { element: string; x: number; y: number };
type DepictionBond = { from: number; to: number; order: number };

/** Parse the 2D coordinates of a V2000 MOL block (the server-generated depiction artifact). */
export function parseMolDepiction(mol: string): { atoms: DepictionAtom[]; bonds: DepictionBond[] } {
  const lines = mol.split(/\r?\n/);
  let countsIdx = lines.findIndex((l) => l.includes("V2000"));
  if (countsIdx < 0) countsIdx = 3;
  const counts = lines[countsIdx] ?? "";
  const atomCount = Number.parseInt(counts.slice(0, 3), 10);
  const bondCount = Number.parseInt(counts.slice(3, 6), 10);
  if (!Number.isInteger(atomCount) || !Number.isInteger(bondCount) || atomCount < 1) return { atoms: [], bonds: [] };
  const atoms: DepictionAtom[] = [];
  for (let i = 0; i < atomCount; i += 1) {
    const row = lines[countsIdx + 1 + i] ?? "";
    atoms.push({ x: Number.parseFloat(row.slice(0, 10)), y: Number.parseFloat(row.slice(10, 20)), element: row.slice(31, 34).trim() });
  }
  const bonds: DepictionBond[] = [];
  for (let i = 0; i < bondCount; i += 1) {
    const row = lines[countsIdx + 1 + atomCount + i] ?? "";
    bonds.push({ from: Number.parseInt(row.slice(0, 3), 10) - 1, to: Number.parseInt(row.slice(3, 6), 10) - 1, order: Number.parseInt(row.slice(6, 9), 10) });
  }
  const finite = atoms.every((atom) => Number.isFinite(atom.x) && Number.isFinite(atom.y));
  const valid = bonds.every((bond) => bond.from >= 0 && bond.to >= 0 && bond.from < atoms.length && bond.to < atoms.length);
  return finite && valid ? { atoms, bonds } : { atoms: [], bonds: [] };
}

function Depiction2D({ mol, title }: { mol: string; title: string }) {
  const { atoms, bonds } = useMemo(() => parseMolDepiction(mol), [mol]);
  if (atoms.length === 0) return <p className="workspace-canvas-empty">The 2D depiction could not be read.</p>;
  const xs = atoms.map((atom) => atom.x);
  const ys = atoms.map((atom) => atom.y);
  const pad = 0.9;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const width = Math.max(Math.max(...xs) - Math.min(...xs) + 2 * pad, 2);
  const height = Math.max(Math.max(...ys) - Math.min(...ys) + 2 * pad, 2);
  // Molfile y grows upward; SVG y grows downward.
  const px = (x: number) => x - minX;
  const py = (y: number) => height - (y - minY);
  return (
    <svg className="geometry-candidate-2d" data-testid="geometry-candidate-2d" role="img"
      aria-label={`2D depiction of ${title}`} viewBox={`0 0 ${width} ${height}`}
      style={{ width: "100%", maxWidth: 360, background: "var(--bp-surface, #fff)", border: "1px solid #c5cbd3", borderRadius: 4 }}>
      {bonds.map((bond, index) => {
        const a = atoms[bond.from]!;
        const b = atoms[bond.to]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy) || 1;
        const nx = (-dy / length) * 0.07;
        const ny = (dx / length) * 0.07;
        const offsets = bond.order === 2 ? [-1, 1] : bond.order === 3 ? [-2, 0, 2] : [0];
        return offsets.map((offset) => (
          <line key={`${index}-${offset}`} data-testid="geometry-candidate-2d-bond"
            x1={px(a.x) + nx * offset} y1={py(a.y) - ny * offset} x2={px(b.x) + nx * offset} y2={py(b.y) - ny * offset}
            stroke="#1c2127" strokeWidth={0.05} strokeLinecap="round" />
        ));
      })}
      {atoms.map((atom, index) => atom.element === "C" ? null : (
        <g key={index} data-testid="geometry-candidate-2d-atom" data-element={atom.element}>
          <circle cx={px(atom.x)} cy={py(atom.y)} r={0.22} fill="#fff" />
          <text x={px(atom.x)} y={py(atom.y)} fontSize={0.42} textAnchor="middle" dominantBaseline="central"
            fill={atom.element === "O" ? "#c23030" : "#1c2127"} fontFamily="sans-serif">{atom.element}</text>
        </g>
      ))}
    </svg>
  );
}

export function GeometryCandidateWorkspace({
  projectId,
  candidate,
  drawingMol,
  onAccepted,
}: {
  projectId: string;
  candidate: GeometryCandidateView;
  drawingMol: string | null;
  onAccepted: () => void;
}) {
  const manifest = candidate.manifest;
  const coordinates = manifest.coordinate_representation;
  const scene = useMemo(() => buildCandidatePreviewScene({
    candidateId: candidate.id,
    representationId: candidate.candidate_artifact.artifact_id,
    representationRevision: 1,
    representation: coordinates,
  }), [candidate, coordinates]);
  const [inspected, setInspected] = useState(false);
  const [notOptimized, setNotOptimized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accepted = candidate.state === "ACCEPTED";
  const name = coordinates.name ?? manifest.formula;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await acceptGeometryCandidate({
        projectId,
        candidateId: candidate.id,
        payload: { candidate_sha256: candidate.candidate_artifact.sha256, inspected_geometry: true, understands_not_optimized: true },
      });
      window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
      onAccepted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The geometry could not be accepted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="geometry-candidate-workspace" data-testid="geometry-candidate-workspace" data-candidate-id={candidate.id}
      style={{ display: "grid", gap: 12 }}>
    <div className="workspace-candidate-meta" data-testid="geometry-candidate-meta">
      <strong>{name} · {manifest.formula}</strong>
      <span data-testid="geometry-candidate-class">{manifest.geometry_class} · {candidate.state}</span>
      <span>Created by the AI Scientist from a resolved chemical identity (AI hypothesis, unverified). RDKit ETKDGv3 conformer, not optimized, not experimental.</span>
      <code data-testid="geometry-candidate-smiles">{manifest.canonical_smiles}</code>
      <span>{manifest.source_atom_count + manifest.explicit_hydrogen_count} atoms ({manifest.explicit_hydrogen_count} explicit H) · SHA-256 {candidate.candidate_artifact.sha256.slice(0, 16)}…</span>
    </div>
    {drawingMol ? <Depiction2D mol={drawingMol} title={name} /> : <p className="workspace-canvas-empty">The 2D depiction is unavailable.</p>}
    <CandidatePreviewPanel scene={scene} title={`${manifest.formula} (RDKit ETKDGv3)`}
      subtitle={`Candidate ${candidate.id.slice(0, 8)} · ${plural(coordinates.coordinates.atoms.length, "atom")}`}
      warningText="AI-GENERATED CONFORMER (NOT OPTIMIZED) — Real RDKit 3D coordinates. Accept the geometry only after you have inspected it."
      statusTagText="AI draft" />
    {accepted ? <p role="status" data-testid="geometry-candidate-accepted">Accepted by a researcher as a committed structure version.</p> : (
      <fieldset data-testid="geometry-candidate-accept" style={{ border: "1px solid #c5cbd3", padding: 8 }}>
        <legend>Researcher acceptance</legend>
        <label><input type="checkbox" checked={inspected} onChange={(event) => setInspected(event.target.checked)} /> I inspected this geometry.</label>
        <label><input type="checkbox" checked={notOptimized} onChange={(event) => setNotOptimized(event.target.checked)} /> I understand it is a generated conformer, not an optimized structure.</label>
        <button type="button" disabled={!inspected || !notOptimized || busy} onClick={() => void accept()} data-testid="geometry-candidate-accept-button">
          {busy ? "Accepting…" : "Accept geometry"}
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </fieldset>
    )}
    </div>
  );
}
