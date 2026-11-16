// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useLocale: () => "en" }));

import { MessageBubble } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-messages";

describe("safe AI message markdown rendering (0.0.28)", () => {
  it("renders **bold** as <strong> without raw asterisks", () => {
    const html = renderToStaticMarkup(
      createElement(MessageBubble, {
        message: {
          id: "m1",
          conversation_id: "conv-1",
          role: "assistant",
          content: "The **Total Energy** is -76.0123 Eh.",
          created_at: new Date().toISOString(),
          citations: [],
        },
      }),
    );
    expect(html).toContain("<strong>Total Energy</strong>");
    expect(html).not.toContain("**Total Energy**");
  });

  it("renders ***bold-italic*** as <strong><em> without raw asterisks", () => {
    const html = renderToStaticMarkup(
      createElement(MessageBubble, {
        message: {
          id: "m2",
          conversation_id: "conv-1",
          role: "assistant",
          content: "Geometry has ***converged*** successfully.",
          created_at: new Date().toISOString(),
          citations: [],
        },
      }),
    );
    expect(html).toContain("<strong><em>converged</em></strong>");
    expect(html).not.toContain("***converged***");
  });

  it("renders inline `code` as <code> tags", () => {
    const html = renderToStaticMarkup(
      createElement(MessageBubble, {
        message: {
          id: "m3",
          conversation_id: "conv-1",
          role: "assistant",
          content: "Run calculation with `hf/sto-3g` or `b3lyp/def2-svp`.",
          created_at: new Date().toISOString(),
          citations: [],
        },
      }),
    );
    expect(html).toContain("<code>hf/sto-3g</code>");
    expect(html).toContain("<code>b3lyp/def2-svp</code>");
    expect(html).not.toContain("`hf/sto-3g`");
  });

  it("renders bullet lists safely with <ul> and <li>", () => {
    const html = renderToStaticMarkup(
      createElement(MessageBubble, {
        message: {
          id: "m4",
          conversation_id: "conv-1",
          role: "assistant",
          content: "- Water V1 is optimized\n- Zero-point vibrational energy is calculated",
          created_at: new Date().toISOString(),
          citations: [],
        },
      }),
    );
    expect(html).toContain("<ul");
    expect(html).toContain("<li>Water V1 is optimized</li>");
    expect(html).toContain("<li>Zero-point vibrational energy is calculated</li>");
  });

  it("never executes or injects raw HTML (XSS prevention)", () => {
    const html = renderToStaticMarkup(
      createElement(MessageBubble, {
        message: {
          id: "m5",
          conversation_id: "conv-1",
          role: "assistant",
          content: '<script>alert("xss")</script><img src="x" onerror="evil()" />',
          created_at: new Date().toISOString(),
          citations: [],
        },
      }),
    );
    // Raw tags must be HTML-escaped by React
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
  });

  it("preserves evidence citations while rendering surrounding markdown", () => {
    const html = renderToStaticMarkup(
      createElement(MessageBubble, {
        message: {
          id: "m6",
          conversation_id: "conv-1",
          role: "assistant",
          content: "Computed with Restricted **HF/STO-3G** [P1].",
          created_at: new Date().toISOString(),
          evidence_status: "SUPPORTED",
          citations: [
            {
              citation_id: "P1",
              citation_type: "CALCULATION",
              entity_id: "c1",
              label: "HF/STO-3G",
              reference_text: "HF/STO-3G calculation",
            },
          ],
        },
      }),
    );
    expect(html).toContain("<strong>HF/STO-3G</strong>");
    expect(html).toContain('data-testid="inline-evidence-citation"');
    expect(html).toContain("[P1]");
  });
});

