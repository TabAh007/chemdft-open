import type { AIMessageView } from "@chemdft/schemas";

export type LatestEvidenceSelection = { answer: AIMessageView; question: string };

/** Persisted conversation history does not imply an answer is applicable to this view. */
export function messagesForContext(all: AIMessageView[], start: number | undefined) {
  return start === undefined ? { messages: [], history: all } : { messages: all.slice(start), history: all.slice(0, start) };
}

export function latestEvidenceSelection(messages: AIMessageView[]): LatestEvidenceSelection | null {
  const latest = [...messages].reverse().find((item) => item.role === "user" || item.role === "assistant");
  if (latest?.role !== "assistant" || !latest.evidence_status) return null;

  const answerIndex = messages.findIndex((item) => item.id === latest.id);
  const question = answerIndex > 0
    ? messages.slice(0, answerIndex).reverse().find((item) => item.role === "user")?.content ?? ""
    : "";
  return { answer: latest, question };
}
