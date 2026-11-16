// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useWorkspaceAnnounceRequests } from "../src/lib/workspace-announce";
import type { ResolvedAiContext } from "../src/lib/ai-context";

/**
 * The real ProjectDock, with everything around it replaced by stand-ins, and a stand-in Workspace that uses the same
 * `useWorkspaceAnnounceRequests` hook as the real one. The Workspace announces once, BEFORE the dock mounts (as it does
 * when the dock waits for the project catalog); the dock must still end up showing that context after asking again.
 */
vi.mock("next/navigation", () => ({ usePathname: () => "/en/projects/p/workspace" }));
vi.mock("@chemdft/ui", () => ({ AppIcon: () => null }));
vi.mock("@/lib/project-api", () => ({ getProject: () => Promise.resolve({ name: "Project" }) }));
vi.mock("../src/app/_components/workspace-state-provider", () => ({
  useWorkspaceState: () => ({ activeSelection: null, activeTab: null, catalog: [], openSelection: () => undefined, workspaceMode: "guided" }),
}));
vi.mock("../src/app/_components/structure-version-inspector", () => ({ StructureVersionInspector: () => null }));
vi.mock("../src/app/_components/electronic-field-inspector", () => ({ ElectronicFieldInspector: () => null }));
vi.mock("../src/app/_components/compare/compare-dock-notice", () => ({ CompareDockNotice: () => null }));
vi.mock("../src/app/[locale]/projects/[projectId]/workspace/evidence-workspace-panel", () => ({ EvidenceWorkspacePanel: () => null }));
vi.mock("../src/app/[locale]/projects/[projectId]/workspace/ai-scientist-panel", async () => {
  const { createElement: h } = await import("react");
  return { AIScientistPanel: ({ aiContext }: { aiContext: ResolvedAiContext }) => h("output", { "data-testid": "ctx" }, aiContext.label) };
});

import { ProjectDock } from "../src/app/_components/project-dock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const announce = () => window.dispatchEvent(new CustomEvent("chemdft:workspace-selection", { detail: { projectId: "p", structureName: "Water", structureVersionRevision: 1, currentView: "Water V1" } }));
const requests: string[] = [];
const onRequest = () => requests.push("request");

const Workspace = () => {
  const tick = useWorkspaceAnnounceRequests();
  useEffect(() => { announce(); }, [tick]);
  return null;
};

let host: HTMLDivElement;
let root: Root;
const shown = () => host.querySelector('[data-testid="ctx"]')?.textContent;

beforeEach(() => {
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); requests.length = 0; window.addEventListener("chemdft:workspace-selection-request", onRequest);
});
afterEach(() => { window.removeEventListener("chemdft:workspace-selection-request", onRequest); act(() => root.unmount()); host.remove(); });

describe("Workspace announcement handshake", () => {
  it("a context announced before the dock mounts still reaches the dock: the dock asks, the Workspace announces again", async () => {
    await act(async () => { root.render(createElement(Workspace)); });
    expect(requests).toHaveLength(0);
    // The dock mounts later. Without the handshake it never hears the first announcement and shows "Project → Overview".
    await act(async () => { root.render(createElement("div", null, createElement(Workspace), createElement(ProjectDock, { projectId: "p" }))); });
    expect(requests).toHaveLength(1);
    expect(shown()).toBe("Water V1");
  });
  it("a Workspace that is not listening is harmless, and the dock keeps its project default", async () => {
    await act(async () => { root.render(createElement(ProjectDock, { projectId: "p" })); });
    expect(requests).toHaveLength(1);
    expect(shown()).toBe("Project → Overview");
  });
});
