"use client";

import { useEffect, useRef, useState } from "react";
import { downloadProject3dPdf } from "@/lib/project-export-api";
import { saveBlob } from "@/lib/download";
import styles from "./export-share.module.css";

export interface Export3dPdfDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenShare: (filename: string, summary: string) => void;
  projectId: string;
  structureName: string;
  formula: string;
  atomCount: number;
  authority: "CALCULATED" | "USER_ENTERED · NOT OPTIMIZED";
  structureVersionId?: string | undefined;
  isAvailable?: boolean | undefined;
  unavailableReason?: string | undefined;
}

export function Export3dPdfDialog({
  isOpen,
  onClose,
  onOpenShare,
  projectId,
  structureName,
  formula,
  atomCount,
  authority,
  structureVersionId,
  isAvailable = false,
  unavailableReason = "Requires Asymptote server toolchain and Adobe Acrobat on client.",
}: Export3dPdfDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<"ball_and_stick" | "stick">("ball_and_stick");
  const [include3d, setInclude3d] = useState(true);
  const [includeProperties, setIncludeProperties] = useState(true);
  const [includeProvenance, setIncludeProvenance] = useState(true);
  const [includeRawAttachments, setIncludeRawAttachments] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const expectedFilename = `${structureName.replace(/\s+/g, "_").toLowerCase()}_3d.pdf`;
  const summaryText = `ChemDFT 3D PDF: ${structureName} (${formula}, ${atomCount} atoms) · Authority: [${authority}]. Contains ISO 32000-1 PRC 3D model, calculated properties, and embedded scientific data files.`;

  async function handleDownload() {
    if (!isAvailable) {
      setError(`3D PDF export is currently IN TESTING and not available on this server: ${unavailableReason}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await downloadProject3dPdf(projectId, structureVersionId);
      saveBlob(result.blob, result.filename);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "3D PDF generation failed.");
    } finally {
      setBusy(false);
    }
  }

  function handleShareClick() {
    onOpenShare(expectedFilename, summaryText);
  }

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className={styles.dialog}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-3d-dialog-title"
        aria-describedby="export-3d-dialog-sub"
        data-testid="export-3d-pdf-dialog"
      >
        <div className={styles.dialogHeader}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
              <h2 id="export-3d-dialog-title" className={styles.headerTitle} style={{ margin: 0 }}>
                Export 3D PDF (Adobe Acrobat)
              </h2>
              <span className={`${styles.badge} ${isAvailable ? styles.badgeAvailable : styles.badgeTesting}`}>
                {isAvailable ? "AVAILABLE" : "IN TESTING — NOT AVAILABLE YET"}
              </span>
            </div>
            <p id="export-3d-dialog-sub" className={styles.headerSubtitle}>
              ISO 32000-1 rotatable 3D model with embedded scientific evidence
            </p>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close dialog"
            data-testid="export-3d-close-btn"
          >
            ✕
          </button>
        </div>

        <div className={styles.dialogBody}>
          {!isAvailable ? (
            <div className={styles.noticeWarning} data-testid="3d-pdf-testing-notice">
              <strong>IN TESTING — not available yet:</strong> {unavailableReason} Interactive 3D web page export (.html) is recommended as the primary cross-platform 3D option.
            </div>
          ) : null}

          <div className={styles.infoCard}>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Structure</span>
              <span className={styles.infoValue}>{structureName}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Formula & Size</span>
              <span className={styles.infoValue}>
                {formula} · {atomCount} atoms
              </span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Coordinate Authority</span>
              <span>
                <span
                  className={`${styles.badge} ${
                    authority === "CALCULATED" ? styles.badgeCalculated : styles.badgeUserEntered
                  }`}
                >
                  [{authority}]
                </span>
              </span>
            </div>
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Included PDF Content</h3>
            <div className={styles.checkboxGroup}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={include3d}
                  onChange={(e) => setInclude3d(e.target.checked)}
                />
                <span>Interactive 3D model (PRC binary mesh with camera views)</span>
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={includeProperties}
                  onChange={(e) => setIncludeProperties(e.target.checked)}
                />
                <span>Calculated properties table (energies, dipoles, frequencies)</span>
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={includeProvenance}
                  onChange={(e) => setIncludeProvenance(e.target.checked)}
                />
                <span>Methods, citation metadata & software engine versions</span>
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={includeRawAttachments}
                  onChange={(e) => setIncludeRawAttachments(e.target.checked)}
                />
                <span>Attach raw Cartesian coordinates (.xyz) and manifest (.json)</span>
              </label>
            </div>
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>3D Visual Style</h3>
            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="style"
                  value="ball_and_stick"
                  checked={style === "ball_and_stick"}
                  onChange={() => setStyle("ball_and_stick")}
                />
                <span>Ball and stick</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="style"
                  value="stick"
                  checked={style === "stick"}
                  onChange={() => setStyle("stick")}
                />
                <span>Sticks</span>
              </label>
            </div>
          </div>

          <div className={styles.noticeWarning}>
            <strong>Viewer Requirement:</strong> Adobe Acrobat or Adobe Acrobat Reader on Windows/macOS is required to interact with the 3D model. Standard viewers (Chrome, Safari, Preview) display the 2D poster image.
          </div>

          {error ? (
            <div className={`${styles.statusMessage} ${styles.statusError}`} role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <div className={styles.dialogFooter}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSecondary}`}
            onClick={onClose}
            disabled={busy}
            data-testid="export-3d-cancel-btn"
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={handleShareClick}
            disabled={busy}
            data-testid="export-3d-share-btn"
          >
            Share…
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={() => void handleDownload()}
            disabled={busy || !isAvailable}
            data-testid="export-3d-download-btn"
            title={!isAvailable ? "In testing: Asymptote is not active on this server" : undefined}
          >
            {busy ? "Generating 3D PDF…" : !isAvailable ? "In Testing — Not Available" : "Download 3D PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
