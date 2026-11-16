import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: unknown }) => createElement("a", { href }, children as never) }));

import { CostSupportView, PrinciplesView, ValidationView } from "../src/app/_components/public-doc/site-pages-views";

describe("Validation page", () => {
  const html = renderToString(createElement(ValidationView, { locale: "en" }));
  it("states the measured values and the platform", () => {
    for (const s of ["-476.0906515824172 Ha", "-952.18130316 Ry", "16", "12.95961 eV", "12.9596 eV", "Quantum ESPRESSO 7.6", "SSSP PBE Efficiency v2.0", "chemdft-pilot:runtime-qe-0046", "6d8b931c13e66180ba43199c0454ddc9d6468404ced9a3f93ac8d32191182432", "57.95 s", "-476.0906515824173 Ha"]) expect(html).toContain(s);
  });
  it("prints the limits and no account or instance ids", () => {
    expect(html).toContain("does not verify that the generated input is the right physics");
    expect(html).toContain("not evidence for another");
    expect(html).not.toMatch(/\bi-[0-9a-f]{8,}\b|\b\d{12}\b/);
  });
});

describe("Principles and Cost and support", () => {
  it("carries the AI disclosure without claiming full human review", () => {
    const html = renderToString(createElement(PrinciplesView, { locale: "en" }));
    expect(html).toContain('data-testid="ai-disclosure"');
    expect(html).toContain("does not prove that every line");
  });
  it("promises no price and invents no address", () => {
    const html = renderToString(createElement(CostSupportView, { locale: "en" }));
    expect(html).toContain("No price is promised");
    expect(html).not.toMatch(/@[a-z0-9-]+\.[a-z]+/i);
  });
});
