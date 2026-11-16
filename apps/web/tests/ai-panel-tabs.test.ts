// @vitest-environment jsdom
/**
 * AI Scientist panel tabs: Chat, Evidence and Runs are always visible; Tools and Settings sit behind one overflow menu and join
 * the tab row while active, so the tablist always has exactly one selected tab. Component test with the real header.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cloneElement, createElement, Fragment, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@chemdft/ui", () => ({
  AppIcon: () => null,
  PopupKind: { MENU: "menu" },
  AppPopover: ({ children, content, isOpen, onInteraction }: { children: ReactElement; content: ReactNode; isOpen?: boolean; onInteraction?: (next: boolean) => void }) =>
    createElement(Fragment, null, cloneElement(children, { onClick: () => onInteraction?.(!isOpen) } as never), isOpen ? content : null),
}));

import { AIScientistHeader, type AIScientistTab } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-header";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
const byTestId = (id: string) => container!.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const tabs = () => [...container!.querySelectorAll('[role="tab"]')].map((el) => el.id.replace("ai-tab-", ""));

async function render(activeTab: AIScientistTab, onSelectTab = vi.fn()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(createElement(AIScientistHeader, { activeTab, onSelectTab })); });
  return onSelectTab;
}
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove(); root = null; container = null;
});

describe("AI Scientist tabs", () => {
  it("shows Chat, Evidence and Runs, and Tools and Settings only behind the overflow menu", async () => {
    await render("chat");
    expect(tabs()).toEqual(["chat", "evidence", "runs"]);
    expect(byTestId("ai-nav-tools")).toBeNull();
    expect(byTestId("ai-nav-settings")).toBeNull();
    const more = byTestId("ai-nav-more")!;
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    expect(more.getAttribute("aria-label")).toBe("More: Tools and Settings");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(byTestId("ai-more-menu")).toBeNull();
  });

  it("opens the menu and selects Tools or Settings through it", async () => {
    const onSelect = await render("chat");
    await act(async () => { byTestId("ai-nav-more")!.click(); });
    const items = [...container!.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent);
    expect(items).toEqual(["Tools", "Settings"]);
    await act(async () => { byTestId("ai-menu-tools")!.click(); });
    expect(onSelect).toHaveBeenCalledWith("tools");
    expect(byTestId("ai-more-menu")).toBeNull();
  });

  it("keeps the active Tools or Settings tab in the row so exactly one tab is selected", async () => {
    for (const active of ["tools", "settings"] as const) {
      await render(active);
      expect(tabs()).toEqual(["chat", "evidence", "runs", active]);
      const selected = [...container!.querySelectorAll('[role="tab"][aria-selected="true"]')].map((el) => el.id);
      expect(selected).toEqual([`ai-tab-${active}`]);
      await act(async () => { root!.unmount(); }); container!.remove(); root = null; container = null;
    }
  });

  it("moves between tabs with the arrow, Home and End keys (the overflow button is outside the tablist)", async () => {
    const onSelect = await render("chat");
    const list = container!.querySelector('[role="tablist"]') as HTMLElement;
    const press = async (key: string) => act(async () => { list.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
    await press("ArrowRight"); expect(onSelect).toHaveBeenLastCalledWith("evidence");
    await press("End"); expect(onSelect).toHaveBeenLastCalledWith("runs");
    await press("ArrowLeft"); expect(onSelect).toHaveBeenLastCalledWith("runs"); // from Chat, ArrowLeft wraps to the last visible tab
    await press("Home"); expect(onSelect).toHaveBeenLastCalledWith("chat");
    expect(list.contains(byTestId("ai-nav-more"))).toBe(false);
  });
});
