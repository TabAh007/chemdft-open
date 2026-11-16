"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalculationComparisonOutput, OverviewRow, SavedComparisonListOutput } from "@chemdft/schemas";
import { compareCalculations } from "./analysis-api";
import {
  itemFromRow, locationSearch, makeReference, needsPayload, parseLocation, sameSelection, thermoConditionsOf, toggleResult, vibrationalModesOf,
  MIN_SELECTION, type CompareItem, type StoredModes, type ThermoConditions,
} from "./compare-model";
import { getResult } from "./structure-workspace-api";
import { listPublishedResults, listSavedComparisons } from "./workflows-api";

/**
 * Selection of the Compare workstation. The ordered list of result ids IS the comparison (the first is the
 * reference) and it lives in the URL (`?result=a&result=b`, or `?saved=id` for a saved comparison), so reload, history
 * and shared links reproduce it. A selection change is a history entry; back and forward restore it. The latest list
 * is kept in a ref so two clicks in the same frame both land.
 */
export type SelectionApi = {
  ready: boolean;
  ids: readonly string[];
  /** The saved comparison named by the URL, if the selection has not been edited since opening it. */
  savedId: string | null;
  atLimit: boolean;
  /** Increases with every location read (load, back, forward), so a repeated saved id is still a new request. */
  revision: number;
  toggle: (resultId: string) => void;
  remove: (resultId: string) => void;
  setReference: (resultId: string) => void;
  clear: () => void;
  /** Navigate to a saved comparison (`?saved=id`); its members are adopted once the server has revalidated it. */
  openSaved: (savedId: string) => void;
  /** Replace the selection without making a history entry (opening a saved comparison fills it in). */
  adopt: (ids: readonly string[]) => void;
};

export function useCompareSelection(): SelectionApi {
  const [state, setState] = useState<{ ready: boolean; ids: string[]; savedId: string | null; atLimit: boolean; revision: number }>({ ready: false, ids: [], savedId: null, atLimit: false, revision: 0 });
  const latest = useRef<string[]>([]);

  useEffect(() => {
    const read = () => {
      const parsed = parseLocation(window.location.search);
      latest.current = parsed.ids;
      setState((current) => ({ ready: true, ids: parsed.ids, savedId: parsed.savedId, atLimit: false, revision: current.revision + 1 }));
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const commit = useCallback((ids: string[], atLimit = false) => {
    if (sameSelection(ids, latest.current)) { setState((current) => ({ ...current, atLimit })); return; }
    latest.current = ids;
    // Opening a saved comparison does not keep `?saved=` once the selection is edited.
    window.history.pushState(null, "", `${window.location.pathname}${locationSearch(ids)}`);
    setState((current) => ({ ready: true, ids, savedId: null, atLimit, revision: current.revision }));
  }, []);

  const toggle = useCallback((resultId: string) => {
    const result = toggleResult(latest.current, resultId);
    commit(result.next, result.atLimit);
  }, [commit]);
  const remove = useCallback((resultId: string) => commit(latest.current.filter((id) => id !== resultId)), [commit]);
  const setReference = useCallback((resultId: string) => commit(makeReference(latest.current, resultId)), [commit]);
  const clear = useCallback(() => commit([]), [commit]);
  const openSaved = useCallback((savedId: string) => {
    latest.current = [];
    window.history.pushState(null, "", `${window.location.pathname}${locationSearch([], savedId)}`);
    setState((current) => ({ ready: true, ids: [], savedId, atLimit: false, revision: current.revision + 1 }));
  }, []);
  const adopt = useCallback((ids: readonly string[]) => {
    latest.current = [...ids];
    setState((current) => ({ ...current, ids: [...ids] }));
  }, []);

  return useMemo(() => ({ ready: state.ready, ids: state.ids, savedId: state.savedId, atLimit: state.atLimit, revision: state.revision, toggle, remove, setReference, clear, openSaved, adopt }), [state, toggle, remove, setReference, clear, openSaved, adopt]);
}

// ---------------------------------------------------------------------------------------------------------------

export type SelectedItems = {
  /** Resolved selected results (a stored, published result row each). */
  items: ReadonlyMap<string, CompareItem>;
  /** Ids the project does not have as published results (deleted, someone else's, or never existed). */
  unavailable: ReadonlySet<string>;
  /** Selected ids that are still being read. */
  pending: ReadonlySet<string>;
  error: string | null;
};

/**
 * Resolves every selected id to its stored result row. Rows already loaded by the library are used as they are and
 * REMEMBERED, so a selection survives filters, sorting and paging. Ids unknown to the library (a shared link, a
 * saved comparison, a later page) are read once from the project's published-results endpoint, by id; an id that
 * comes back absent is reported as unavailable and the other selections are untouched.
 */
export function useSelectedItems(projectId: string, ids: readonly string[], libraryRows: readonly OverviewRow[], enabled: boolean): SelectedItems {
  const [store, setStore] = useState<{ projectId: string; items: Map<string, CompareItem>; unavailable: Set<string>; error: string | null }>({ projectId, items: new Map(), unavailable: new Set(), error: null });
  const current = store.projectId === projectId ? store : { projectId, items: new Map<string, CompareItem>(), unavailable: new Set<string>(), error: null };
  const inflight = useRef(new Set<string>());
  const libraryById = useMemo(() => new Map(libraryRows.filter((row) => row.result_id).map((row) => [row.result_id!, row])), [libraryRows]);

  // Resolved synchronously (stored items first, then whatever the library currently shows) so a click never flickers.
  const items = useMemo(() => {
    const resolved = new Map<string, CompareItem>();
    for (const id of ids) {
      const stored = current.items.get(id);
      if (stored) { resolved.set(id, stored); continue; }
      const row = libraryById.get(id);
      if (row) resolved.set(id, itemFromRow(row));
    }
    return resolved;
  }, [ids, current.items, libraryById]);

  // Remember the selected library rows, so the selection survives filters, sorting and paging.
  useEffect(() => {
    const fresh = ids.filter((id) => libraryById.has(id) && !current.items.has(id));
    if (fresh.length === 0) return;
    queueMicrotask(() => setStore((previous) => {
      const base = previous.projectId === projectId ? previous : { projectId, items: new Map<string, CompareItem>(), unavailable: new Set<string>(), error: null };
      const next = new Map(base.items);
      for (const id of fresh) { const row = libraryById.get(id); if (row) next.set(id, itemFromRow(row)); }
      return { ...base, items: next };
    }));
  }, [ids, libraryById, projectId, current.items]);

  // Read the rest by id.
  const unknown = ids.filter((id) => !items.has(id) && !current.unavailable.has(id));
  const unknownKey = unknown.join(",");
  useEffect(() => {
    if (!enabled || unknown.length === 0) return;
    const request = unknown.filter((id) => !inflight.current.has(id));
    if (request.length === 0) return;
    request.forEach((id) => inflight.current.add(id));
    void listPublishedResults(projectId, { resultIds: request, limit: Math.max(1, request.length) })
      .then((page) => {
        const found = new Map(page.rows.filter((row) => row.result_id).map((row) => [row.result_id!, row]));
        setStore((previous) => {
          const base = previous.projectId === projectId ? previous : { projectId, items: new Map<string, CompareItem>(), unavailable: new Set<string>(), error: null };
          const nextItems = new Map(base.items), unavailable = new Set(base.unavailable);
          for (const id of request) {
            const row = found.get(id);
            if (row) nextItems.set(id, itemFromRow(row)); else unavailable.add(id);
          }
          return { ...base, items: nextItems, unavailable, error: null };
        });
      })
      .catch((cause: unknown) => setStore((previous) => ({ ...(previous.projectId === projectId ? previous : { projectId, items: new Map<string, CompareItem>(), unavailable: new Set<string>() }), error: cause instanceof Error ? cause.message : "The selected results could not be read." })))
      .finally(() => request.forEach((id) => inflight.current.delete(id)));
    // `unknown` is represented by its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, unknownKey, enabled]);

  return useMemo(() => {
    const pending = new Set(current.error === null ? unknown : []);
    return { items, unavailable: current.unavailable, pending, error: current.error };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, current.unavailable, current.error, unknownKey]);
}

// ---------------------------------------------------------------------------------------------------------------

export type ComparisonState = {
  /** The comparison answering exactly the requested ids; never an older selection's. */
  output: CalculationComparisonOutput | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
};

/** Debounce before asking, so a burst of clicks makes one request; earlier requests are aborted. */
const COMPARE_DEBOUNCE_MS = 120;

export function useComparison(projectId: string, ids: readonly string[], enabled: boolean): ComparisonState {
  const key = ids.join(",");
  const eligible = enabled && ids.length >= MIN_SELECTION;
  const [state, setState] = useState<{ key: string; output: CalculationComparisonOutput | null; error: string | null }>({ key: "", output: null, error: null });
  const [revision, setRevision] = useState(0);
  const idsRef = useRef(ids);
  useEffect(() => { idsRef.current = ids; });

  useEffect(() => {
    if (!eligible) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      compareCalculations(projectId, idsRef.current, controller.signal)
        .then((output) => { if (!controller.signal.aborted) setState({ key: `${projectId}:${key}`, output, error: null }); })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setState({ key: `${projectId}:${key}`, output: null, error: cause instanceof Error ? cause.message : "The comparison could not be made." });
        });
    }, COMPARE_DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [projectId, key, eligible, revision]);

  const answered = eligible && state.key === `${projectId}:${key}`;
  return {
    output: answered ? state.output : null,
    loading: eligible && !answered,
    error: answered ? state.error : null,
    retry: () => setRevision((value) => value + 1),
  };
}

// ---------------------------------------------------------------------------------------------------------------

export type StoredPayloads = { conditions: ReadonlyMap<string, ThermoConditions>; modes: ReadonlyMap<string, StoredModes>; loading: boolean };

/**
 * Stored thermochemical conditions and vibrational modes of the selected results, read from the stored result
 * records (read only). Only the result types whose plots and cards need them are fetched.
 */
export function useStoredPayloads(projectId: string, items: readonly CompareItem[]): StoredPayloads {
  const [store, setStore] = useState<{ projectId: string; conditions: Map<string, ThermoConditions>; modes: Map<string, StoredModes>; done: Set<string> }>({ projectId, conditions: new Map(), modes: new Map(), done: new Set() });
  const fresh = store.projectId === projectId ? store : { projectId, conditions: new Map<string, ThermoConditions>(), modes: new Map<string, StoredModes>(), done: new Set<string>() };
  const wanted = items.filter((item) => needsPayload(item.resultType) && !fresh.done.has(item.resultId));
  const wantedKey = wanted.map((item) => item.resultId).join(",");
  useEffect(() => {
    if (wanted.length === 0) return;
    let alive = true;
    for (const item of wanted) {
      void getResult(projectId, item.resultId)
        .then((result) => {
          if (!alive) return;
          setStore((previous) => {
            const base = previous.projectId === projectId ? previous : { projectId, conditions: new Map<string, ThermoConditions>(), modes: new Map<string, StoredModes>(), done: new Set<string>() };
            const conditions = new Map(base.conditions), modes = new Map(base.modes), done = new Set(base.done).add(item.resultId);
            const thermo = thermoConditionsOf(result.payload);
            if (thermo) conditions.set(item.resultId, thermo);
            const stored = item.resultType === "chemdft.vibrational-analysis" ? vibrationalModesOf(result.payload) : null;
            if (stored) modes.set(item.resultId, stored);
            return { projectId, conditions, modes, done };
          });
        })
        .catch(() => { if (alive) setStore((previous) => ({ ...previous, projectId, done: new Set(previous.done).add(item.resultId) })); });
    }
    return () => { alive = false; };
    // `wanted` is represented by its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, wantedKey]);
  return { conditions: fresh.conditions, modes: fresh.modes, loading: wanted.length > 0 };
}

// ---------------------------------------------------------------------------------------------------------------

export function useSavedComparisons(projectId: string): { list: SavedComparisonListOutput | null; reload: () => void } {
  const [state, setState] = useState<{ projectId: string; list: SavedComparisonListOutput | null }>({ projectId, list: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    void listSavedComparisons(projectId).then((list) => { if (alive) setState({ projectId, list }); }).catch(() => { if (alive) setState({ projectId, list: null }); });
    return () => { alive = false; };
  }, [projectId, revision]);
  return { list: state.projectId === projectId ? state.list : null, reload: () => setRevision((value) => value + 1) };
}
