import { describe, expect, it } from "vitest";
import type { AIMessageView } from "@chemdft/schemas";
import { latestEvidenceSelection, messagesForContext } from "../src/lib/ai-evidence-selection";

function message(id: string, role: "user" | "assistant", content: string, evidenceStatus?: string) {
  return {
    id,
    role,
    content,
    ...(evidenceStatus ? { evidence_status: evidenceStatus } : {}),
  } as AIMessageView;
}

describe("latest Evidence Desk answer", () => {
  it("keeps saved answers in history until a question is asked in this view or history is explicitly inspected", () => {
    const saved = [message("q", "user", "Other field question"), message("a", "assistant", "Other field answer", "SUPPORTED")];
    const idle=messagesForContext(saved, undefined);
    expect(idle.messages).toEqual([]);
    expect(latestEvidenceSelection(idle.messages)).toBeNull();
    expect(idle.history).toEqual(saved);
    const active=messagesForContext([...saved,message("q2","user","Open structure?"),message("a2","assistant","0 authoritative bonds","SUPPORTED")],2);
    expect(latestEvidenceSelection(active.messages)?.question).toBe("Open structure?");
    expect(active.history).toEqual(saved);
    expect(latestEvidenceSelection(idle.history)?.question).toBe("Other field question");
  });
  it("selects the newest successful answer and its immediately preceding question", () => {
    const history = [
      message("old-question", "user", "Old question"),
      message("old-answer", "assistant", "Saved evidence is no longer available", "INSUFFICIENT_EVIDENCE"),
      message("new-question", "user", "Is the structure shown in Figure 2 authoritative?"),
      message("new-answer", "assistant", "Hypothetical figure; no committed version", "SUPPORTED"),
    ];

    expect(latestEvidenceSelection(history)).toEqual({
      answer: history[3],
      question: "Is the structure shown in Figure 2 authoritative?",
    });
    expect(history).toHaveLength(4);
    expect(history[1]?.content).toBe("Saved evidence is no longer available");
  });

  it("does not focus an older answer while the newest question is still pending", () => {
    const history = [
      message("old-question", "user", "Old question"),
      message("old-answer", "assistant", "Old response", "SUPPORTED"),
      message("new-question", "user", "New question"),
    ];

    expect(latestEvidenceSelection(history)).toBeNull();
  });
});
