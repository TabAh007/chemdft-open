"use client";

import { useEffect, useState } from "react";
import { readSessionStored, writeSessionStored } from "@/lib/safe-storage";

export interface CiteNudgeProps {
  projectId: string;
  onOpenCite: () => void;
  className?: string;
}

/**
 * Small dismissible inline hint: "Using this in a paper? Copy the citation".
 * Never modal, never blocks, keyboard accessible, dismissal remembered per session per project.
 * Not shown for public example projects.
 */
export function CiteNudge({ projectId, onOpenCite, className }: CiteNudgeProps) {
  const isExample = projectId === "example" || projectId.startsWith("example-") || projectId === "template";
  const storageKey = `chemdft:cite-nudge-dismissed:${projectId}`;
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    if (isExample) return true;
    return readSessionStored(storageKey) === "true";
  });

  useEffect(() => {
    const handleShow = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!isExample && (!detail?.projectId || detail.projectId === projectId)) {
        if (readSessionStored(storageKey) !== "true") {
          setDismissed(false);
        }
      }
    };
    window.addEventListener("chemdft:show-cite-nudge", handleShow);
    return () => window.removeEventListener("chemdft:show-cite-nudge", handleShow);
  }, [projectId, storageKey, isExample]);

  if (dismissed || isExample) return null;

  const handleDismiss = () => {
    setDismissed(true);
    writeSessionStored(storageKey, "true");
  };

  const handleOpen = () => {
    handleDismiss();
    onOpenCite();
  };

  return (
    <div
      role="region"
      aria-label="Citation hint"
      className={className}
      data-testid="cite-nudge"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        padding: "4px 8px",
        background: "var(--cdf-panel, #f1f5f9)",
        border: "1px solid var(--cdf-line, #cbd5e1)",
        borderRadius: "4px",
        fontSize: "12px",
        color: "var(--cdf-text, #1e293b)",
        margin: "4px 0",
      }}
    >
      <span>Using this in a paper?</span>
      <button
        type="button"
        onClick={handleOpen}
        data-testid="cite-nudge-open-btn"
        style={{
          fontSize: "12px",
          fontWeight: 600,
          color: "#0284c7",
          background: "transparent",
          border: "none",
          padding: "0 2px",
          cursor: "pointer",
          textDecoration: "underline",
        }}
      >
        Copy the citation
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss citation hint"
        data-testid="cite-nudge-dismiss-btn"
        style={{
          background: "transparent",
          border: "none",
          color: "var(--cdf-text-muted, #64748b)",
          cursor: "pointer",
          padding: "0 4px",
          fontSize: "14px",
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
