import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => undefined, refresh: () => undefined }) }));
vi.mock("next/link", () => ({ default: (props: { href: string; className?: string; children?: unknown }) => createElement("a", { href: props.href, className: props.className }, props.children as never) }));
vi.mock("../src/lib/auth/client", () => ({ authClient: { signOut: async () => ({ error: null }) } }));

import { AccountClient } from "../src/app/[locale]/account/account-client";
import { DEV_IDENTITY_NOTE, interpretSignOut } from "../src/lib/account-sign-out";

describe("interpretSignOut", () => {
  it("signs out only when the client reports no error", () => {
    expect(interpretSignOut({ error: null })).toBe("signed-out");
    expect(interpretSignOut({})).toBe("signed-out");
  });
  it("fails on an error result, such as the 404 the dev server gives", () => {
    expect(interpretSignOut({ error: { status: 404, statusText: "Not Found" } })).toBe("failed");
  });
  it("fails when the call threw or returned nothing", () => {
    expect(interpretSignOut(undefined)).toBe("failed");
    expect(interpretSignOut(null)).toBe("failed");
    expect(interpretSignOut({ error: null }, true)).toBe("failed");
  });
});

describe("Account page sign-out states", () => {
  const render = (signOutAvailable: boolean, localDevelopment: boolean) =>
    renderToStaticMarkup(createElement(AccountClient, { locale: "en", signOutAvailable, localDevelopment }));

  it("local development shows the explanation and no Sign out button", () => {
    const html = render(false, true);
    expect(html).not.toContain('data-testid="sign-out"');
    expect(html).toContain('data-testid="dev-identity-note"');
    expect(html).toContain(DEV_IDENTITY_NOTE);
  });
  it("hosted authentication keeps the Sign out button and no development note", () => {
    const html = render(true, false);
    expect(html).toContain('data-testid="sign-out"');
    expect(html).not.toContain("dev-identity-note");
  });
  it("dev mode without the identity flag shows neither", () => {
    const html = render(false, false);
    expect(html).not.toContain('data-testid="sign-out"');
    expect(html).not.toContain("dev-identity-note");
  });
});
