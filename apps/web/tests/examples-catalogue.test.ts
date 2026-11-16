import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { exampleMessage } from "../src/lib/example-messages";

vi.mock("@/lib/examples-api", () => ({
  publicExamples: vi.fn().mockResolvedValue([]),
}));

import ExamplesPage from "../src/app/[locale]/examples/page";

describe("examples catalogue presentation", () => {
  it("shows an honest one-line empty state when catalogue has no examples", async () => {
    expect(exampleMessage("en", "empty")).toBe("No published examples are currently available.");
    const element = await ExamplesPage({ params: Promise.resolve({ locale: "en" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("No published examples are currently available.");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<ul");
  });
});
