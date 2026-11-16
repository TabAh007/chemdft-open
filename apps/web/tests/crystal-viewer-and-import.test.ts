import { describe, expect, it, vi } from "vitest";
import { calculateSnapshotDimensions } from "../src/lib/visualization/renderer-utils";
import { cellVolume } from "@chemdft/scientific-scene";
import { importStructure } from "../src/lib/structure-workspace-api";
import { LATEST_VERSION } from "../src/content/releases";
import { verifyTurnstileToken } from "../src/lib/contact/turnstile";

describe("crystal viewer publication aids and bug fixes", () => {
  describe("snapshot dimensions", () => {
    it("computes 1x and 2x dimensions accurately", () => {
      const s1 = calculateSnapshotDimensions(1200, 800, 1);
      expect(s1.width).toBe(1200);
      expect(s1.height).toBe(800);
      expect(s1.multiplier).toBe(1);

      const s2 = calculateSnapshotDimensions(1200, 800, 2);
      expect(s2.width).toBe(2400);
      expect(s2.height).toBe(1600);
      expect(s2.multiplier).toBe(2);
    });

    it("ensures 4x produces at least 3000 px on the long side for normal and compact screens", () => {
      // Normal laptop window (e.g. 1000 x 700)
      const normal = calculateSnapshotDimensions(1000, 700, 4);
      expect(Math.max(normal.width, normal.height)).toBeGreaterThanOrEqual(3000);
      expect(normal.multiplier).toBe(4);
      expect(normal.width).toBe(4000);
      expect(normal.height).toBe(2800);

      // Compact viewport (e.g. 600 x 400)
      const compact = calculateSnapshotDimensions(600, 400, 4);
      expect(Math.max(compact.width, compact.height)).toBeGreaterThanOrEqual(3000);
      expect(compact.multiplier).toBe(5); // 600 * 5 = 3000
      expect(compact.width).toBe(3000);
      expect(compact.height).toBe(2000);

      // Small panel (e.g. 400 x 300)
      const small = calculateSnapshotDimensions(400, 300, 4);
      expect(Math.max(small.width, small.height)).toBeGreaterThanOrEqual(3000);
      expect(small.multiplier).toBe(8); // 400 * 8 = 3200
      expect(small.width).toBe(3200);
      expect(small.height).toBe(2400);
    });
  });

  describe("crystal unit cell volume", () => {
    it("computes unit cell volume accurately for hexagonal and rhombohedral cells", () => {
      const hex = {
        a: 4.958,
        b: 4.958,
        c: 13.593,
        alpha: 90,
        beta: 90,
        gamma: 120,
      };
      expect(cellVolume(hex)).toBeCloseTo(289.37, 1);

      const rhomb = {
        a: 5.3595,
        b: 5.3595,
        c: 5.3595,
        alpha: 55.103,
        beta: 55.103,
        gamma: 55.103,
      };
      expect(cellVolume(rhomb)).toBeCloseTo(96.46, 1);
    });
  });

  describe("import second structure into project with existing structure", () => {
    it("imports a second structure successfully into the same project", async () => {
      const originalFetch = globalThis.fetch;
      const fetchCalls: { url: string; method?: string | undefined; body?: unknown }[] = [];

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(input);
        fetchCalls.push({ url: urlStr, method: init?.method, body: init?.body });

        if (urlStr.includes("/structures/imports")) {
          const isSecond = fetchCalls.length > 1;
          const structureId = isSecond ? "struct-2" : "struct-1";
          const versionId = isSecond ? "ver-2" : "ver-1";
          const structName = isSecond ? "Cr2O3_rhomb" : "Cr2O3_hex";

          return new Response(
            JSON.stringify({
              structure: {
                id: structureId,
                project_id: "proj-123",
                name: structName,
                kind: "PERIODIC",
              },
              version: {
                id: versionId,
                structure_id: structureId,
                revision: 1,
                origin: "IMPORTED",
              },
              summary: {
                atoms: isSecond ? 10 : 30,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      }) as typeof fetch;

      try {
        const file1 = new File(["data1"], "Cr2O3_hex.cif", { type: "text/plain" });
        const res1 = await importStructure({
          projectId: "proj-123",
          file: file1,
          fileFormat: "CIF",
          structureName: "Cr2O3_hex",
        });

        expect(res1.structure.id).toBe("struct-1");
        expect(res1.structure.name).toBe("Cr2O3_hex");

        const file2 = new File(["data2"], "Cr2O3_rhomb.cif", { type: "text/plain" });
        const res2 = await importStructure({
          projectId: "proj-123",
          file: file2,
          fileFormat: "CIF",
          structureName: "Cr2O3_rhomb",
        });

        expect(res2.structure.id).toBe("struct-2");
        expect(res2.structure.name).toBe("Cr2O3_rhomb");
        expect(res2.structure.project_id).toBe("proj-123");
        expect(fetchCalls).toHaveLength(2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("contact form service and turnstile use release version constant", () => {
    it("uses LATEST_VERSION in Turnstile User-Agent header", async () => {
      let capturedUserAgent: string | undefined;
      const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string> | undefined;
        capturedUserAgent = headers?.["User-Agent"];
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      });

      const res = await verifyTurnstileToken(
        "dummy-secret",
        "dummy-token",
        "127.0.0.1",
        mockFetch as unknown as typeof fetch,
      );
      expect(res.ok).toBe(true);
      expect(capturedUserAgent).toBe(`ChemDFT-Contact/${LATEST_VERSION}`);
      expect(capturedUserAgent).not.toContain("0.0.35");
    });
  });
});

