/**
 * DRAW mode, client side. The model only proposes typed commands; the server validates every step with RDKit and
 * returns the resulting molfile. This module holds the pure parts: request building, the undo trail and the
 * wording. Nothing here draws, computes or looks up a scientific value.
 */
import type { DrawInput, DrawResponse, DrawStepView } from "@chemdft/schemas";

export const DRAFT_LABEL = "AI-drafted · schematic";
export const MAX_REQUEST_CHARS = 1000;
export const MAX_HISTORY_TURNS = 6;

export type ChatTurn = { role: "user" | "assistant"; content: string };

export function buildDrawPayload(content: string, molfile: string | null, previousMolfile: string | null, history: ChatTurn[]): DrawInput {
  return {
    schema_version: "1.0.0",
    content: content.trim().slice(0, MAX_REQUEST_CHARS),
    molfile: molfile && molfile.trim() ? molfile : null,
    previous_molfile: previousMolfile && previousMolfile.trim() ? previousMolfile : null,
    // The generated type is a fixed-length tuple for a 0..6 array; the server accepts up to six turns.
    history: history.slice(-MAX_HISTORY_TURNS).map((turn) => ({ role: turn.role, content: turn.content.slice(0, 600) })) as NonNullable<DrawInput["history"]>,
  };
}

/** The steps the editor may apply: only validated ones, in order, up to the first failure. */
export function applicableSteps(response: DrawResponse): DrawStepView[] {
  if (response.status !== "OK" && response.status !== "PARTIAL" && response.status !== "NEEDS_ATTENTION") return [];
  const out: DrawStepView[] = [];
  for (const step of response.steps ?? []) {
    if (!step.ok || step.molfile === null || step.molfile === undefined || step.molfile === "") break;
    out.push(step);
  }
  return out;
}

/**
 * The undo trail of one AI-drafted session: trail[0] is the drawing before the first AI step, trail[n] the drawing
 * after step n. `pos` is the number of applied steps. Independent of Ketcher's own undo history.
 */
export type Trail = { molfiles: string[]; pos: number };

export const newTrail = (base: string): Trail => ({ molfiles: [base], pos: 0 });

export function extendTrail(trail: Trail, steps: DrawStepView[]): Trail {
  const kept = trail.molfiles.slice(0, trail.pos + 1);
  return { molfiles: [...kept, ...steps.map((step) => step.molfile ?? "")], pos: kept.length - 1 + steps.length };
}

export function undoLastStep(trail: Trail): { trail: Trail; molfile: string } | null {
  if (trail.pos <= 0) return null;
  const pos = trail.pos - 1;
  return { trail: { ...trail, pos }, molfile: trail.molfiles[pos] ?? "" };
}

export function undoAll(trail: Trail): { trail: Trail; molfile: string } {
  return { trail: { ...trail, pos: 0 }, molfile: trail.molfiles[0] ?? "" };
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export const STEP_DELAY_MS = 320;

export const drawText = {
  title: "Draw with the AI Scientist",
  intro: "Describe what to draw or change. The AI proposes typed commands, the server checks each one with RDKit, and you see the drawing grow step by step. Nothing is saved until you generate and accept 3D.",
  placeholder: "e.g. draw ethanol, add an OH on the ring, undo that",
  inputLabel: "Message to the drawing assistant",
  send: "Send",
  working: "Working…",
  applying: "Applying steps…",
  examples: ["draw ethanol", "draw phenol", "add a methyl group on atom 1"],
  empty: "Ask for a molecule or an edit. English works best; other languages are untested.",
  unavailable: "The AI is not available right now. You can keep drawing by hand; nothing here is lost.",
  notOnServer: "The drawing assistant is not available on this server yet. You can keep drawing by hand; nothing here is lost.",
  notConfigured: "The AI is not configured for this account. Open the AI Scientist settings to enable it.",
  bannerLabel: DRAFT_LABEL,
  keep: "Keep",
  fit: "Fit",
  fitAll: "Fit all",
  fitTitle: "Zoom and centre the drawing in the canvas",
  fitAllTitle: "The drawing is too large to show readably; the main fragment is in view. Zoom out to show everything.",
  partialView: "Showing the main fragment",
  undoLast: "Undo last step",
  undoAll: "Undo all",
  edited: "You edited the drawing after the AI steps; undo returns to the AI snapshots.",
  changedWhileWaiting: "The drawing changed while the assistant was working, so nothing was applied. Ask again.",
  proposalNote: "Proposed from the model’s own knowledge, not looked up.",
  schematic: "Schematic 2D drawing: no energies, spectra or properties.",
  languageNote: "English only tested.",
} as const;

/** A MOL block has its counts line on line 4; re-pad title lines that a transport trimmed away. */
export function padMolfile(molfile: string): string {
  const lines = molfile.replace(/\r\n?/g, "\n").split("\n");
  const counts = lines.slice(0, 6).findIndex((line) => /V[23]000\s*$/.test(line));
  if (counts < 0 || counts >= 3) return molfile;
  return `${"\n".repeat(3 - counts)}${lines.join("\n")}`;
}

/** What the chat shows when the draw request itself fails: 503 = AI unavailable, 404 = an older server without the route. */
export function drawFailureMessage(status: number, message: string | null | undefined): string {
  if (status === 503) return drawText.unavailable;
  if (status === 404) return drawText.notOnServer;
  return message && message.trim() ? message : drawText.unavailable;
}
