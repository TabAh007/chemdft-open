"use client";

import { AppIcon } from "@chemdft/ui";

export interface WorkspaceModeToggleProps {
  mode: "guided" | "advanced";
  onChange: (mode: "guided" | "advanced") => void;
}

export function WorkspaceModeToggle({ mode, onChange }: WorkspaceModeToggleProps) {
  return (
    <div
      className="workspace-mode-toggle"
      role="group"
      aria-label="Workspace experience mode"
      data-testid="workspace-mode-toggle"
    >
      <button
        type="button"
        className={`mode-toggle-btn ${mode === "guided" ? "active" : ""}`}
        aria-pressed={mode === "guided"}
        onClick={() => onChange("guided")}
        data-testid="mode-toggle-guided"
        title="Guided Mode: Simplified, task-oriented workflow with plain-language recommendations"
      >
        <AppIcon icon="predictive-analysis" />
        <span>Guided</span>
      </button>

      <button
        type="button"
        className={`mode-toggle-btn ${mode === "advanced" ? "active" : ""}`}
        aria-pressed={mode === "advanced"}
        onClick={() => onChange("advanced")}
        data-testid="mode-toggle-advanced"
        title="Advanced Workbench: Full project tree, exact records, Inspector, and advanced controls"
      >
        <AppIcon icon="wrench" />
        <span>Advanced Workbench</span>
      </button>
    </div>
  );
}
