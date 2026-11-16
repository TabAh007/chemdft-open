/**
 * Client-side 2D PDF drawing exporter for ChemDFT Molecule Editor.
 * Wraps canvas-rendered chemical drawings into an ISO 32000 compliant PDF document with
 * title, formula, provenance notice, and clean print layout.
 */

export async function createDrawingPdf(
  pngBlob: Blob,
  title: string,
  formula?: string,
): Promise<Blob> {
  const imgUrl = URL.createObjectURL(pngBlob);
  try {
    const img = new Image();
    img.src = imgUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load drawing image."));
    });

    const imgW = img.naturalWidth || 800;
    const imgH = img.naturalHeight || 600;

    const canvas = document.createElement("canvas");
    canvas.width = imgW;
    canvas.height = imgH;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, imgW, imgH);
      ctx.drawImage(img, 0, 0);
    }

    const jpegBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error("JPEG conversion failed."));
        },
        "image/jpeg",
        0.95,
      );
    });

    const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());

    // Page: Letter (612 x 792 pt)
    const pageWidth = 612;
    const pageHeight = 792;
    const margin = 54;
    const contentW = pageWidth - margin * 2; // 504 pt
    const maxImgH = 460;

    let drawW = contentW;
    let drawH = (imgH / imgW) * drawW;
    if (drawH > maxImgH) {
      drawH = maxImgH;
      drawW = (imgW / imgH) * drawH;
    }
    const posX = margin + (contentW - drawW) / 2;
    const posY = pageHeight - margin - 80 - drawH;

    const safeTitle = title.replace(/[()\\]/g, "");
    const safeFormula = (formula || "").replace(/[()\\]/g, "");
    const dateStr = new Date().toISOString().slice(0, 10);

    const streamText = `BT
/F1 18 Tf
${margin} 730 Td
(${safeTitle}) Tj
ET
BT
/F2 11 Tf
0.4 0.4 0.4 rg
${margin} 710 Td
(Formula: ${safeFormula}  ·  Exported: ${dateStr}  ·  ChemDFT Release 0.0.13) Tj
ET
q
${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${posX.toFixed(2)} ${posY.toFixed(2)} cm
/Im1 Do
Q
BT
/F2 9 Tf
0.5 0.5 0.5 rg
${margin} 50 Td
(ChemDFT Molecule Editor  ·  2D Vector & Raster Chemical Structure) Tj
ET
`;

    const streamBytes = new TextEncoder().encode(streamText);

    // Objects table
    const objects: Uint8Array[] = [];
    const offsets: number[] = [];
    let currentOffset = 9; // strlen("%PDF-1.4\n")

    function addObject(content: string, binaryStream?: Uint8Array): void {
      offsets.push(currentOffset);
      const head = `${offsets.length} 0 obj\n${content}\n`;
      let totalObj: Uint8Array;
      if (binaryStream) {
        const streamHeader = new TextEncoder().encode(`stream\n`);
        const streamFooter = new TextEncoder().encode(`\nendstream\nendobj\n`);
        const headBytes = new TextEncoder().encode(head);
        totalObj = new Uint8Array(
          headBytes.length + streamHeader.length + binaryStream.length + streamFooter.length,
        );
        totalObj.set(headBytes, 0);
        totalObj.set(streamHeader, headBytes.length);
        totalObj.set(binaryStream, headBytes.length + streamHeader.length);
        totalObj.set(streamFooter, headBytes.length + streamHeader.length + binaryStream.length);
      } else {
        totalObj = new TextEncoder().encode(`${head}endobj\n`);
      }
      objects.push(totalObj);
      currentOffset += totalObj.length;
    }

    // Obj 1: Catalog
    addObject(`<< /Type /Catalog /Pages 2 0 R >>`);

    // Obj 2: Pages
    addObject(`<< /Type /Pages /Kids [3 0 R] /Count 1 >>`);

    // Obj 3: Page
    addObject(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> /XObject << /Im1 7 0 R >> >> >>`,
    );

    // Obj 4: Content stream
    addObject(`<< /Length ${streamBytes.length} >>`, streamBytes);

    // Obj 5: Font F1 (Helvetica-Bold)
    addObject(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`);

    // Obj 6: Font F2 (Helvetica)
    addObject(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);

    // Obj 7: Image XObject
    addObject(
      `<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>`,
      jpegBytes,
    );

    // XRef & Trailer
    const xrefOffset = currentOffset;
    let xrefText = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) {
      xrefText += `${off.toString().padStart(10, "0")} 00000 n \n`;
    }
    xrefText += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    const xrefBytes = new TextEncoder().encode(xrefText);

    const pdfParts: Uint8Array[] = [new TextEncoder().encode("%PDF-1.4\n"), ...objects, xrefBytes];
    return new Blob(pdfParts as BlobPart[], { type: "application/pdf" });
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
}

