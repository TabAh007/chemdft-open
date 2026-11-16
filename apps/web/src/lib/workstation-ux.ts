import type { AIMessageView, AIRunView } from "@chemdft/schemas";
import type { WorkspaceSelection } from "./workspace-selection";

export function workbenchKind(selection: WorkspaceSelection | null): "project" | "structure" | "result" | "dataset" | "source" | "record" {
  if (!selection) return "project";
  if (["structureVersion", "optimizedStructureVersion", "scientificScene"].includes(selection.kind)) return "structure";
  if (selection.kind === "calculationResult") return "result";
  if (selection.kind === "experimentalDataset" || selection.kind === "experimentalSpectrum") return "dataset";
  if (["document", "documentEvidence", "file"].includes(selection.kind)) return "source";
  return "record";
}
export function parsePositiveThreshold(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}
export function formatThreshold(value: number): string { return String(value); }
export function sliderThreshold(logValue: number): number { return Number((10 ** logValue).toPrecision(6)); }
export function runBusy(run: AIRunView | null | undefined): boolean {
  return Boolean(run && ["CREATED", "PLANNING", "EXECUTING", "WAITING_FOR_CALCULATION", "WAITING_FOR_APPROVAL"].includes(run.status));
}
/** Execution progress is derived only from persisted backend states/steps. */
export function aiProgress(run: AIRunView | null | undefined, submitting: boolean): string | null {
  if (!runBusy(run)) return submitting ? "Question submitted · Waiting for the server…" : null;
  if (run!.status === "WAITING_FOR_CALCULATION") return "Calculation running…";
  if (run!.status === "WAITING_FOR_APPROVAL") return "Waiting for your approval";
  const running = [...(run!.steps ?? [])].reverse().find(step => step.status === "RUNNING");
  if (running?.tool_name === "knowledge.search") return "Retrieving supporting evidence…";
  if (running) return running.summary ?? "Inspecting saved scientific records…";
  if (run!.status === "PLANNING") return "Gathering project context…";
  return "Preparing answer…";
}
export function supersededAnswer(message: AIMessageView, index: number, messages: readonly AIMessageView[]): boolean {
  const failed = message.evidence_status === "INSUFFICIENT_EVIDENCE" || (!message.evidence_status && /saved evidence is no longer available|answer unavailable|could not|failed to/i.test(message.content));
  return message.role === "assistant" && failed && messages.slice(index + 1).some(item => item.role === "assistant" && (item.evidence_status === "SUPPORTED" || item.evidence_status === "PARTIAL"));
}
/** Split existing answer text, retaining exact words and citation markers. */
export function answerSections(content: string): { heading: string | null; content: string }[] {
  const sections: { heading: string | null; content: string }[] = [];
  for (const paragraph of content.split(/\n\s*\n/)) {
    const explicit = /^(?:#{1,3}\s+|\*\*)([^\n*]+?)(?:\*\*)?\n([\s\S]*)$/.exec(paragraph);
    if (explicit) { sections.push({ heading: explicit[1]!, content: explicit[2]! }); continue; }
    // Saved engine summaries use single newlines and explicit colon headings.
    // Display those existing boundaries; never generate an interpretation.
    for (const line of paragraph.split("\n")) {
      const heading = /^\s*([^:\n]{1,70}:)\s*$/.exec(line);
      const field = /^\s*([A-Z][A-Z_]{2,50}:)\s+(.+)$/.exec(line);
      if (heading || field) sections.push({ heading: (heading ?? field)![1]!, content: field?.[2] ?? "" });
      else if (line.trim()) sections.push({ heading: null, content: line });
    }
  }
  return sections;
}
