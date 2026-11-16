"use client";

import { useEffect, useRef, useState } from "react";
import { readStored, writeStored } from "@/lib/safe-storage";
import { CITATION_METADATA } from "@/lib/citation";
import styles from "./export-share.module.css";

const SNAPSHOT_CREDIT_LINE_STORAGE_KEY = "chemdft:snapshot-credit-line";

export interface SnapshotDialogOptions {
  cropToContent?: boolean;
  showLegend?: boolean;
  showTriad?: boolean;
  showCellLabels?: boolean;
  showPolyhedra?: boolean;
  showCellOutline?: boolean;
  bondColorMode?: "split" | "uniform";
  addCreditLine?: boolean;
}

export interface SnapshotDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onDownload: (
    scale: 1 | 2 | 4,
    background: "white" | "transparent",
    options?: SnapshotDialogOptions,
  ) => void;
  structureName: string;
  figureCaptionText?: string;
}

export function SnapshotDialog({
  isOpen,
  onClose,
  onDownload,
  structureName,
  figureCaptionText,
}: SnapshotDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<1 | 2 | 4>(2);
  const [background, setBackground] = useState<"white" | "transparent">("white");
  const [cropToContent, setCropToContent] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [showTriad, setShowTriad] = useState(true);
  const [showCellLabels, setShowCellLabels] = useState(true);
  const [showPolyhedra, setShowPolyhedra] = useState(true);
  const [showCellOutline, setShowCellOutline] = useState(true);
  const [bondColorMode, setBondColorMode] = useState<"split" | "uniform">("split");
  const [addCreditLine, setAddCreditLineState] = useState(() => readStored(SNAPSHOT_CREDIT_LINE_STORAGE_KEY) === "true");
  const [captionCopied, setCaptionCopied] = useState(false);

  const setAddCreditLine = (checked: boolean) => {
    setAddCreditLineState(checked);
    writeStored(SNAPSHOT_CREDIT_LINE_STORAGE_KEY, String(checked));
  };

  const caption = figureCaptionText || `Structure rendered with ChemDFT ${CITATION_METADATA.version}${CITATION_METADATA.doi ? ` (DOI https://doi.org/${CITATION_METADATA.doi})` : ""}. ${structureName ? `Coordinates: ${structureName}.` : "Coordinates: not recorded."}`;

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="snapshot-dialog-title"
      data-testid="snapshot-dialog"
    >
      <div className={styles.dialog} ref={dialogRef} style={{ maxWidth: "480px" }}>
        <div className={styles.header}>
          <h2 id="snapshot-dialog-title">Snapshot of 3D view (.png)</h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>

        <div className={styles.body}>
          <p className={styles.description}>
            Render a high-resolution publication-quality figure of <strong>{structureName}</strong> from the current camera angle, including crystal axes labels, element legend, dashed bonds, and coordination polyhedra.
          </p>

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Resolution & size</legend>
            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="snapshot-scale"
                  value="1"
                  checked={scale === 1}
                  onChange={() => setScale(1)}
                  data-testid="snapshot-scale-1x"
                />
                <span><strong>1×</strong> — Standard on-screen resolution</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="snapshot-scale"
                  value="2"
                  checked={scale === 2}
                  onChange={() => setScale(2)}
                  data-testid="snapshot-scale-2x"
                />
                <span><strong>2×</strong> — High-DPI display resolution</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="snapshot-scale"
                  value="4"
                  checked={scale === 4}
                  onChange={() => setScale(4)}
                  data-testid="snapshot-scale-4x"
                />
                <span><strong>4×</strong> — Publication quality (≥3000 px long side)</span>
              </label>
            </div>
          </fieldset>

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Background</legend>
            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="snapshot-bg"
                  value="white"
                  checked={background === "white"}
                  onChange={() => setBackground("white")}
                  data-testid="snapshot-bg-white"
                />
                <span>White background (journal figure standard)</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="snapshot-bg"
                  value="transparent"
                  checked={background === "transparent"}
                  onChange={() => setBackground("transparent")}
                  data-testid="snapshot-bg-transparent"
                />
                <span>Transparent background</span>
              </label>
            </div>
          </fieldset>

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Cropping & margins</legend>
            <label className={styles.radioLabel}>
              <input
                type="checkbox"
                checked={cropToContent}
                onChange={(e) => setCropToContent(e.target.checked)}
                data-testid="snapshot-crop-toggle"
              />
              <span><strong>Crop to content with margin</strong> (removes empty borders)</span>
            </label>
          </fieldset>

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Bond colours</legend>
            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="snapshot-bond-color"
                  value="split"
                  checked={bondColorMode === "split"}
                  onChange={() => setBondColorMode("split")}
                  data-testid="snapshot-bond-color-split"
                />
                <span>Two-colour split bonds (element colours)</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="snapshot-bond-color"
                  value="uniform"
                  checked={bondColorMode === "uniform"}
                  onChange={() => setBondColorMode("uniform")}
                  data-testid="snapshot-bond-color-uniform"
                />
                <span>Uniform monochrome grey (#9ca3af)</span>
              </label>
            </div>
          </fieldset>

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Overlays & geometry</legend>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label className={styles.radioLabel}>
                <input
                  type="checkbox"
                  checked={showLegend}
                  onChange={(e) => setShowLegend(e.target.checked)}
                  data-testid="snapshot-toggle-legend"
                />
                <span>Element legend</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="checkbox"
                  checked={showTriad}
                  onChange={(e) => setShowTriad(e.target.checked)}
                  data-testid="snapshot-toggle-triad"
                />
                <span>Coordinate axis triad</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="checkbox"
                  checked={showCellLabels}
                  onChange={(e) => setShowCellLabels(e.target.checked)}
                  data-testid="snapshot-toggle-cell-labels"
                />
                <span>Cell & axis labels</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="checkbox"
                  checked={showPolyhedra}
                  onChange={(e) => setShowPolyhedra(e.target.checked)}
                  data-testid="snapshot-toggle-polyhedra"
                />
                <span>Coordination polyhedra</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="checkbox"
                  checked={showCellOutline}
                  onChange={(e) => setShowCellOutline(e.target.checked)}
                  data-testid="snapshot-toggle-cell-outline"
                />
                <span>Unit cell outline</span>
              </label>
            </div>
          </fieldset>

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Publication & citation</legend>
            <label className={styles.radioLabel}>
              <input
                type="checkbox"
                checked={addCreditLine}
                onChange={(e) => setAddCreditLine(e.target.checked)}
                data-testid="snapshot-credit-line-toggle"
              />
              <span>Add a small &apos;Rendered with ChemDFT&apos; line</span>
            </label>
            <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: "1px solid var(--cdf-line, #e2e8f0)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--cdf-text-muted, #64748b)" }}>Figure caption</span>
                <button
                  type="button"
                  style={{
                    fontSize: "11px",
                    padding: "3px 8px",
                    cursor: "pointer",
                    borderRadius: "4px",
                    border: "1px solid var(--cdf-line, #cbd5e1)",
                    background: captionCopied ? "#ecfdf5" : "var(--cdf-panel, #ffffff)",
                    color: captionCopied ? "#047857" : "inherit",
                    fontWeight: 500,
                  }}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(caption);
                      setCaptionCopied(true);
                      window.setTimeout(() => setCaptionCopied(false), 2000);
                    } catch {
                      // clipboard blocked
                    }
                  }}
                  data-testid="snapshot-copy-caption-btn"
                >
                  {captionCopied ? "Copied" : "Copy figure caption"}
                </button>
              </div>
              <p
                style={{
                  fontSize: "11px",
                  lineHeight: 1.4,
                  margin: 0,
                  padding: "6px 8px",
                  background: "var(--cdf-panel, #f8fafc)",
                  border: "1px solid var(--cdf-line, #e2e8f0)",
                  borderRadius: "4px",
                  color: "var(--cdf-text-muted, #475569)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
                data-testid="snapshot-caption-preview"
              >
                {caption}
              </p>
            </div>
          </fieldset>
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => {
              onDownload(scale, background, {
                cropToContent,
                showLegend,
                showTriad,
                showCellLabels,
                showPolyhedra,
                showCellOutline,
                bondColorMode,
                addCreditLine,
              });
              onClose();
            }}
            data-testid="snapshot-download-btn"
          >
            Download snapshot (.png)
          </button>
        </div>
      </div>
    </div>
  );
}

