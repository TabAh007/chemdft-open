"use client";
import { useState } from "react";

/** Where a run was asked: the context key and label it was given under. */
export type AiContextOrigin = { key: string; label: string };

/**
 * Per-context conversation bookkeeping for the AI Scientist panel (memory only, never persisted):
 * where each context's thread starts, the unsent draft of each context, and where each run was asked.
 */
export function useAiConversationState(contextKey: string) {
  const [turnStarts, setTurnStarts] = useState<Record<string, number>>({});
  // Drafts belong to their context: leaving a page and coming back restores what was typed there (memory only).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const prompt = drafts[contextKey] ?? "";
  const setPrompt = (value: string) => setDrafts((old) => ({ ...old, [contextKey]: value }));
  // Where each run was asked, so a run or approval that outlives a page change is labelled with its own context.
  const [runOrigins, setRunOrigins] = useState<Record<string, AiContextOrigin>>({});
  const [submitOrigin, setSubmitOrigin] = useState<AiContextOrigin | null>(null);
  return { turnStarts, setTurnStarts, prompt, setPrompt, runOrigins, setRunOrigins, submitOrigin, setSubmitOrigin };
}
