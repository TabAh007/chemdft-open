"use client";

import { useMemo } from "react";
import { StatusTag } from "@chemdft/ui";
import { parseMolDepiction } from "../geometry-candidate-workspace";

export type MolecularRecognitionCandidateView = {
  candidateId: string;
  projectId: string;
  documentTitle: string;
  documentId: string;
  pageNumber: number | null;
  figureNumber: string;
  figureUrl: string;
  figureRegion: [number, number, number, number]; // [x, y, width, height]
  recognitionEngine: string;
  engineVersion: string;
  proposedSmiles: string | null;
  formula: string | null;
  formalCharge: number | null;
  heavyAtomCount: number | null;
  rawModelOutput?: string | null;
  drawingMol: string | null; // V2000 MOL block for 2D depiction
  status: string; // "MANUAL_REVIEW_REQUIRED", "AMBIGUOUS", "UNSUPPORTED", "PARSE_FAILED"
  confidence: number | null;
  validationWarnings: string[];
  diagnostics: string[];
  unresolvedAmbiguities: string[];
};

export function CandidateFigureRecognitionPanel({
  candidate,
  onReview,
  onReject,
}: {
  candidate: MolecularRecognitionCandidateView;
  onReview?: () => void;
  onReject?: () => void;
}) {
  const { atoms, bonds } = useMemo(() => {
    return candidate.drawingMol ? parseMolDepiction(candidate.drawingMol) : { atoms: [], bonds: [] };
  }, [candidate.drawingMol]);

  const hasMol = atoms.length > 0;
  const isAmbiguous = candidate.status === "AMBIGUOUS";
  const isUnsupported = candidate.status === "UNSUPPORTED";
  const isFailed = candidate.status === "PARSE_FAILED" || candidate.status === "UNRECOGNIZABLE";

  const statusIntent = isFailed ? "danger" : isUnsupported || isAmbiguous ? "warning" : "none";

  // Compute 2D SVG bounding box
  const xs = atoms.map((atom) => atom.x);
  const ys = atoms.map((atom) => atom.y);
  const pad = 0.9;
  const minX = hasMol ? Math.min(...xs) - pad : 0;
  const minY = hasMol ? Math.min(...ys) - pad : 0;
  const width = hasMol ? Math.max(Math.max(...xs) - Math.min(...xs) + 2 * pad, 2) : 100;
  const height = hasMol ? Math.max(Math.max(...ys) - Math.min(...ys) + 2 * pad, 2) : 100;
  const px = (x: number) => x - minX;
  const py = (y: number) => height - (y - minY);

  return (
    <section
      className="candidate-figure-recognition-panel"
      data-testid="candidate-figure-recognition-panel"
      aria-label="Molecular Diagram Recognition Review"
      style={{
        display: "grid",
        gap: 16,
        padding: 16,
        background: "var(--bp-surface-subtle, #f9fafb)",
        border: "1px solid #c5cbd3",
        borderRadius: 6,
      }}
    >
      {/* Header bar with provenance and status */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>
            {candidate.figureNumber} · Page {candidate.pageNumber ?? "Unavailable"}
          </h3>
          <span style={{ fontSize: "0.85rem", color: "#5c7080" }}>
            Source: <em>{candidate.documentTitle}</em> · Engine: <span data-testid="recognition-engine-tag">{candidate.recognitionEngine} v{candidate.engineVersion}</span>
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span
            data-testid="unverified-hypothesis-badge"
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "#a94442",
              background: "#f2dede",
              border: "1px solid #ebccd1",
              padding: "2px 6px",
              borderRadius: 3,
              textTransform: "uppercase",
            }}
          >
            UNVERIFIED
          </span>
          <span data-testid="candidate-status-tag">
            <StatusTag intent={statusIntent}>
              {candidate.status}
            </StatusTag>
          </span>
          <span
            data-testid="recognition-confidence-badge"
            style={{
              fontSize: "0.8rem",
              color: candidate.confidence !== null ? "#5c7080" : "#8a6d3b",
              background: candidate.confidence !== null ? "transparent" : "#fcf8e3",
              border: candidate.confidence !== null ? "none" : "1px solid #faebcc",
              padding: candidate.confidence !== null ? 0 : "2px 6px",
              borderRadius: 3,
            }}
          >
            {candidate.confidence !== null
              ? `Confidence: ${Math.round(candidate.confidence * 100)}%`
              : "Confidence: Uncalibrated (DECIMER output)"}
          </span>
        </div>
      </div>

      {/* Side-by-side inspection layout: Original PDF Figure | Proposed Molecule */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
        }}
      >
        {/* Left pane: Original PDF Figure Crop */}
        <div
          data-testid="original-figure-container"
          style={{
            background: "#ffffff",
            border: "1px solid #d8dde6",
            borderRadius: 4,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div style={{ width: "100%", display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <strong style={{ fontSize: "0.85rem", color: "#1c2127" }}>Original PDF Figure</strong>
            <span style={{ fontSize: "0.75rem", color: "#5c7080" }}>
              Region: [{candidate.figureRegion.map((v) => v.toFixed(2)).join(", ")}]
            </span>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={candidate.figureUrl}
            alt={`Original ${candidate.figureNumber} from page ${candidate.pageNumber}`}
            data-testid="original-figure-image"
            style={{
              maxWidth: "100%",
              maxHeight: 280,
              objectFit: "contain",
              border: "1px solid #e1e8ed",
              borderRadius: 3,
            }}
          />
        </div>

        {/* Right pane: Proposed Molecular Structure */}
        <div
          data-testid="proposed-molecule-container"
          style={{
            background: "#ffffff",
            border: "1px solid #d8dde6",
            borderRadius: 4,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div style={{ width: "100%", display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <strong data-testid="chemical-formula-display" style={{ fontSize: "0.85rem", color: "#1c2127" }}>
              Proposed Graph {candidate.formula ? `(${candidate.formula})` : ""}
            </strong>
            <span style={{ fontSize: "0.75rem", color: "#5c7080" }}>
              Charge: {candidate.formalCharge ?? "—"} · Atoms: {candidate.heavyAtomCount ?? "—"}
            </span>
          </div>

          {hasMol ? (
            <svg
              className="proposed-molecule-2d"
              data-testid="proposed-molecule-2d"
              role="img"
              aria-label={`Proposed molecular graph for ${candidate.figureNumber}`}
              viewBox={`0 0 ${width} ${height}`}
              style={{
                width: "100%",
                maxWidth: 320,
                height: 240,
                background: "#ffffff",
                border: "1px solid #e1e8ed",
                borderRadius: 4,
              }}
            >
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
                  <line
                    key={`${index}-${offset}`}
                    x1={px(a.x) + nx * offset}
                    y1={py(a.y) - ny * offset}
                    x2={px(b.x) + nx * offset}
                    y2={py(b.y) - ny * offset}
                    stroke="#1c2127"
                    strokeWidth={0.06}
                    strokeLinecap="round"
                  />
                ));
              })}
              {atoms.map((atom, index) => (
                atom.element === "C" ? null : (
                  <g key={index}>
                    <circle cx={px(atom.x)} cy={py(atom.y)} r={0.25} fill="#ffffff" />
                    <text
                      x={px(atom.x)}
                      y={py(atom.y)}
                      fontSize={0.44}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={atom.element === "O" ? "#c23030" : atom.element === "N" ? "#2b6cb0" : "#1c2127"}
                      fontFamily="sans-serif"
                      fontWeight="bold"
                    >
                      {atom.element}
                    </text>
                  </g>
                )
              ))}
            </svg>
          ) : (
            <div
              data-testid="proposed-molecule-2d-fallback"
              style={{
                width: "100%",
                height: 240,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#f4f5f7",
                borderRadius: 4,
                color: "#5c7080",
                fontSize: "0.85rem",
              }}
            >
              {candidate.proposedSmiles ? "2D coordinates could not be computed" : "No molecular structure recognized"}
            </div>
          )}

          {candidate.proposedSmiles && (
            <div style={{ marginTop: 8, width: "100%", textAlign: "center" }}>
              <div style={{ fontSize: "0.75rem", color: "#5c7080", marginBottom: 2 }}>Proposed SMILES:</div>
              <code data-testid="proposed-smiles-representation" style={{ fontSize: "0.8rem", background: "#f0f2f5", padding: "2px 6px", borderRadius: 3 }}>
                {candidate.proposedSmiles}
              </code>
              <div data-testid="raw-model-output" style={{ fontSize: "0.75rem", color: "#738a9c", marginTop: 4 }}>
                Raw predicted representation: <code>{candidate.rawModelOutput || candidate.proposedSmiles}</code>
              </div>
            </div>
          )}
          {hasMol ? <p className="workspace-muted" role="note">This schematic overview omits charge, isotope and stereo markings. Inspect the original figure and use Ketcher below for the full molecular representation.</p> : null}
        </div>
      </div>

      {/* Scientific Warnings and Audit Notice */}
      <div
        role="note"
        data-testid="scientific-integrity-notice"
        style={{
          background: "#fff8e1",
          border: "1px solid #ffe082",
          borderRadius: 4,
          padding: 10,
          fontSize: "0.82rem",
          color: "#795548",
        }}
      >
        <strong>SCIENTIFIC INTEGRITY NOTICE:</strong> This proposal is unverified machine hypothesis. RDKit parse success confirms graph syntax only and does not verify agreement with the publication. Mandatory researcher review required before use.
        {candidate.validationWarnings.length > 0 && (
          <div data-testid="validation-warnings-section" style={{ marginTop: 4 }}>
            <strong>Validation warnings:</strong>
            <ul style={{ margin: "2px 0 0 16px", padding: 0 }}>
              {candidate.validationWarnings.map((warn, i) => (
                <li key={i}>{warn}</li>
              ))}
            </ul>
          </div>
        )}
        {candidate.unresolvedAmbiguities && candidate.unresolvedAmbiguities.length > 0 && (
          <div data-testid="unresolved-ambiguities-section" style={{ marginTop: 4 }}>
            <strong>Unresolved ambiguities:</strong>
            <ul style={{ margin: "2px 0 0 16px", padding: 0 }}>
              {candidate.unresolvedAmbiguities.map((amb, i) => (
                <li key={i}>{amb}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Review actions */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
        {onReject && (
          <button
            type="button"
            onClick={onReject}
            data-testid="reject-candidate-button"
            style={{
              background: "#ffffff",
              border: "1px solid #c5cbd3",
              color: "#c23030",
              padding: "6px 12px",
              borderRadius: 4,
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Reject Proposal
          </button>
        )}
        {onReview && (
          <button
            type="button"
            onClick={onReview}
            data-testid="review-candidate-button"
            style={{
              background: "#106ba3",
              border: "none",
              color: "#ffffff",
              padding: "6px 14px",
              borderRadius: 4,
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Mark as Reviewed (does not promote)
          </button>
        )}
      </div>
    </section>
  );
}
