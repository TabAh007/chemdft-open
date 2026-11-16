import type { ResolvedAiContext } from "@/lib/ai-context";

const GROUNDING_COPY = {
  named: { badge: "Named, not grounded", title: "The assistant is told which page this is, but it is not given the data shown here. Answers cannot cite it." },
  partial: { badge: "Named, partly grounded", title: "The assistant can read this item's source document. The item itself is only named." },
} as const;

/**
 * How much of the current context the server can ground an answer in. One quiet line inside the status bar, only on pages
 * where the answer is limited (read-only, named, partly grounded); grounded and project contexts add nothing.
 */
export function AiContextTags({ context }: { context: ResolvedAiContext }) {
  const copy = context.grounding === "named" || context.grounding === "partial" ? GROUNDING_COPY[context.grounding] : null;
  if (!copy && !context.readOnly) return null;
  return (
    <p className="ai-status-note ai-context-tags" data-testid="ai-context-tags">
      {context.readOnly ? <span className="ai-context-tag" data-testid="ai-context-readonly">Read-only</span> : null}
      {copy ? <span className="ai-context-tag is-notice" title={copy.title} data-testid="ai-context-grounding">{copy.badge}</span> : null}
    </p>
  );
}

/** A run or approval started under another context is still going; its answer stays with that context. */
export function AiContextSwitchNotice({ origin, current }: { origin: { label: string }; current: string }) {
  return (
    <p className="ai-context-switch-notice" role="status" data-testid="ai-context-switch-notice">
      A request made under “{origin.label}” is still in progress. Its answer will appear under that context, not under “{current}”.
    </p>
  );
}
