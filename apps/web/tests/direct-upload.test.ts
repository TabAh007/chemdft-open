import { afterEach, expect, it, vi } from "vitest";
import { DIRECT_UPLOAD_THRESHOLD_BYTES, importDocument } from "../src/lib/phase7-api";

afterEach(() => vi.unstubAllGlobals());
const big = () => new File([new Uint8Array(DIRECT_UPLOAD_THRESHOLD_BYTES + 1)], "big.pdf", { type: "application/pdf" });
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

it("sends small PDFs through the normal proxy path", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => json({ ok: 1 }));
  vi.stubGlobal("fetch", fetchMock);
  await importDocument("p1", new File(["x"], "s.pdf"));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0]![0])).toContain("/v1/projects/p1/documents/imports");
});
it("uses a ticket and posts large PDFs straight to the API", async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockImplementationOnce(() => json({ ticket: "T", upload_url: "https://api.example/v1/direct-uploads/documents", expires_at: 1, max_bytes: 9 }))
    .mockImplementationOnce(() => json({ document: "d" }, 201));
  vi.stubGlobal("fetch", fetchMock);
  await importDocument("p1", big());
  expect(String(fetchMock.mock.calls[0]![0])).toContain("/v1/projects/p1/documents/upload-tickets");
  expect(fetchMock.mock.calls[1]![0]).toBe("https://api.example/v1/direct-uploads/documents");
  expect((fetchMock.mock.calls[1]![1]!.headers as Record<string, string>)["X-ChemDFT-Upload-Ticket"]).toBe("T");
});
it("explains clearly when direct upload is not enabled", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(() => json({ detail: "direct_upload_unavailable" }, 503)));
  await expect(importDocument("p1", big())).rejects.toThrow(/not enabled/);
});
it("reports a network failure of the direct upload plainly", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>()
    .mockImplementationOnce(() => json({ ticket: "T", upload_url: "https://api.example/u", expires_at: 1, max_bytes: 9 }))
    .mockRejectedValueOnce(new TypeError("Failed to fetch")));
  await expect(importDocument("p1", big())).rejects.toThrow(/could not be sent/);
});
