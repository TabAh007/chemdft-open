import { describe, expect, it } from "vitest";
import { drawFailureMessage, drawText } from "@/lib/molecule-editor/ai-draw";

describe("draw failure message", () => {
  it("is a clear sentence when the draw route is missing (404) or the AI is unavailable (503)", () => {
    expect(drawFailureMessage(404, "Not Found")).toBe(drawText.notOnServer);
    expect(drawFailureMessage(503, "boom")).toBe(drawText.unavailable);
    expect(drawFailureMessage(500, "Server said no")).toBe("Server said no");
    expect(drawFailureMessage(0, null)).toBe(drawText.unavailable);
  });
});
