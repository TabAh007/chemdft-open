"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ProductSelection } from "@chemdft/schemas";
import { aiWorkspaceSelection } from "./ai-workspace-context";
import { selectionKey, type WorkspaceSelection } from "./workspace-selection";

/**
 * The shared AI context contract. Every project page that is not the Workspace says what it is showing by calling
 * `useAiPageContext`; the entry is removed when the page unmounts. The dock reads the one published entry (or the
 * project default) and the AI Scientist keeps one conversation thread per `key`, so an answer is never shown under a
 * context it was not given for. Ids here are navigation hints only: the server resolves authority.
 */
export type ProjectSectionName = "overview" | "settings" | "results" | "jobs" | "claims" | "paper-vs-chemdft";

export type AiPageContext =
  /** A page with no AI-relevant selection: the project-level thread. */
  | { page: "project"; section: ProjectSectionName; label: string }
  /** The Workspace route (and any unregistered route), bridged from the Workspace selection and its events. */
  | { page: "workspace"; label: string; selection: WorkspaceSelection | null }
  /** The Result inspector: one stored calculation result. */
  | { page: "result"; label: string; selection: Extract<WorkspaceSelection, { sourceId: string }> }
  /** Jobs: the selected compute job. The server reads its stored record (status, method, structure); never logs. */
  | { page: "job"; label: string; jobId: string }
  /** Claims: the selected claim; the server reads the stored claim (value, unit, authority, review state). */
  | { page: "claim"; label: string; claimId: string; sourceDocumentId?: string | undefined }
  /** Compare: the compared result ids (at most 8), read-only; the server reads their stored values. */
  | { page: "compare"; label: string; resultIds: readonly string[]; letters: readonly string[]; referenceLabel: string | null; readOnly: true }
  /** Paper vs ChemDFT: the selected comparison row, read-only, with the paper claim and the calculated results it pairs. */
  | { page: "paper-vs-chemdft"; label: string; rowId: string | null; readOnly: true; claimId?: string | undefined; resultIds?: readonly string[] | undefined };

/** What the server can ground the answer in. "named" and "partial" must be badged in the panel. */
export type AiGrounding = "grounded" | "partial" | "named" | "project";

export type ResolvedAiContext = {
  page: AiPageContext["page"];
  /** The conversation thread: one per context, stable for the same subject. */
  key: string;
  /** Short label for the chip and empty state (without the project name). */
  label: string;
  /** The `current_view` sent to the server. */
  viewLabel: string;
  grounding: AiGrounding;
  readOnly: boolean;
  /** Only set for Workspace and Result contexts; used by the consistency checks in `associatedAiContext`. */
  selection: WorkspaceSelection | null;
  hints: ProductSelection;
  emptyTitle: string;
  emptyBody: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function view(projectName: string, label: string): string {
  return `${projectName} → ${label}`.slice(0, 500);
}

const MAX_COMPARED = 8;

/** Only well-formed ids are sent; the server then decides whether each belongs to the project. */
function validIds(ids: readonly string[] | undefined): string[] {
  return [...new Set((ids ?? []).filter((id) => uuid.test(id)))].slice(0, MAX_COMPARED);
}

/** Pure mapping from a page context to the thread key, the view text and the ProductSelection hints. */
export function resolveAiContext(projectId: string, projectName: string, context: AiPageContext): ResolvedAiContext {
  switch (context.page) {
    case "workspace":
    case "result": {
      const selection = context.selection;
      const valid = selection?.projectId === projectId ? selection : null;
      return {
        page: context.page, key: valid ? selectionKey(valid) : "project", label: context.label, viewLabel: context.label,
        grounding: valid ? "grounded" : "project", readOnly: false, selection: valid,
        hints: aiWorkspaceSelection(projectId, valid, context.label),
        emptyTitle: valid ? "Ask about this record" : "Ask about this project",
        emptyBody: valid ? `Ask about ${context.label}, its source or scientific authority.` : "Ask about this project or describe a scientific task.",
      };
    }
    case "job": {
      const viewLabel = view(projectName, context.label);
      const jobId = uuid.test(context.jobId) ? context.jobId : undefined;
      return {
        page: "job", key: `job:${context.jobId}`, label: context.label, viewLabel, grounding: jobId ? "grounded" : "named", readOnly: false, selection: null,
        hints: { current_view: viewLabel, ...(jobId ? { selected_job_id: jobId } : {}) },
        emptyTitle: "Ask about this job",
        emptyBody: "The assistant reads this job's saved record (status, method, structure). It does not see logs.",
      };
    }
    case "claim": {
      const viewLabel = view(projectName, context.label);
      // The claim id, not its source document: a claim projected from a result or dataset has no document in this project.
      const claimId = uuid.test(context.claimId) ? context.claimId : undefined;
      return {
        page: "claim", key: `claim:${context.claimId}`, label: context.label, viewLabel, grounding: claimId ? "grounded" : "named", readOnly: false, selection: null,
        hints: { current_view: viewLabel, ...(claimId ? { selected_claim_id: claimId } : {}) },
        emptyTitle: "Ask about this claim",
        emptyBody: claimId
          ? "The assistant reads this claim's saved record (value, unit, source, review state). Anything not saved there, it will say so."
          : "The assistant knows which claim you are viewing by name only. It is not given the claim's data.",
      };
    }
    case "compare": {
      const compared = context.letters.length ? ` (${context.letters.join(", ")}${context.referenceLabel ? `; reference ${context.referenceLabel}` : ""})` : "";
      const viewLabel = view(projectName, `${context.label}${compared}`);
      const comparedIds = validIds(context.resultIds) as NonNullable<ProductSelection["compared_result_ids"]>;
      return {
        page: "compare", key: `compare:${[...context.resultIds].sort().join(",") || "none"}`, label: context.label, viewLabel, grounding: comparedIds.length ? "grounded" : "named", readOnly: true, selection: null,
        hints: { current_view: viewLabel, ...(comparedIds.length ? { compared_result_ids: comparedIds } : {}) },
        emptyTitle: "Ask about this comparison",
        emptyBody: "Read-only. The assistant reads the saved values of the compared results; it does not compute anything.",
      };
    }
    case "paper-vs-chemdft": {
      const viewLabel = view(projectName, context.label);
      const claimId = context.claimId && uuid.test(context.claimId) ? context.claimId : undefined;
      const resultIds = validIds(context.resultIds) as NonNullable<ProductSelection["compared_result_ids"]>;
      const grounded = Boolean(claimId) || resultIds.length > 0;
      return {
        page: "paper-vs-chemdft", key: `paper:${context.rowId ?? "none"}`, label: context.label, viewLabel, grounding: grounded ? "grounded" : "named", readOnly: true, selection: null,
        hints: { current_view: viewLabel, ...(claimId ? { selected_claim_id: claimId } : {}), ...(resultIds.length ? { compared_result_ids: resultIds } : {}) },
        emptyTitle: "Ask about this comparison row",
        emptyBody: grounded
          ? "Read-only. The assistant reads the saved paper claim and calculated values of this row; it does not decide agreement."
          : "Read-only. The assistant knows which page you are on by name only; it is not given the compared values.",
      };
    }
    default: {
      const viewLabel = view(projectName, context.label);
      return {
        page: "project", key: "project", label: context.label, viewLabel, grounding: "project", readOnly: false, selection: null,
        hints: { current_view: viewLabel },
        emptyTitle: "Ask about this project",
        emptyBody: "Ask about this project or describe a scientific task.",
      };
    }
  }
}

type Entry = { owner: symbol; projectId: string; context: AiPageContext };
type Api = { entry: Entry | null; publish: (entry: Entry) => void; clear: (owner: symbol) => void };

const AiContextStore = createContext<Api | null>(null);

export function AiContextProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const publish = useCallback((next: Entry) => setEntry(next), []);
  // Only the page that published an entry may clear it, so a page that unmounts late never wipes its successor.
  const clear = useCallback((owner: symbol) => setEntry((current) => (current?.owner === owner ? null : current)), []);
  const api = useMemo<Api>(() => ({ entry, publish, clear }), [entry, publish, clear]);
  return <AiContextStore.Provider value={api}>{children}</AiContextStore.Provider>;
}

/** Publish what this page is showing; cleared automatically on unmount. `null` publishes nothing. No provider: no-op. */
export function useAiPageContext(projectId: string, context: AiPageContext | null): void {
  const api = useContext(AiContextStore);
  const [owner] = useState(() => Symbol("ai-page-context"));
  const publish = api?.publish;
  const clear = api?.clear;
  const serialized = JSON.stringify(context);
  useEffect(() => {
    if (!publish || !clear) return;
    const value = JSON.parse(serialized) as AiPageContext | null;
    if (value) publish({ owner, projectId, context: value });
    return () => clear(owner);
  }, [publish, clear, owner, projectId, serialized]);
}

/** The context the current page published for this project, or null (then the dock decides the default). */
export function usePublishedAiContext(projectId: string): AiPageContext | null {
  const entry = useContext(AiContextStore)?.entry;
  return entry && entry.projectId === projectId ? entry.context : null;
}
