import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ValidationView } from "../src/app/_components/public-doc/site-pages-views";

describe("Validation page live checks (0.0.54)", () => {
  const html = renderToStaticMarkup(createElement(ValidationView, { locale: "en" }));

  it("lists the live platform checks separately and states they are not independent verification", () => {
    expect(html).toContain('data-testid="validation-live-checks"');
    expect(html).toContain("-1.11676 Eh");
    expect(html).toContain("PySCF 2.14.0");
    expect(html).toContain("Nothing here was independently verified");
  });

  it("states the open geomeTRIC clause question, the image state and the untested paths", () => {
    expect(html).toContain("geomeTRIC 1.1.1 is still in the deployed compute image");
    expect(html).toContain("open question for a lawyer");
    expect(html).toContain("AI-proposed geometry optimisation");
  });

  it("keeps the original Cr2O3 comparison and its limits", () => {
    expect(html).toContain('data-testid="validation-limits"');
    expect(html).toContain("-476.0906515824172 Ha");
  });
});
