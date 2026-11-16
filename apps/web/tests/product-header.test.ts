import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProductHeader, type ProductHeaderActive } from "../src/app/_components/product-header";

const render = (active: ProductHeaderActive) => renderToStaticMarkup(createElement(ProductHeader, { locale: "en", active }));
const links = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>/g)].map((match) => match[1]);

afterEach(() => vi.unstubAllEnvs());

describe("ProductHeader", () => {
  it("renders brand, Projects, Jobs, Learn, Releases, Feedback, Settings in order", () => {
    const html = render("projects");
    expect(links(html)).toEqual(["/en", "/en/projects", "/en/jobs", "/en/learn", "/en/releases", "/en/feedback", "/en/settings/general"]);
    const labels = [...html.matchAll(/<span class="[^"]*label[^"]*">([^<]+)<\/span>/g)].map((match) => match[1]);
    expect(labels).toEqual(["Projects", "Jobs", "Learn", "Releases", "Feedback", "Settings"]);
  });

  it.each([["projects", "Projects"], ["jobs", "Jobs"], ["learn", "Learn"], ["releases", "Releases"], ["feedback", "Feedback"], ["settings", "Settings"]] as const)("marks %s as the current page", (active, label) => {
    const html = render(active);
    const current = [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>.*?<\/a>/g)];
    expect(current).toHaveLength(1);
    expect(current[0]![0]).toContain(label);
  });

  it("marks no nav item current on Account", () => {
    expect(render("account")).not.toContain('aria-current="page"');
  });

  it("has no separate text Account link (the identity avatar is the Account link)", () => {
    expect(render("projects")).not.toContain("header-account-link");
  });

  it("shows the Development identity chip only in explicit local development, never in production", () => {
    vi.stubEnv("CHEMDFT_AUTH_MODE", "dev");
    vi.stubEnv("CHEMDFT_DEV_IDENTITY_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "development");
    expect(render("projects")).toContain("Development identity");
    vi.stubEnv("NODE_ENV", "production");
    expect(render("projects")).not.toContain("Development identity");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CHEMDFT_AUTH_MODE", "jwt");
    expect(render("projects")).not.toContain("Development identity");
  });
});
