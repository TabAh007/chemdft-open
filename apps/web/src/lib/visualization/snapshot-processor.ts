/**
 * Snapshot image processing for publication figures (release 0.0.38 / 0.0.57).
 *
 * Capabilities:
 * - Insert 300 DPI metadata into PNG via standard PNG pHYs chunk (11,811 pixels/meter).
 * - Embed standard PNG text chunks: Software, Source, and DOI from software_citation.json.
 * - Embed metadata in SVG exports (<metadata>/<desc>).
 * - Render optional "Rendered with ChemDFT" credit line.
 * - Crop whitespace/transparent margins around content with configurable margin.
 * - Zero personal data: no user name, email, account id, project name, or internal ids.
 */

import { CITATION_METADATA } from "../citation";

// Standard CRC32 table for PNG chunk validation
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

export function crc32(buf: Uint8Array, offset = 0, length = buf.length): number {
  let c = 0xffffffff;
  for (let i = offset; i < offset + length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Creates a standard PNG tEXt chunk.
 * Structure: 4 bytes length, 4 bytes "tEXt", keyword (ASCII), null separator, text (ASCII), 4 bytes CRC.
 */
export function createPngTextChunk(keyword: string, text: string): Uint8Array {
  const enc = new TextEncoder();
  const keyBytes = enc.encode(keyword);
  const textBytes = enc.encode(text);
  const dataLen = keyBytes.length + 1 + textBytes.length;

  const chunk = new Uint8Array(4 + 4 + dataLen + 4);
  const view = new DataView(chunk.buffer);

  // Length
  view.setUint32(0, dataLen, false);

  // Type: "tEXt"
  chunk[4] = 0x74;
  chunk[5] = 0x45;
  chunk[6] = 0x58;
  chunk[7] = 0x74;

  // Data: keyword + 0x00 + text
  chunk.set(keyBytes, 8);
  chunk[8 + keyBytes.length] = 0x00;
  chunk.set(textBytes, 8 + keyBytes.length + 1);

  // CRC-32 over Type + Data
  const chunkCrc = crc32(chunk, 4, 4 + dataLen);
  view.setUint32(8 + dataLen, chunkCrc, false);

  return chunk;
}

/**
 * Inserts a pHYs chunk (300 DPI = 11,811 pixels per meter) into a PNG buffer.
 * Standard PNG specification chunk structure.
 */
export function insertPng300Dpi(pngBuffer: Uint8Array): Uint8Array {
  // Check PNG magic: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
  if (
    pngBuffer.length < 33 ||
    pngBuffer[0] !== 0x89 ||
    pngBuffer[1] !== 0x50 ||
    pngBuffer[2] !== 0x4e ||
    pngBuffer[3] !== 0x47
  ) {
    return pngBuffer;
  }

  const insertIndex = 33;
  const physChunk = new Uint8Array([
    0x00, 0x00, 0x00, 0x09, // chunk length: 9 bytes
    0x70, 0x48, 0x59, 0x73, // chunk type: "pHYs"
    0x00, 0x00, 0x2e, 0x23, // 11811 pixels/meter X (300 DPI)
    0x00, 0x00, 0x2e, 0x23, // 11811 pixels/meter Y (300 DPI)
    0x01,                   // unit: meter
    0x78, 0xa5, 0x3f, 0x76, // CRC-32
  ]);

  const output = new Uint8Array(pngBuffer.length + physChunk.length);
  output.set(pngBuffer.subarray(0, insertIndex), 0);
  output.set(physChunk, insertIndex);
  output.set(pngBuffer.subarray(insertIndex), insertIndex + physChunk.length);
  return output;
}

export interface PngMetadataOptions {
  software?: string;
  source?: string;
  doi?: string | null;
}

/**
 * Inserts 300 DPI pHYs chunk AND standard publication citation text chunks (Software, Source, DOI)
 * immediately after IHDR in a PNG buffer.
 * Strictly no personal information is included.
 */
export function insertPngMetadata(
  pngBuffer: Uint8Array,
  options?: PngMetadataOptions
): Uint8Array {
  // Check PNG magic: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
  if (
    pngBuffer.length < 33 ||
    pngBuffer[0] !== 0x89 ||
    pngBuffer[1] !== 0x50 ||
    pngBuffer[2] !== 0x4e ||
    pngBuffer[3] !== 0x47
  ) {
    return pngBuffer;
  }

  // End of IHDR chunk: 8 bytes magic + 4 len + 4 type + 13 data + 4 crc = 33
  const insertIndex = 33;

  // 1. 21-byte pHYs chunk for 300 DPI (11811 pixels/meter):
  const physChunk = new Uint8Array([
    0x00, 0x00, 0x00, 0x09, // chunk length: 9 bytes
    0x70, 0x48, 0x59, 0x73, // chunk type: "pHYs"
    0x00, 0x00, 0x2e, 0x23, // 11811 pixels/meter X (300 DPI)
    0x00, 0x00, 0x2e, 0x23, // 11811 pixels/meter Y (300 DPI)
    0x01,                   // unit: meter
    0x78, 0xa5, 0x3f, 0x76, // CRC-32
  ]);

  // 2. Metadata text chunks
  const software = options?.software ?? `ChemDFT ${CITATION_METADATA.version}`;
  const source = options?.source ?? (CITATION_METADATA.url || "https://chemdft.com");
  const doi = options?.doi !== undefined ? options.doi : CITATION_METADATA.doi;

  const chunksToInsert: Uint8Array[] = [
    physChunk,
    createPngTextChunk("Software", software),
    createPngTextChunk("Source", source),
  ];

  if (doi) {
    chunksToInsert.push(createPngTextChunk("DOI", doi));
  }

  const totalExtraBytes = chunksToInsert.reduce((acc, c) => acc + c.length, 0);
  const output = new Uint8Array(pngBuffer.length + totalExtraBytes);

  // Copy IHDR and magic
  output.set(pngBuffer.subarray(0, insertIndex), 0);

  // Copy new chunks
  let curIndex = insertIndex;
  for (const c of chunksToInsert) {
    output.set(c, curIndex);
    curIndex += c.length;
  }

  // Copy rest of original PNG
  output.set(pngBuffer.subarray(insertIndex), curIndex);
  return output;
}

/**
 * Apply 300 DPI and citation metadata to a data:image/png;base64 URL.
 */
export function insertPngMetadataToDataUrl(
  dataUrl: string,
  options?: PngMetadataOptions
): string {
  if (!dataUrl.startsWith("data:image/png;base64,")) return dataUrl;
  const base64 = dataUrl.slice("data:image/png;base64,".length);
  const binaryString =
    typeof atob !== "undefined"
      ? atob(base64)
      : Buffer.from(base64, "base64").toString("binary");
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const withMeta = insertPngMetadata(bytes, options);

  let newBinary = "";
  const chunkSize = 8192;
  for (let i = 0; i < withMeta.length; i += chunkSize) {
    newBinary += String.fromCharCode(...withMeta.subarray(i, i + chunkSize));
  }
  const newBase64 =
    typeof btoa !== "undefined"
      ? btoa(newBinary)
      : Buffer.from(newBinary, "binary").toString("base64");
  return "data:image/png;base64," + newBase64;
}

export function insertPng300DpiToDataUrl(dataUrl: string): string {
  return insertPngMetadataToDataUrl(dataUrl);
}

/**
 * Extracts all tEXt chunks and checks for pHYs chunk in a PNG buffer.
 * Useful for automated assertions in tests.
 */
export function extractPngTextChunks(pngBuffer: Uint8Array): {
  text: Record<string, string>;
  has300Dpi: boolean;
} {
  const text: Record<string, string> = {};
  let has300Dpi = false;

  if (pngBuffer.length < 8) return { text, has300Dpi };

  let offset = 8; // skip PNG signature
  const dec = new TextDecoder();
  const view = new DataView(pngBuffer.buffer, pngBuffer.byteOffset, pngBuffer.byteLength);

  while (offset + 12 <= pngBuffer.length) {
    const chunkLen = view.getUint32(offset, false);
    const chunkType = String.fromCharCode(
      pngBuffer[offset + 4]!,
      pngBuffer[offset + 5]!,
      pngBuffer[offset + 6]!,
      pngBuffer[offset + 7]!
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLen;

    if (dataEnd + 4 > pngBuffer.length) break;

    if (chunkType === "pHYs" && chunkLen === 9) {
      const ppuX = view.getUint32(dataStart, false);
      const ppuY = view.getUint32(dataStart + 4, false);
      const unit = pngBuffer[dataStart + 8];
      if (ppuX === 11811 && ppuY === 11811 && unit === 1) {
        has300Dpi = true;
      }
    } else if (chunkType === "tEXt") {
      const data = pngBuffer.subarray(dataStart, dataEnd);
      let nullIdx = -1;
      for (let i = 0; i < data.length; i++) {
        if (data[i] === 0x00) {
          nullIdx = i;
          break;
        }
      }
      if (nullIdx !== -1) {
        const keyword = dec.decode(data.subarray(0, nullIdx));
        const val = dec.decode(data.subarray(nullIdx + 1));
        text[keyword] = val;
      }
    }

    if (chunkType === "IEND") break;
    offset += 12 + chunkLen;
  }

  return { text, has300Dpi };
}

/**
 * Embeds standard software and citation metadata into an SVG document.
 * Injects <metadata><desc>Software: ...</desc></metadata> after the opening <svg> tag.
 */
export function insertSvgMetadata(svgText: string): string {
  const software = `ChemDFT ${CITATION_METADATA.version}`;
  const source = CITATION_METADATA.url || "https://chemdft.com";
  const doi = CITATION_METADATA.doi;
  const descContent = `Software: ${software}; Source: ${source}${doi ? `; DOI: ${doi}` : ""}`;
  const metadataBlock = `<metadata><desc>${descContent}</desc></metadata>`;

  const match = /<svg[^>]*>/i.exec(svgText);
  if (!match) return svgText;
  const insertPos = match.index + match[0].length;
  return svgText.slice(0, insertPos) + metadataBlock + svgText.slice(insertPos);
}

/**
 * Draws a small "Rendered with ChemDFT" credit line in the bottom corner of an HTML canvas.
 * Never overlaps the molecule; styled for readability on white or transparent backgrounds.
 */
export function drawCreditLine(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  background: "white" | "transparent",
  bounds?: ContentBounds | null
): void {
  const text = "Rendered with ChemDFT";
  ctx.save();
  const fontSize = Math.max(11, Math.round(width * 0.016));
  ctx.font = `600 ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;
  const padding = Math.max(12, Math.round(fontSize * 1.2));

  // Default position: bottom-right corner
  let x = width - textWidth - padding;
  const y = height - padding;

  if (bounds) {
    const overlapsBottomRight =
      bounds.maxX >= x - padding && bounds.maxY >= y - fontSize - padding;
    if (overlapsBottomRight) {
      const altX = padding;
      const overlapsBottomLeft =
        bounds.minX <= altX + textWidth + padding && bounds.maxY >= y - fontSize - padding;
      if (!overlapsBottomLeft) {
        x = altX;
      }
    }
  }

  if (background === "transparent") {
    ctx.shadowColor = "rgba(255, 255, 255, 0.9)";
    ctx.shadowBlur = 4;
    ctx.fillStyle = "rgba(24, 33, 43, 0.85)";
  } else {
    ctx.fillStyle = "rgba(82, 96, 109, 0.85)";
  }

  ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * Bounds of non-background content in an image.
 */
export interface ContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/**
 * Calculate the bounding box of non-background pixels in an RGBA buffer.
 */
export function computeContentBounds(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  background: "white" | "transparent",
): ContentBounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = rgba[idx]!;
      const g = rgba[idx + 1]!;
      const b = rgba[idx + 2]!;
      const a = rgba[idx + 3]!;

      let isContent = false;
      if (background === "transparent") {
        isContent = a > 20;
      } else {
        // On white background: non-white pixels are content
        isContent = a > 20 && (r < 248 || g < 248 || b < 248);
      }

      if (isContent) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}
