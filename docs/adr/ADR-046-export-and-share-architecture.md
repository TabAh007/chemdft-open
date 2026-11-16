# ADR-046: Export and share architecture (Interactive HTML, report PDF, structure data, 3D PDF in testing, project archive, and sharing)

Status: Accepted for Release 0.0.13 (Interactive HTML is the primary cross-platform 3D export; 3D PDF is held back in testing behind server-side capability detection and marked NOT VERIFIED in Adobe Acrobat; legal review open for LGPL Asymptote). Date: 2026-11-04.
Related: [ADR-004](ADR-004-scientific-result-firewall.md), [ADR-012](ADR-012-dual-3d-renderers.md), [ADR-015](ADR-015-provenance-first-class.md), [ADR-026](ADR-026-canonical-structure-artifact.md), DECISIONS.md, [IMPORT_EXPORT_UX.md](../product/IMPORT_EXPORT_UX.md).

## Context

ChemDFT researchers require exporting and sharing their scientific findings across multiple modalities without sacrificing scientific integrity:
1. **Interactive Standalone HTML:** Primary first-class 3D format allowing rotatable, zoomable 3D inspection in any modern browser without external network requests or software installation.
2. **Static Report PDF:** Providing high-fidelity visual documentation, energies, geometries, and provenance readable in any standard PDF viewer.
3. **Interactive 3D PDF (Held Back in Testing):** ISO 32000-1 3D PDF with rotatable binary PRC streams for Adobe Acrobat / Reader. Held back behind server-side capability detection because Asymptote is not packaged in the production Linux Docker container and 3D rotation in Adobe Acrobat remains **NOT VERIFIED**.
4. **Structure and Data Files:** Formatted XYZ, SDF, MOL, SMILES and project archive (.zip) retaining full metadata and evidence provenance.
5. **2D Drawing Exports:** From the molecule editor (PNG, SVG, PDF, MOL/SDF/SMILES).
6. **Device Sharing and Text Sharing:** Web Share API, mailto, WhatsApp.

## Decisions

1. **Interactive Standalone HTML as First-Class Primary 3D Option:**
   - Single-file self-contained HTML embedding minified `3Dmol.js` (v2.5.5, BSD-2-Clause, 537 KB).
   - Zero external network requests (no CDNs, no external fonts, no analytics); works over `file://` offline.
   - Comprehensive interactive controls: rotate, zoom, pan, 4 representation modes (ball & stick, sticks, spheres, lines), labels, ChemDFT/CPK palettes, perspective/orthographic projection, reset, hide/show hydrogens, Save PNG, multi-structure switcher, provenance notice, and WebGL-missing fallback banner with 2D vector SVG.
2. **3D PDF Core Technology (PRC via Asymptote) & Capability Gate:**
   - Asymptote (LGPL-3.0-only) compiles 3D molecular ball-and-stick scenes into binary PRC streams (ISO 14739-1).
   - Server-side capability check (`GET /v1/export/capabilities` and HTTP 501 on `/v1/projects/{id}/export/3d-pdf`) ensures the backend safely reports 3D PDF availability.
   - On Linux production servers without Asymptote installed, 3D PDF is disabled and the UI displays the `IN TESTING — NOT AVAILABLE YET` status badge.
   - Toolchain discovery checks `CHEMDFT_ASYMPTOTE_BIN` and system PATH; hardcoded macOS developer paths are removed.
3. **PDF Assembly and Finishing (pikepdf and ReportLab):**
   - **ReportLab (BSD-3-Clause):** Generates publication-grade report layouts, typography, and tabular evidence data without heavy C dependencies (Pango/Cairo/GObject).
   - **pikepdf (MPL-2.0):** Wraps QPDF to manipulate PDF object trees, inject 3D annotations, attach 2D poster images (`/AP /N`), and embed `.xyz` / `.json` attachments.
   - **Pillow (MIT-CMU):** Generates 2D poster images and stills.
4. **Scientific Result Firewall and Provenance Preservation:**
   - Exports never synthesize, smooth, promote, or fabricate scientific results.
   - Every exported datum maintains its strict evidence label (`CALCULATED`, `USER_ENTERED · NOT OPTIMIZED`, `AI_HYPOTHESIS`).
   - Engine identities, versions, basis sets, functionals, charges, multiplicities, and unit annotations are preserved.
   - Citations use official software names, versions, and verified licenses; no unverified DOIs are claimed.
5. **Sharing Interfaces (Phase 1):**
   - Client-side Web Share API (`navigator.share`) with files where supported; falls back to download with an explanatory notice.
   - Email (`mailto:`) and WhatsApp share actions open pre-filled text drafts and explicitly inform the user that attachments cannot be added automatically.
   - Hosted read-only share links, token revocation, and server-sent emails are explicitly deferred to Phase 2.
6. **Rejected and Blocked Dependencies:**
   - **PyMuPDF (AGPLv3):** REJECTED due to AGPL copyleft conflict.
   - **MeshLab (GPLv3):** REJECTED due to GPL copyleft.
   - **Open Babel (GPLv2+):** BLOCKED pending explicit researcher approval.

## Known Limits & Verification Status

- **3D PDF Acrobat Interaction:** **NOT VERIFIED in Adobe Acrobat** (no machine with Adobe Acrobat was available; only the flat poster image is visually confirmed in standard viewers).
- **Production Server Toolchain:** 3D PDF is not enabled on the production Linux container (Debian Bookworm `asymptote` requires Dockerfile modification and rebuild, which is not approved).
- **Web Share API:** Depends on browser and OS support; desktop browsers without native share sheets fall back to direct download.
- **Mailto / WhatsApp:** Plain-text only; browsers cannot attach binary files to mailto links.
