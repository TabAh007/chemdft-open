"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OverviewRow, PublishedResultsPage } from "@chemdft/schemas";
import { listPublishedResults, type PublishedResultsQuery } from "./workflows-api";

export const RESULTS_PAGE_SIZE = 100;

export type PublishedResultsState = {
  /** Rows loaded so far, in the server's order (pages appended, never re-sorted in the browser). */
  rows: OverviewRow[];
  /** The newest page response: every count, the facets and the saved-comparison list come from here. */
  page: PublishedResultsPage | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
};

/**
 * Reads the project's published results page by page from the server. Filtering, sorting and counting are the
 * server's; a change of query starts again from the first page, a response for an older query is discarded, and
 * "more" follows the server's keyset cursor so rows are neither repeated nor skipped.
 */
export function usePublishedResults(projectId: string, query: Omit<PublishedResultsQuery, "cursor" | "limit">): PublishedResultsState {
  const key = JSON.stringify([projectId, query.task, query.engine, query.standing, query.text, query.sort, query.direction]);
  const [state, setState] = useState<{ key: string; rows: OverviewRow[]; page: PublishedResultsPage | null; error: string | null; loadingMore: boolean }>({ key: "", rows: [], page: null, error: null, loadingMore: false });
  const [revision, setRevision] = useState(0);
  const latest = useRef(0);
  const queryRef = useRef(query);
  useEffect(() => { queryRef.current = query; });

  useEffect(() => {
    const mine = ++latest.current;
    void listPublishedResults(projectId, { ...queryRef.current, limit: RESULTS_PAGE_SIZE })
      .then((page) => { if (mine === latest.current) setState({ key, rows: [...page.rows], page, error: null, loadingMore: false }); })
      .catch((cause: unknown) => { if (mine === latest.current) setState({ key, rows: [], page: null, error: cause instanceof Error ? cause.message : "Results could not be loaded.", loadingMore: false }); });
  }, [key, projectId, revision]);

  const cursor = state.key === key ? state.page?.next_cursor ?? null : null;
  const loadMore = useCallback(() => {
    if (!cursor) return;
    const mine = ++latest.current;
    setState((current) => ({ ...current, loadingMore: true }));
    void listPublishedResults(projectId, { ...queryRef.current, cursor, limit: RESULTS_PAGE_SIZE })
      .then((page) => { if (mine === latest.current) setState((current) => ({ ...current, rows: [...current.rows, ...page.rows.filter((row) => !current.rows.some((existing) => existing.result_id === row.result_id))], page, error: null, loadingMore: false })); })
      .catch((cause: unknown) => { if (mine === latest.current) setState((current) => ({ ...current, error: cause instanceof Error ? cause.message : "More results could not be loaded.", loadingMore: false })); });
  }, [cursor, projectId]);

  const current = state.key === key;
  return {
    rows: current ? state.rows : [],
    page: state.page, // counts stay on screen while a new query loads
    loading: !current,
    loadingMore: current && state.loadingMore,
    error: current ? state.error : null,
    hasMore: Boolean(cursor),
    loadMore,
    reload: () => setRevision((value) => value + 1),
  };
}
