// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * F13: when the project's saved-items inventory cannot be read, the page that waits for it says so, offers a retry and keeps the
 * stored error under Details, instead of showing "Checking saved project items…" for ever. The inventory request is a stand-in.
 */
const api = vi.hoisted(() => ({ inventory: vi.fn(), project: vi.fn() }));
vi.mock("@/lib/workspace-inventory", () => ({ loadWorkspaceInventory: api.inventory }));
vi.mock("@/lib/project-api", () => ({ getProject: api.project, ProjectApiError: class extends Error { status = 0; } }));
vi.mock("next/navigation", () => ({ usePathname: () => "/en/projects/p/jobs", useSearchParams: () => new URLSearchParams() }));
vi.mock("@chemdft/ui", () => ({ AppIcon: () => null }));

import { CatalogUnavailable } from "../src/app/_components/catalog-unavailable";
import { ProjectExplorer } from "../src/app/_components/project-explorer";
import { useWorkspaceState, WorkspaceStateProvider } from "../src/app/_components/workspace-state-provider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  api.inventory.mockReset();
  api.project.mockReset().mockResolvedValue({ id: "p" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); }); };

/** What ProjectShell's dock slot decides from the shared state (same three branches as project-shell.tsx). */
function DockSlot() {
  const { catalogReady, catalogError } = useWorkspaceState();
  if (catalogReady) return createElement("p", { "data-testid": "dock-ready" }, "dock");
  if (catalogError) return createElement(CatalogUnavailable, { error: catalogError, heading: "Saved project items couldn't be loaded" });
  return createElement("p", { role: "status" }, "Checking saved project items…");
}

function mount() {
  const children = createElement("div", null, createElement(ProjectExplorer, { projectId: "p" }), createElement(DockSlot));
  // The provider's props type requires `children` as a prop.
  // eslint-disable-next-line react/no-children-prop
  act(() => root.render(createElement(WorkspaceStateProvider, { projectId: "p", children })));
}

describe("saved-items inventory failure", () => {
  it("shows a plain alert with Details instead of waiting for ever, and the explorer keeps its own message", async () => {
    api.inventory.mockRejectedValue(new Error("HTTP 503: The database is restarting."));
    mount();
    await flush();
    const alert = container.querySelector('[data-testid="catalog-unavailable"]');
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(alert?.textContent).toContain("Saved project items couldn't be loaded");
    expect(alert?.querySelector("details code")?.textContent).toBe("HTTP 503: The database is restarting.");
    expect(container.textContent).not.toContain("Checking saved project items…");
    expect(container.querySelector(".workspace-tree-notice")?.textContent).toContain("HTTP 503: The database is restarting.");
  });

  it("Try again reads the inventory once more and the dock mounts when it succeeds", async () => {
    api.inventory.mockRejectedValueOnce(new Error("Network down")).mockResolvedValue([]);
    mount();
    await flush();
    expect(container.querySelector('[data-testid="catalog-unavailable"]')).not.toBeNull();
    await act(async () => { (container.querySelector(".catalog-unavailable-retry") as HTMLButtonElement).click(); });
    await flush();
    expect(api.inventory).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="catalog-unavailable"]')).toBeNull();
    expect(container.querySelector('[data-testid="dock-ready"]')).not.toBeNull();
    expect(container.querySelector(".workspace-tree-notice[role=alert]")).toBeNull();
  });

  it("still says it is checking while the first request is pending (no premature error)", async () => {
    api.inventory.mockReturnValue(new Promise(() => {}));
    mount();
    await flush();
    expect(container.textContent).toContain("Checking saved project items…");
    expect(container.querySelector('[data-testid="catalog-unavailable"]')).toBeNull();
  });
});
