// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

const api = vi.hoisted(() => ({ getProject: vi.fn() }));
vi.mock("@/lib/project-api", () => ({ getProject: api.getProject }));

import { useProjectRole, useProjectWriteAccess } from "../src/lib/use-project-role";

type Seen = { guided: ReturnType<typeof useProjectRole>; results: ReturnType<typeof useProjectWriteAccess> };
let container: HTMLDivElement;
let root: Root;
let seen: Seen;

function Probe({ projectId, onSeen }: { projectId: string; onSeen: (value: Seen) => void }) {
  const guided = useProjectRole(projectId);
  const results = useProjectWriteAccess(projectId);
  useEffect(() => { onSeen({ guided, results }); });
  return null;
}
async function mount(projectId = "project-1") {
  await act(async () => { root.render(createElement(Probe, { projectId, onSeen: (value: Seen) => { seen = value; } })); });
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  api.getProject.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

describe("project role (one mirror of the server's WRITE capability)", () => {
  it("offers nothing that needs write access while the role is being read", async () => {
    api.getProject.mockReturnValue(new Promise(() => {}));
    await mount();
    expect(seen.guided).toEqual({ role: null, canExecute: false });
    expect(seen.results).toEqual({ role: null, canWrite: null });
  });

  it.each(["owner", "editor", "Editor"])("grants write access to %s in both views", async (role) => {
    api.getProject.mockResolvedValue({ id: "project-1", role });
    await mount();
    expect(seen.guided).toEqual({ role, canExecute: true });
    expect(seen.results).toEqual({ role, canWrite: true });
  });

  it.each(["viewer", "commenter", ""])("denies write access to %j in both views", async (role) => {
    api.getProject.mockResolvedValue({ id: "project-1", role });
    await mount();
    expect(seen.guided.canExecute).toBe(false);
    expect(seen.results.canWrite).toBe(false);
  });

  it("denies write access when the role cannot be read", async () => {
    api.getProject.mockRejectedValue(new Error("offline"));
    await mount();
    expect(seen.guided).toEqual({ role: null, canExecute: false });
    expect(seen.results).toEqual({ role: null, canWrite: false });
  });
});
