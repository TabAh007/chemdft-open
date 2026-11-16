"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import styles from "./export-share.module.css";

export interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string | undefined;
  shareSummary: string;
  onDownload?: (() => void) | undefined;
  downloadLabel?: string | undefined;
  downloadFilename?: string | undefined;
  filesToShare?: File[] | undefined;
  getFilesToShare?: (() => Promise<File[]>) | undefined;
}

export function ShareDialog({
  isOpen,
  onClose,
  title,
  subtitle = "Phase 1: Direct device sharing and pre-filled drafts. No permanent public links.",
  shareSummary,
  onDownload,
  downloadLabel = "Download research artifact",
  downloadFilename,
  filesToShare,
  getFilesToShare,
}: ShareDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const canWebShare = useSyncExternalStore(
    () => () => {},
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    () => false,
  );
  const [copied, setCopied] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  async function handleDeviceShare() {
    if (!canWebShare) return;
    try {
      let files: File[] = [];
      if (filesToShare && filesToShare.length > 0) {
        files = filesToShare;
      } else if (getFilesToShare) {
        try {
          files = await getFilesToShare();
        } catch {
          // fallback
        }
      }

      const canShareWithFiles =
        typeof navigator.canShare === "function" &&
        files.length > 0 &&
        navigator.canShare({ files });

      if (canShareWithFiles) {
        await navigator.share({
          title: `ChemDFT Evidence: ${title}`,
          text: shareSummary,
          files: files,
        });
      } else {
        await navigator.share({
          title: `ChemDFT Evidence: ${title}`,
          text: shareSummary,
        });
      }
      setStatusNotice("Shared via device successfully.");
      window.setTimeout(() => setStatusNotice(null), 3000);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setStatusNotice("Device sharing cancelled or unavailable.");
        window.setTimeout(() => setStatusNotice(null), 3000);
      }
    }
  }

  async function handleCopySummary() {
    try {
      await navigator.clipboard.writeText(shareSummary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatusNotice("Clipboard access unavailable.");
      window.setTimeout(() => setStatusNotice(null), 3000);
    }
  }

  const emailSubject = encodeURIComponent(`ChemDFT Research Evidence: ${title}`);
  const emailBody = encodeURIComponent(
    `${shareSummary}\n\nNote: If you have exported a 3D PDF or data file, please attach it to this email. Standard mailto: links cannot attach files automatically.`,
  );
  const mailtoHref = `mailto:?subject=${emailSubject}&body=${emailBody}`;

  const whatsappText = encodeURIComponent(`*ChemDFT Evidence: ${title}*\n\n${shareSummary}`);
  const whatsappHref = `https://api.whatsapp.com/send?text=${whatsappText}`;

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
        aria-labelledby="share-dialog-title"
        aria-describedby="share-dialog-sub"
        data-testid="share-dialog"
      >
        <div className={styles.dialogHeader}>
          <div>
            <h2 id="share-dialog-title" className={styles.headerTitle}>
              Share Research Evidence
            </h2>
            <p id="share-dialog-sub" className={styles.headerSubtitle}>
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close share dialog"
            data-testid="share-dialog-close"
          >
            ✕
          </button>
        </div>

        <div className={styles.dialogBody}>
          <div className={styles.infoCard}>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Target</span>
              <span className={styles.infoValue}>{title}</span>
            </div>
            {downloadFilename ? (
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Artifact</span>
                <span className={`${styles.infoValue} ${styles.mono}`}>{downloadFilename}</span>
              </div>
            ) : null}
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Share Options (Phase 1)</h3>
            <div className={styles.shareList}>
              {onDownload ? (
                <div className={styles.shareItem}>
                  <div className={styles.shareItemInfo}>
                    <span className={styles.shareItemTitle}>
                      Direct File Download <span className={`${styles.badge} ${styles.badgeAvailable}`}>AVAILABLE</span>
                    </span>
                    <span className={styles.shareItemDesc}>
                      Download the research file directly to your device for local sharing.
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.buttonPrimary}`}
                    onClick={onDownload}
                    data-testid="share-download-btn"
                  >
                    {downloadLabel}
                  </button>
                </div>
              ) : null}

              <div className={styles.shareItem}>
                <div className={styles.shareItemInfo}>
                  <span className={styles.shareItemTitle}>
                    Device Share Sheet{" "}
                    <span className={`${styles.badge} ${canWebShare ? styles.badgeAvailable : styles.badgePlanned}`}>
                      {canWebShare ? "AVAILABLE" : "UNAVAILABLE"}
                    </span>
                  </span>
                  <span className={styles.shareItemDesc}>
                    {canWebShare
                      ? "Shares interactive HTML and report PDF files directly via your device share sheet where supported (AirDrop, Messages, etc.)."
                      : "Native Web Share API is not supported by your current browser environment."}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.button}
                  disabled={!canWebShare}
                  onClick={() => void handleDeviceShare()}
                  data-testid="share-device-btn"
                >
                  Share via device…
                </button>
              </div>

              <div className={styles.shareItem}>
                <div className={styles.shareItemInfo}>
                  <span className={styles.shareItemTitle}>
                    Email Draft (mailto:){" "}
                    <span className={`${styles.badge} ${styles.badgeAvailable}`}>AVAILABLE</span>
                  </span>
                  <span className={styles.shareItemDesc}>
                    Opens your desktop email client with pre-filled scientific summary and citation instructions. (Plain text only; standard mailto: links cannot attach files. Please attach exported files manually).
                  </span>
                </div>
                <a
                  href={mailtoHref}
                  className={styles.button}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="share-email-btn"
                >
                  Open email draft
                </a>
              </div>

              <div className={styles.shareItem}>
                <div className={styles.shareItemInfo}>
                  <span className={styles.shareItemTitle}>
                    WhatsApp Message{" "}
                    <span className={`${styles.badge} ${styles.badgeAvailable}`}>AVAILABLE</span>
                  </span>
                  <span className={styles.shareItemDesc}>
                    Drafts a WhatsApp text message with the molecule summary and evidence status. (Plain text only; WhatsApp links cannot attach files).
                  </span>
                </div>
                <a
                  href={whatsappHref}
                  className={styles.button}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="share-whatsapp-btn"
                >
                  Draft in WhatsApp
                </a>
              </div>

              <div className={styles.shareItem}>
                <div className={styles.shareItemInfo}>
                  <span className={styles.shareItemTitle}>
                    Copy Summary Text{" "}
                    <span className={`${styles.badge} ${styles.badgeAvailable}`}>AVAILABLE</span>
                  </span>
                  <span className={styles.shareItemDesc}>
                    Copy formatted scientific evidence summary and citation text to clipboard.
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => void handleCopySummary()}
                  data-testid="share-copy-btn"
                >
                  {copied ? "Copied!" : "Copy summary"}
                </button>
              </div>

              <div className={styles.shareItem} style={{ opacity: 0.7 }}>
                <div className={styles.shareItemInfo}>
                  <span className={styles.shareItemTitle}>
                    Hosted Public Link with Expiry{" "}
                    <span className={`${styles.badge} ${styles.badgePlanned}`}>PLANNED</span>
                  </span>
                  <span className={styles.shareItemDesc}>
                    Read-only links with expiration and revocation require server token infrastructure (Phase 2).
                  </span>
                </div>
                <button type="button" className={styles.button} disabled title="Planned for Phase 2">
                  Not enabled
                </button>
              </div>
            </div>
          </div>

          <div className={styles.notice} data-testid="share-text-notice">
            <strong>Attachment Notice:</strong> Web browsers and standard <code>mailto:</code> links cannot attach files automatically. Download the file first and attach it to your message manually.
          </div>

          {statusNotice ? (
            <div className={`${styles.statusMessage} ${styles.statusOk}`} role="status">
              {statusNotice}
            </div>
          ) : null}
        </div>

        <div className={styles.dialogFooter}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSecondary}`}
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
