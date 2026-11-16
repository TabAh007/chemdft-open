"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DrawResponse } from "@chemdft/schemas";

import { AiApiError, createAiConversation, getProductContext, postAiDraw } from "@/lib/ai-scientist-api";
import {
  applicableSteps, buildDrawPayload, drawFailureMessage, padMolfile, drawText, extendTrail, newTrail, prefersReducedMotion, STEP_DELAY_MS, undoAll, undoLastStep,
  type ChatTurn, type Trail,
} from "@/lib/molecule-editor/ai-draw";
import type { EditorKetcher } from "@/lib/molecule-editor/ketcher-types";
import { fitDrawing, type FitResult } from "@/lib/molecule-editor/fit-view";
import { readMolfile } from "@/lib/molecule-editor/read-molfile";
import { countMolfileAtoms } from "@/lib/molecule-editor/structure-input";

export type ChatEntry =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "pending" }
  | { id: string; kind: "notice"; tone: "error" | "info"; text: string }
  | { id: string; kind: "assistant"; response: DrawResponse; shown: number };

/** A step is applied while its position in the trail is within `pos` and still owned by that step. */
type Owner = { entry: string; step: number };
export type Draft = { trail: Trail; owners: Owner[]; edited: boolean };

export type Availability = "unknown" | "ok" | "unavailable";

export interface UseAiDraw {
  entries: ChatEntry[];
  busy: "idle" | "working" | "applying";
  availability: Availability;
  draft: Draft | null;
  appliedKeys: Set<string>;
  /** Result of the last automatic fit: "main" means the drawing was too big to show readably and only its main fragment is in view. */
  view: FitResult | null;
  /** Zoom and centre the whole drawing (`all`) or let the fit pick (`auto`). */
  fit: (scope?: "auto" | "all") => Promise<void>;
  send: (text: string) => Promise<void>;
  keep: () => void;
  undoLast: () => Promise<void>;
  undoEverything: () => Promise<void>;
}

let counter = 0;
const nextId = () => `draw-${Date.now().toString(36)}-${++counter}`;
const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export function useAiDraw(params: {
  k: EditorKetcher | null;
  projectId: string;
  onStatus: (text: string) => void;
}): UseAiDraw {
  const { k, projectId, onStatus } = params;
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [busy, setBusy] = useState<UseAiDraw["busy"]>("idle");
  const [availability, setAvailability] = useState<Availability>("unknown");
  const [draft, setDraftState] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const entriesRef = useRef<ChatEntry[]>([]);
  const busyRef = useRef(false);
  const conversationRef = useRef<string | null>(null);
  const lastBaseRef = useRef<string | null>(null);
  const loadedSmilesRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const [view, setView] = useState<FitResult | null>(null);

  const setDraft = useCallback((next: Draft | null) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);
  const setAllEntries = useCallback((next: ChatEntry[]) => {
    entriesRef.current = next;
    setEntries(next);
  }, []);
  const patchEntries = useCallback((fn: (current: ChatEntry[]) => ChatEntry[]) => setAllEntries(fn(entriesRef.current)), [setAllEntries]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Is the AI configured for this account? (the same product context the AI Scientist panel reads)
  useEffect(() => {
    let cancelled = false;
    getProductContext(projectId, {})
      .then((context) => { if (!cancelled) setAvailability(context.ai.available ? "ok" : "unavailable"); })
      .catch(() => { if (!cancelled) setAvailability("unknown"); });
    return () => { cancelled = true; };
  }, [projectId]);

  const smilesOf = useCallback(async (): Promise<string> => {
    if (!k) return "";
    try { return (await k.getSmiles()).trim(); } catch { return ""; }
  }, [k]);

  const loadDrawing = useCallback(async (molfile: string) => {
    if (!k) return;
    const padded = padMolfile(molfile);
    await k.setMolecule(padded);
    loadedSmilesRef.current = await smilesOf();
    // The server lays every drawing out compactly; fit the view to it with a readable minimum zoom.
    setView(fitDrawing(k, padded));
  }, [k, smilesOf]);

  const fit = useCallback(async (scope: "auto" | "all" = "all") => {
    if (!k) return;
    try {
      const molfile = await readMolfile(k);
      if (countMolfileAtoms(molfile) > 0) setView(fitDrawing(k, molfile, scope));
    } catch { /* the view stays as it was */ }
  }, [k]);

  // A user edit after AI steps keeps the steps but is flagged: the AI snapshots no longer contain it.
  useEffect(() => {
    if (!k?.changeEvent) return;
    let timer: number | undefined;
    const onChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const current = draftRef.current;
        if (!current || current.edited || busyRef.current) return;
        const smiles = await smilesOf();
        if (smiles !== loadedSmilesRef.current) setDraft({ ...current, edited: true });
      }, 400);
    };
    k.changeEvent.add(onChange);
    return () => { window.clearTimeout(timer); k.changeEvent?.remove?.(onChange); };
  }, [k, smilesOf, setDraft]);

  // Select the newest atoms briefly. Only ids Ketcher's struct really holds are passed on; anything else is skipped,
  // because Ketcher's wasm layer throws asynchronously (outside any try/catch) on an unknown atom id.
  const highlight = useCallback((atomNumbers: number[]) => {
    if (!k || atomNumbers.length === 0) return;
    window.setTimeout(() => {
      try {
        const atoms = k.editor.struct().atoms as unknown as { has?: (id: number) => boolean };
        const ids = atomNumbers.map((n) => n - 1).filter((id) => atoms.has?.(id) === true);
        if (ids.length === 0) return;
        k.editor.selection({ atoms: ids });
        window.setTimeout(() => { try { k.editor.selection(null); } catch { /* cosmetic */ } }, 900);
      } catch { /* highlighting is cosmetic; the drawing is already correct */ }
    }, 80);
  }, [k]);

  const applyResponse = useCallback(async (entryId: string, response: DrawResponse, baseMolfile: string) => {
    const steps = applicableSteps(response);
    if (!k || steps.length === 0) return;
    setBusy("applying");
    const startPos = draftRef.current?.trail.pos ?? 0;
    const current: Draft = startPos > 0 && draftRef.current ? draftRef.current : { trail: newTrail(baseMolfile), owners: [], edited: false };
    let draftNow: Draft = { ...current, trail: { ...current.trail, molfiles: current.trail.molfiles.slice(0, startPos + 1) }, owners: current.owners.slice(0, startPos) };
    lastBaseRef.current = baseMolfile;
    const reduced = prefersReducedMotion();
    const show = (shown: number) => patchEntries((all) => all.map((e) => (e.id === entryId && e.kind === "assistant" ? { ...e, shown } : e)));
    if (reduced) {
      await loadDrawing(steps[steps.length - 1]?.molfile ?? baseMolfile);
      draftNow = { ...draftNow, trail: extendTrail(draftNow.trail, steps), owners: [...draftNow.owners, ...steps.map((_, i) => ({ entry: entryId, step: i }))] };
      setDraft(draftNow);
      show(steps.length);
    } else {
      for (let i = 0; i < steps.length; i += 1) {
        const step = steps[i];
        if (!step || !mountedRef.current) break;
        await loadDrawing(step.molfile ?? "");
        draftNow = { ...draftNow, trail: extendTrail(draftNow.trail, [step]), owners: [...draftNow.owners, { entry: entryId, step: i }] };
        setDraft(draftNow);
        show(i + 1);
        highlight(step.new_atom_numbers ?? []);
        onStatus(`Step ${i + 1} of ${steps.length}: ${step.description}`);
        if (i < steps.length - 1) await pause(STEP_DELAY_MS);
      }
    }
    loadedSmilesRef.current = await smilesOf();
    onStatus(`${steps.length} AI step${steps.length === 1 ? "" : "s"} applied. ${drawText.schematic}`);
  }, [k, loadDrawing, highlight, onStatus, patchEntries, setDraft, smilesOf]);

  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!k || !text || busyRef.current) return;
    busyRef.current = true;
    setBusy("working");
    const userId = nextId();
    const pendingId = nextId();
    const history: ChatTurn[] = entriesRef.current.flatMap((e): ChatTurn[] =>
      e.kind === "user" ? [{ role: "user", content: e.text }] : e.kind === "assistant" ? [{ role: "assistant", content: e.response.reply }] : []);
    setAllEntries([...entriesRef.current, { id: userId, kind: "user", text }, { id: pendingId, kind: "pending" }]);
    const replacePending = (entry: ChatEntry) => patchEntries((all) => all.map((e) => (e.id === pendingId ? entry : e)));
    try {
      const molfile = await readMolfile(k);
      const hasAtoms = countMolfileAtoms(molfile) > 0;
      const smilesBefore = await smilesOf();
      if (!conversationRef.current) {
        const created = await createAiConversation(projectId, { title: "Drawing assistant" });
        conversationRef.current = created.conversation.id;
      }
      const response = await postAiDraw(
        projectId,
        conversationRef.current,
        buildDrawPayload(text, hasAtoms ? molfile : null, lastBaseRef.current, history),
      );
      setAvailability("ok");
      const unchanged = (await smilesOf()) === smilesBefore;
      const applicable = applicableSteps(response);
      if (!unchanged && applicable.length > 0) {
        replacePending({ id: pendingId, kind: "notice", tone: "info", text: drawText.changedWhileWaiting });
        return;
      }
      replacePending({ id: pendingId, kind: "assistant", response, shown: 0 });
      await applyResponse(pendingId, response, molfile);
    } catch (error) {
      const status = error instanceof AiApiError ? error.status : 0;
      if (status === 503 || (error instanceof AiApiError && error.code === "AI_UNAVAILABLE")) setAvailability("unavailable");
      replacePending({ id: pendingId, kind: "notice", tone: "error", text: drawFailureMessage(status, error instanceof Error ? error.message : null) });
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy("idle");
    }
  }, [k, projectId, applyResponse, patchEntries, setAllEntries, smilesOf]);

  const keep = useCallback(() => { setDraft(null); onStatus("AI-drafted marker cleared. The drawing is yours to edit."); }, [setDraft, onStatus]);

  const undoLast = useCallback(async () => {
    const current = draftRef.current;
    if (!k || !current || busyRef.current) return;
    const result = undoLastStep(current.trail);
    if (!result) return;
    await loadDrawing(result.molfile);
    setDraft({ ...current, trail: result.trail });
    onStatus("Undid the last AI step.");
  }, [k, loadDrawing, onStatus, setDraft]);

  const undoEverything = useCallback(async () => {
    const current = draftRef.current;
    if (!k || !current || busyRef.current) return;
    const result = undoAll(current.trail);
    await loadDrawing(result.molfile);
    setDraft(null);
    onStatus("Undid all AI steps. The drawing is as it was before the AI changed it.");
  }, [k, loadDrawing, onStatus, setDraft]);

  const appliedKeys = new Set((draft?.owners ?? []).slice(0, draft?.trail.pos ?? 0).map((o) => `${o.entry}:${o.step}`));
  return { entries, busy, availability, draft: draft && draft.trail.pos > 0 ? draft : null, appliedKeys, view, fit, send, keep, undoLast, undoEverything };
}
