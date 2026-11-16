"use client";

import { useEffect, useState } from "react";
import type { AICitation, AIMessageView } from "@chemdft/schemas";
import { AppIcon } from "@chemdft/ui";
import { useWorkspaceState } from "@/app/_components/workspace-state-provider";

type EvidenceSelection = { answer: AIMessageView; question: string };

export function EvidenceWorkspacePanel({ projectId }: { projectId: string }) {
  const { catalog, openSelection } = useWorkspaceState();
  const [selection, setSelection] = useState<EvidenceSelection | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const key = `chemdft:evidence-selection:${projectId}`;
    queueMicrotask(() => setSelectedId(localStorage.getItem(key)));
    queueMicrotask(() => setExpanded(localStorage.getItem(`chemdft:evidence-open:${projectId}`) === "true"));
    function update(event: Event) {
      const next = (event as CustomEvent<EvidenceSelection | null>).detail;
      setSelection(next);
      if (next?.answer.evidence_status) {
        setSelectedId(null);
        localStorage.removeItem(key);
        setExpanded(false);
        localStorage.setItem(`chemdft:evidence-open:${projectId}`, "false");
      } else {
        setExpanded(false);
        localStorage.setItem(`chemdft:evidence-open:${projectId}`, "false");
      }
    }
    function focus(event: Event) {
      const citation = (event as CustomEvent<AICitation>).detail;
      if (citation.citation_id) {
        setSelectedId(citation.citation_id);
        localStorage.setItem(key, citation.citation_id);
        setExpanded(true);
        localStorage.setItem(`chemdft:evidence-open:${projectId}`, "true");
        window.setTimeout(() => document.getElementById(`evidence-${citation.citation_id}`)?.scrollIntoView({ block: "nearest" }), 0);
      }
    }
    window.addEventListener("chemdft:evidence-message", update);
    window.addEventListener("chemdft:citation-click", focus);
    return () => {
      window.removeEventListener("chemdft:evidence-message", update);
      window.removeEventListener("chemdft:citation-click", focus);
    };
  }, [projectId]);

  const answer = selection?.answer;
  const evidence = answer?.evidence ?? [];
  const status = answer?.evidence_status;

  // Release 0.0.57 Part 4: Show Evidence desk bar only when it contains something (an answer with evidence/citations).
  if (!answer || (evidence.length === 0 && (!answer.citations || answer.citations.length === 0))) {
    return null;
  }
  function openSource(citationId: string) {
    const citation = answer?.citations?.find((item) => item.citation_id === citationId);
    if (citation) {
      setSelectedId(citationId);
      localStorage.setItem(`chemdft:evidence-selection:${projectId}`, citationId);
      if (citation.citation_type === "DOCUMENT") {
        const item = catalog.find((entry) => entry.selection.kind === "document" && entry.selection.id === citation.entity_id);
        openSelection({ kind: "document", id: citation.entity_id, projectId,
          ...(citation.page_number ? { locator: { page: citation.page_number,
            ...(citation.source_anchor_id ? { anchorId: citation.source_anchor_id } : {}) } } : {}) }, item?.label ?? citation.label);
      } else {
        const item = catalog.find((entry) => entry.selection.id === citation.entity_id ||
          ("sourceId" in entry.selection && entry.selection.sourceId === citation.entity_id));
        if (item) openSelection(item.selection, item.label);
      }
      window.dispatchEvent(new CustomEvent("chemdft:citation-click", { detail: citation }));
      window.setTimeout(() => document.getElementById("workspace-pdf-canvas")?.scrollIntoView({ block: "center" }), 0);
    }
  }
  return <section className={`workspace-evidence ${expanded ? "expanded" : "collapsed"}`} aria-label="AI evidence" data-testid="workspace-evidence" data-has-answer={answer ? "true" : "false"}>
    <div className="workspace-evidence-heading">
      <button type="button" className="evidence-toggle" aria-expanded={expanded} onClick={() => {
        setExpanded((value) => { localStorage.setItem(`chemdft:evidence-open:${projectId}`, String(!value)); return !value; });
      }}><strong>Evidence desk</strong><span>{expanded ? "Collapse" : "Expand"}</span></button>
      {expanded ? <span className={`evidence-status evidence-status-${status?.toLowerCase().replaceAll("_", "-") ?? "idle"}`} data-testid="evidence-status">
        {status?.replaceAll("_", " ") ?? "READY"}
      </span> : <span className="evidence-compact-label">{answer ? `Answer · ${status ? sentenceCase(status) : "Ready"} · ${answer.citations?.length ?? 0} ${answer.citations?.length === 1 ? "source" : "sources"}` : "No answer selected"}</span>}
    </div>
    {expanded ? (!answer ? <p className="workspace-evidence-empty">Ask AI Scientist a question with evidence to inspect cited project sources here.</p> : <>
      <p className="workspace-evidence-question"><strong>Answer to</strong> {selection.question}</p>
      {answer.evidence_note ? <p className="workspace-evidence-note">{answer.evidence_note}</p> : null}
      {evidence.length === 0 && !answer.citations?.some((citation) => citation.citation_type !== "DOCUMENT") ? <p className="workspace-evidence-empty" data-testid="evidence-empty">No supporting project passage is available. Add a relevant document or project result, then ask again.</p> : null}
      {evidence.length > 0 ?
        <div className="workspace-evidence-grid">{evidence.map((item) => {
          const cited = answer.citations?.some((citation) => citation.citation_id === item.citation_id);
          return <article id={`evidence-${item.citation_id}`} key={item.citation_id}
            className={`evidence-card ${selectedId === item.citation_id ? "selected" : ""}`} data-testid="evidence-card">
            <div className="evidence-card-top"><span className="evidence-id">{item.citation_id}</span><strong title={item.source_title}>{item.source_title}</strong>
              <span className="evidence-card-locator">{item.page_number ? `p. ${item.page_number}` : item.section_path ?? "Project record"}</span></div>
            {item.available === false ? <p className="evidence-passage">Source passage is no longer available.</p> : <>
              <p className="evidence-passage evidence-excerpt">{answer.citations?.find((citation) => citation.citation_id === item.citation_id)?.reference_text ?? item.passage.slice(0, 360)}</p>
              {item.passage.length > 360 ? <details className="evidence-full-passage"><summary>Expand full passage</summary><p className="evidence-passage">{item.passage}</p></details> : null}
            </>}
            <div className="evidence-card-meta"><span>{item.source_type.replaceAll("_", " ")}</span><span>{item.source_class ?? "Source metadata"}</span>
              {item.verification_state ? <span>{item.verification_state.replaceAll("_", " ")}</span> : null}
              {item.paragraph_ordinal ? <span>¶ {item.paragraph_ordinal}</span> : null}</div>
            <div className="evidence-card-actions"><span>{cited ? "Cited in answer" : "Retrieved context"}</span>
              {cited && item.document_id && item.available !== false ? <button type="button" onClick={() => openSource(item.citation_id)} data-testid="evidence-open-source"><AppIcon icon="document" /> Open source</button> : null}</div>
          </article>;
        })}</div> : null}
      {answer.citations?.filter((citation) => citation.citation_type !== "DOCUMENT").map((citation) => <article
        className={`evidence-card evidence-project-record ${selectedId === citation.citation_id ? "selected" : ""}`} key={citation.citation_id ?? citation.entity_id}
        data-testid="evidence-project-record" id={`evidence-${citation.citation_id}`}>
        <div className="evidence-card-top"><span className="evidence-id">{citation.citation_id ?? "P"}</span>
          <strong title={citation.label}>{citation.label}</strong><span className="evidence-card-locator">{citation.citation_type.replaceAll("_", " ")} · Project record</span></div>
        <p className="evidence-passage">{citation.reference_text?.slice(0, 180)}</p>{(citation.reference_text?.length ?? 0) > 180 ? <details><summary>Full record reference</summary><p className="evidence-passage">{citation.reference_text}</p></details> : null}
        <div className="evidence-card-meta"><span>PROJECT RECORD</span><span>Saved ChemDFT state</span></div>
        <div className="evidence-card-actions"><span>Cited in answer</span>
          <button type="button" onClick={() => openSource(citation.citation_id ?? "")} data-testid="evidence-open-project-record">
            <AppIcon icon={citation.citation_type === "DATASET" ? "timeline-events" : citation.citation_type === "CALCULATION" ? "application" : "cube"} /> Inspect record</button>
        </div>
      </article>)}
    </>) : null}
  </section>;
}

function sentenceCase(code: string): string {
  const text = code.toLowerCase().replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
