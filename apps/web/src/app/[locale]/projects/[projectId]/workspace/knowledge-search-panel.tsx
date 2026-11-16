"use client";

import { useEffect, useState } from "react";

import type { KnowledgeRetrievalResult } from "@chemdft/schemas";
import { ActionButton, Hint, StatusTag } from "@chemdft/ui";

import { getKnowledgeStatus, searchKnowledge } from "@/lib/knowledge-api";

export function KnowledgeSearchPanel({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeRetrievalResult[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [indexStatus, setIndexStatus] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      try {
        const status = await getKnowledgeStatus(projectId);
        if (stopped) return;
        setIndexStatus(status.status);
        if (status.status === "PENDING" || status.status === "INDEXING") {
          timer = setTimeout(() => void refresh(), 1000);
        }
      } catch {
        if (!stopped) setIndexStatus(null);
      }
    }
    void refresh();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectId]);

  async function submit() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setBusy(true);
    setMessage(null);
    try {
      const output = await searchKnowledge(projectId, {
        schema_version: "1.0.0",
        query: trimmed,
        filters: { source_types: [], source_classes: [] },
        limit: 8,
      });
      const nextResults = output.results ?? [];
      setResults([...nextResults]);
      if (nextResults.length === 0) setMessage("No indexed project sources matched this query.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Knowledge search failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspace-card knowledge-search-card" aria-label="Project knowledge search">
      <div className="knowledge-search-compact-row" data-testid="knowledge-search-compact">
        <div className="knowledge-search-heading">
          <Hint content="Searches only this project and returns source-bound snippets. Retrieval is context, not scientific authority.">
            <h3 className="knowledge-search-title">Project knowledge</h3>
          </Hint>
          <div className="knowledge-status-tags">
            <StatusTag intent="none">Source-bound</StatusTag>
            {indexStatus ? <span data-testid="knowledge-index-status"><StatusTag intent="none">Index {indexStatus.toLowerCase()}</StatusTag></span> : null}
          </div>
        </div>
        <div className="workspace-inline-form knowledge-search-form">
          <input
            aria-label="Search project knowledge"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void submit(); }}
            placeholder="Search documents, evidence, calculations, datasets…"
          />
          <ActionButton onClick={() => void submit()} disabled={busy || !query.trim()}>
            {busy ? "Searching…" : "Search"}
          </ActionButton>
        </div>
      </div>
      {message ? <p className="workspace-muted">{message}</p> : null}
      {results.length > 0 ? (
        <div className="knowledge-results">
          {results.map((result) => (
            <article key={result.knowledge_chunk_id} className="knowledge-result">
              <div className="knowledge-result-meta">
                <StatusTag intent="none">{result.citation_type}</StatusTag>
                {result.source_class ? <StatusTag intent="none">{result.source_class}</StatusTag> : null}
                {result.page_number ? <span>p. {result.page_number}</span> : null}
              </div>
              <p>{result.content}</p>
              <small>Relevance {result.combined_score.toFixed(2)} · {result.verification_state ?? "unverified"}</small>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
