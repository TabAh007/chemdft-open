import { describe, expect, it } from "vitest";
import {
  computeContentBounds,
  drawCreditLine,
  extractPngTextChunks,
  insertPng300Dpi,
  insertPngMetadata,
  insertSvgMetadata,
} from "../src/lib/visualization/snapshot-processor";

describe("Snapshot processing: 300 DPI pHYs chunk and content cropping", () => {
  it("inserts valid 300 DPI pHYs chunk into PNG", () => {
    // Construct minimal valid PNG with signature and 13-byte IHDR
    const minimalPng = new Uint8Array([
      // Signature (8 bytes)
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      // IHDR length 13 (4 bytes)
      0x00, 0x00, 0x00, 0x0d,
      // IHDR type (4 bytes)
      0x49, 0x48, 0x44, 0x52,
      // IHDR data (13 bytes: 1x1 8-bit RGBA)
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00,
      // IHDR CRC (4 bytes)
      0x1f, 0x15, 0xc4, 0x89,
      // IEND (12 bytes)
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    const result = insertPng300Dpi(minimalPng);
    expect(result.length).toBe(minimalPng.length + 21);

    // Verify pHYs chunk insertion at offset 33
    expect(result[33]).toBe(0x00);
    expect(result[34]).toBe(0x00);
    expect(result[35]).toBe(0x00);
    expect(result[36]).toBe(0x09); // length 9

    // Type: "pHYs"
    expect(String.fromCharCode(result[37]!, result[38]!, result[39]!, result[40]!)).toBe("pHYs");

    // X pixels/meter: 11811 (0x2e23) = 300 DPI
    const xPpu = (result[41]! << 24) | (result[42]! << 16) | (result[43]! << 8) | result[44]!;
    expect(xPpu).toBe(11811);

    // Y pixels/meter: 11811
    const yPpu = (result[45]! << 24) | (result[46]! << 16) | (result[47]! << 8) | result[48]!;
    expect(yPpu).toBe(11811);

    // Unit: 1 (meter)
    expect(result[49]).toBe(1);

    // CRC: 0x78a53f76
    expect(result[50]).toBe(0x78);
    expect(result[51]).toBe(0xa5);
    expect(result[52]).toBe(0x3f);
    expect(result[53]).toBe(0x76);
  });

  it("computes accurate content bounding box for cropping with white background", () => {
    // 10x10 test image, all white except a 4x4 red square in the center (x: 3..6, y: 3..6)
    const w = 10;
    const h = 10;
    const rgba = new Uint8Array(w * h * 4);
    // Fill white
    rgba.fill(255);

    // Paint red block at x=3..6, y=3..6
    for (let y = 3; y <= 6; y++) {
      for (let x = 3; x <= 6; x++) {
        const idx = (y * w + x) * 4;
        rgba[idx] = 255;   // R
        rgba[idx + 1] = 0; // G
        rgba[idx + 2] = 0; // B
        rgba[idx + 3] = 255;
      }
    }

    const bounds = computeContentBounds(rgba, w, h, "white");
    expect(bounds).not.toBeNull();
    expect(bounds!.minX).toBe(3);
    expect(bounds!.minY).toBe(3);
    expect(bounds!.maxX).toBe(6);
    expect(bounds!.maxY).toBe(6);
    expect(bounds!.width).toBe(4);
    expect(bounds!.height).toBe(4);
  });

  it("computes accurate content bounding box for transparent background", () => {
    // 10x10 transparent image (alpha=0), with content at x=2..7, y=4..8
    const w = 10;
    const h = 10;
    const rgba = new Uint8Array(w * h * 4);
    rgba.fill(0);

    for (let y = 4; y <= 8; y++) {
      for (let x = 2; x <= 7; x++) {
        const idx = (y * w + x) * 4;
        rgba[idx] = 100;
        rgba[idx + 1] = 150;
        rgba[idx + 2] = 200;
        rgba[idx + 3] = 255; // opaque content
      }
    }

    const bounds = computeContentBounds(rgba, w, h, "transparent");
    expect(bounds).not.toBeNull();
    expect(bounds!.minX).toBe(2);
    expect(bounds!.maxX).toBe(7);
    expect(bounds!.minY).toBe(4);
    expect(bounds!.maxY).toBe(8);
  });

  it("embeds and extracts standard PNG metadata chunks (Software, Source, DOI, 300 DPI)", () => {
    const minimalPng = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00,
      0x1f, 0x15, 0xc4, 0x89,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    const withMeta = insertPngMetadata(minimalPng, {
      software: "ChemDFT 0.0.57",
      source: "https://chemdft.com",
      doi: "10.5281/zenodo.24082321",
    });

    const { text, has300Dpi } = extractPngTextChunks(withMeta);
    expect(has300Dpi).toBe(true);
    expect(text.Software).toBe("ChemDFT 0.0.57");
    expect(text.Source).toBe("https://chemdft.com");
    expect(text.DOI).toBe("10.5281/zenodo.24082321");

    // Guard: strictly no personal information in text chunks
    for (const [key, value] of Object.entries(text)) {
      expect(["Software", "Source", "DOI"]).toContain(key);
      expect(value).not.toMatch(/@/); // No email
      expect(value).not.toMatch(/user|account|project|session|token/i);
    }
  });

  it("omits DOI chunk when DOI is null or empty", () => {
    const minimalPng = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00,
      0x1f, 0x15, 0xc4, 0x89,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    const withMeta = insertPngMetadata(minimalPng, {
      software: "ChemDFT 0.0.57",
      source: "https://chemdft.com",
      doi: null,
    });

    const { text, has300Dpi } = extractPngTextChunks(withMeta);
    expect(has300Dpi).toBe(true);
    expect(text.Software).toBe("ChemDFT 0.0.57");
    expect(text.Source).toBe("https://chemdft.com");
    expect(text.DOI).toBeUndefined();
  });

  it("embeds publication metadata in SVG exports", () => {
    const rawSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40"/></svg>';
    const withSvgMeta = insertSvgMetadata(rawSvg);
    expect(withSvgMeta).toContain("<metadata><desc>Software: ChemDFT");
    expect(withSvgMeta).toContain("Source: https://chemdft.com");
    expect(withSvgMeta).toContain("</desc></metadata>");
  });

  it("draws credit line without errors and positions in corner", () => {
    const filled: { text: string; x: number; y: number }[] = [];
    const mockCtx = {
      save: () => {},
      restore: () => {},
      font: "",
      fillStyle: "",
      shadowColor: "",
      shadowBlur: 0,
      measureText: (text: string) => ({ width: text.length * 8 }),
      fillText: (text: string, x: number, y: number) => {
        filled.push({ text, x, y });
      },
    } as unknown as CanvasRenderingContext2D;

    drawCreditLine(mockCtx, 800, 600, "white");
    expect(filled.length).toBe(1);
    expect(filled[0]!.text).toBe("Rendered with ChemDFT");
    expect(filled[0]!.x).toBeGreaterThan(500);
    expect(filled[0]!.y).toBeGreaterThan(500);
  });
});

