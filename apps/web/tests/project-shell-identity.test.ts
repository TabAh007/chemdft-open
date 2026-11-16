// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LocalDevelopmentProvider } from "../src/app/_components/local-development-context";
import { ProjectShell } from "../src/app/_components/project-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/en/projects/p/workspace",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/project-api", () => ({
  getProject: vi.fn().mockResolvedValue({ id: "p", name: "Alpha Project" }),
  ProjectApiError: class extends Error { status = 0; },
}));

vi.mock("@/lib/workspace-inventory", () => ({
  loadWorkspaceInventory: vi.fn().mockResolvedValue([]),
}));

vi.mock("@chemdft/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@chemdft/ui")>();
  return {
    ...actual,
    AppIcon: () => null,
  };
});

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

describe("ProjectShell identity and local-development badge", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const flush = async () => {
    for (let i = 0; i < 4; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
  };

  it("shows Local development tag only when local-development context is true", async () => {
    act(() => {
      root.render(
        createElement(LocalDevelopmentProvider, { value: true },
          createElement(ProjectShell, { locale: "en", projectId: "p" }, "Content"),
        ),
      );
    });
    await flush();

    expect(container.textContent).toContain("Local development");
    expect(container.textContent).not.toContain("DV");
    expect(container.querySelector('[aria-label="Development identity"]')).toBeNull();
  });

  it("hides Local development tag on hosted mode (value=false)", async () => {
    act(() => {
      root.render(
        createElement(LocalDevelopmentProvider, { value: false },
          createElement(ProjectShell, { locale: "en", projectId: "p" }, "Content"),
        ),
      );
    });
    await flush();

    expect(container.textContent).not.toContain("Local development");
    expect(container.textContent).not.toContain("DV");
    expect(container.querySelector('[aria-label="Development identity"]')).toBeNull();
  });

  it("renders signed-in initials from /v1/me and hides identity avatar when unknown", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/chemdft/v1/me")) {
        return new Response(JSON.stringify({
          display_name: "Ada Lovelace",
          email: "ada@example.invalid",
          organization: { name: "Computing Lab" },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("Not found", { status: 404 });
    });

    act(() => {
      root.render(
        createElement(LocalDevelopmentProvider, { value: false },
          createElement(ProjectShell, { locale: "en", projectId: "p" }, "Content"),
        ),
      );
    });
    await flush();

    const identity = container.querySelector('[data-testid="header-identity"]');
    expect(identity).not.toBeNull();
    expect(identity?.textContent).toBe("AL");
    expect(identity?.getAttribute("aria-label")).toBe("Signed in as Ada Lovelace");
  });
});
