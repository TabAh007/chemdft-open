// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProductContext } from "@chemdft/schemas";
import { AIScientistStatusBar } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-status-bar";

vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
if (typeof window !== "undefined") {
  window.matchMedia = window.matchMedia || (() => ({
    matches: false,
    media: "",
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as typeof window.matchMedia);
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AIScientistStatusBar F3 honesty and model resolution", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const baseProps = {
    viewLabel: "Overview",
    candidateContext: false,
    showFollowAi: false,
    followAiMode: true,
    onFollowAiModeChange: () => {},
    projectId: "p",
    onConfigure: () => {},
    settingsView: null,
    activeRunModel: null,
    runInFlight: false,
    approvalPending: false,
    onModelSaved: () => {},
  };

  const sampleContext = {
    project_id: "p",
    project_name: "Project",
    selection: { selected_structure_version_id: null, selected_result_id: null, current_view: "overview" },
    can_write: true,
    sealed: false,
    resources: [],
    allowed_tools: [],
    ai: {
      available: true,
      mode: "MANAGED",
      provider: "nvidia",
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      error_code: null,
      local_test_only: false,
    },
  } as unknown as ProductContext;

  it("slow-but-succeeds never shows unavailable: shows Resolving model initially, Still checking after 4s, and resolves model without ever flashing unavailable", () => {
    act(() => {
      root.render(
        createElement(AIScientistStatusBar, {
          ...baseProps,
          productContext: null,
          capability: null,
          contextError: null,
          requestKey: "key-1",
        }),
      );
    });

    // 0s: initial check
    expect(container.textContent).toContain("Resolving model…");
    expect(container.textContent).toContain("Checking availability…");
    expect(container.textContent).not.toContain("Model unavailable");
    expect(container.querySelector('[data-testid="ai-status-retry"]')).toBeNull();

    // Advance 4.5s: transition to "Still checking…" in meta line, still "Resolving model…"
    act(() => {
      vi.advanceTimersByTime(4500);
    });

    expect(container.textContent).toContain("Resolving model…");
    expect(container.textContent).toContain("Still checking…");
    expect(container.textContent).not.toContain("Model unavailable");
    expect(container.querySelector('[data-testid="ai-status-retry"]')).toBeNull();

    // Advance to 10s: response arrives successfully
    act(() => {
      vi.advanceTimersByTime(5500);
      root.render(
        createElement(AIScientistStatusBar, {
          ...baseProps,
          productContext: sampleContext,
          capability: null,
          contextError: null,
          requestKey: "key-1",
        }),
      );
    });

    // Resolved model displayed honestly, never flashed unavailable
    expect(container.textContent).toContain("nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(container.textContent).not.toContain("Model unavailable");
    expect(container.textContent).not.toContain("Resolving model…");
    expect(container.querySelector('[data-testid="ai-status-retry"]')).toBeNull();
  });

  it("real failure shows Model unavailable: immediate on contextError, and after 15s timeout", () => {
    const onRetry = vi.fn();

    // Sub-case A: immediate on contextError
    act(() => {
      root.render(
        createElement(AIScientistStatusBar, {
          ...baseProps,
          productContext: null,
          capability: null,
          contextError: "HTTP 503: Service Unavailable",
          onRetry,
          requestKey: "key-err",
        }),
      );
    });

    expect(container.textContent).toContain("Model unavailable");
    expect(container.querySelector('[data-testid="ai-status-retry"]')).not.toBeNull();

    // Sub-case B: after full 15s timeout
    act(() => {
      root.render(
        createElement(AIScientistStatusBar, {
          ...baseProps,
          productContext: null,
          capability: null,
          contextError: null,
          onRetry,
          requestKey: "key-timeout",
        }),
      );
    });

    // At 14s: still checking
    act(() => {
      vi.advanceTimersByTime(14000);
    });
    expect(container.textContent).toContain("Resolving model…");
    expect(container.textContent).not.toContain("Model unavailable");
    expect(container.querySelector('[data-testid="ai-status-retry"]')).toBeNull();

    // At 15.1s: real timeout elapsed
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(container.textContent).toContain("Model unavailable");
    expect(container.querySelector('[data-testid="ai-status-retry"]')).not.toBeNull();
  });

  it("state resets on a new key so a subsequent context change never flashes Model unavailable", () => {
    // Start with a timed-out context
    act(() => {
      root.render(
        createElement(AIScientistStatusBar, {
          ...baseProps,
          productContext: null,
          capability: null,
          contextError: null,
          requestKey: "key-old",
        }),
      );
    });

    act(() => {
      vi.advanceTimersByTime(15500);
    });
    expect(container.textContent).toContain("Model unavailable");

    // Change request key (e.g. navigation / context change)
    act(() => {
      root.render(
        createElement(AIScientistStatusBar, {
          ...baseProps,
          productContext: null,
          capability: null,
          contextError: null,
          requestKey: "key-new",
        }),
      );
    });

    // Immediately reset to initial checking state without flashing unavailable
    expect(container.textContent).toContain("Resolving model…");
    expect(container.textContent).toContain("Checking availability…");
    expect(container.textContent).not.toContain("Model unavailable");
    expect(container.querySelector('[data-testid="ai-status-retry"]')).toBeNull();
  });

  it("Retry works: resets timed-out state and calls onRetry handler", () => {
    const onRetry = vi.fn();
    act(() => {
      root.render(
        createElement(AIScientistStatusBar, {
          ...baseProps,
          productContext: null,
          capability: null,
          contextError: null,
          onRetry,
          requestKey: "key-retry",
        }),
      );
    });

    act(() => {
      vi.advanceTimersByTime(15500);
    });
    expect(container.textContent).toContain("Model unavailable");

    const retryBtn = container.querySelector<HTMLButtonElement>('[data-testid="ai-status-retry"]');
    expect(retryBtn).not.toBeNull();

    act(() => {
      retryBtn?.click();
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    // State is reset to resolving
    expect(container.textContent).toContain("Resolving model…");
    expect(container.textContent).not.toContain("Model unavailable");
  });
});
