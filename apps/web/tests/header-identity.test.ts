// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HeaderIdentity } from "../src/app/_components/settings/header-identity";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const me = (display_name: string) => new Response(JSON.stringify({ display_name, email: "t@example.invalid", organization: { name: "Lab" } }), { status: 200 });

describe("HeaderIdentity", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

  const mount = async (response: () => Promise<Response>) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(response);
    act(() => { root.render(createElement(HeaderIdentity, { locale: "en" })); });
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
    return container.querySelector<HTMLAnchorElement>('[data-testid="header-identity"]');
  };

  it("shows initials as a link to the account when /v1/me answers", async () => {
    const link = await mount(async () => me("Tabriz Ahmadli"));
    expect(link?.textContent).toBe("TA");
    expect(link?.getAttribute("href")).toBe("/en/account");
    expect(link?.getAttribute("aria-label")).toBe("Signed in as Tabriz Ahmadli");
  });

  it("falls back to a neutral Account link, never a placeholder name, when /v1/me fails", async () => {
    for (const response of [async () => new Response("no", { status: 500 }), async () => { throw new Error("offline"); }]) {
      act(() => root.unmount()); root = createRoot(container);
      const link = await mount(response);
      expect(link?.getAttribute("href")).toBe("/en/account");
      expect(link?.getAttribute("title")).toBe("Account");
      expect(link?.getAttribute("aria-label")).toBe("Account");
      expect(link?.textContent).toBe("");
      expect(container.textContent).not.toContain("DV");
    }
  });

  it("uses the same neutral fallback when the name has no letters", async () => {
    const link = await mount(async () => me("   "));
    expect(link?.getAttribute("title")).toBe("Account");
    expect(link?.textContent).toBe("");
  });

  it("draws nothing while the identity is still loading", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
    act(() => { root.render(createElement(HeaderIdentity, { locale: "en" })); });
    expect(container.querySelector('[data-testid="header-identity"]')).toBeNull();
  });
});
