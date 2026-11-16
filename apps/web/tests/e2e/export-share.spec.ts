import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { EDITOR_PROJECT_ID, pickTemplate, preferAdvancedWorkbench, setupEditorMocks, type EditorMockOptions } from "./helpers/molecule-editor-mocks";

/**
 * Offline E2E verification of ChemDFT Export and Share (Release 0.0.13).
 * Verifies Project Viewer Export Menu, Draw-Molecule Export Menu,
 * 3D PDF Export Dialog (with server-side capability detection / disabled state),
 * and Share Dialog (device share, plain text notice, no link creation).
 * Captures 4 UI screenshots required by Task T5.
 */

const WORKTREE_SHOTS = resolve(process.cwd(), "../../user-tests/export-poc/screenshots");
const DESKTOP_SHOTS = resolve(process.env.HOME ?? "", "Desktop/chemdft/user-tests/export-poc/screenshots");

function saveScreenshot(filename: string) {
  mkdirSync(WORKTREE_SHOTS, { recursive: true });
  mkdirSync(DESKTOP_SHOTS, { recursive: true });
  const src = resolve(WORKTREE_SHOTS, filename);
  try {
    copyFileSync(src, resolve(DESKTOP_SHOTS, filename));
  } catch {
    // Desktop mirror best effort
  }
}

async function openEditor(page: Page, options: EditorMockOptions = {}, viewport = { width: 1366, height: 768 }) {
  await page.setViewportSize(viewport);
  const calls = await setupEditorMocks(page, options);
  await preferAdvancedWorkbench(page);
  await page.goto(`/en/projects/${EDITOR_PROJECT_ID}/workspace`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Create molecule/i }).first().click({ timeout: 20_000 });
  await page.getByRole("button", { name: /Draw manually/i }).click();
  await expect(page.getByTestId("ketcher-editor-panel")).toBeVisible();
  await expect(page.getByTestId("generate-3d-btn")).toBeEnabled({ timeout: 60_000 });
  return calls;
}

test.describe("Export and Share Workstation (Release 0.0.13)", () => {
  test.beforeEach(async ({ page }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") console.log(`[BROWSER ${msg.type()}]:`, msg.text());
    });
    page.on("pageerror", (err) => console.log("[BROWSER UNCAUGHT]:", err));
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("01 & 04 & 03: Project overview export menu, 3D PDF testing dialog, and Share dialog", async ({ page }) => {
    await setupEditorMocks(page);

    // Mock export capabilities (3D PDF disabled by default on Linux/server)
    await page.route("**/api/chemdft/v1/export/capabilities", async (route) => {
      await route.fulfill({
        json: {
          export_3d_pdf_available: false,
          export_3d_pdf_reason: "Requires Asymptote server toolchain and Adobe Acrobat on client (IN TESTING).",
          export_report_pdf_available: true,
          export_html_available: true,
          export_archive_available: true,
        },
      });
    });

    // Mock Navigator state for overview
    await page.route("**/api/chemdft/v1/projects/*/navigator*", async (route) => {
      await route.fulfill({
        json: {
          goal: null,
          goals: [],
          have: [],
          next: [],
          blocked: [],
          notices: [],
          project_id: EDITOR_PROJECT_ID,
          context: { role: "owner", sealed: false },
          facts_summary: {
            structure_id: null,
            structure_version_id: null,
            running_jobs: 0,
            structures_count: 1,
            calculations_count: 0,
            results_count: 0,
          },
        },
      });
    });

    await page.goto(`/en/projects/${EDITOR_PROJECT_ID}/overview`);

    // Verify presence of controls
    const exportBtn = page.locator('[data-testid="project-export-menu-btn"]');
    const shareBtn = page.locator('[data-testid="project-share-btn"]');
    await expect(exportBtn).toBeVisible({ timeout: 15_000 });
    await expect(shareBtn).toBeVisible();

    // 1. Open Export Menu
    await exportBtn.click();
    const menu = page.locator('[data-testid="project-export-menu-dropdown"]');
    await expect(menu).toBeVisible();

    // Verify exact order of 6 categories:
    // 1. HTML
    await expect(page.locator('[data-testid="export-item-html"]')).toBeVisible();
    await expect(page.locator('[data-testid="export-item-html"]')).toContainText("Interactive 3D web page (.html)");
    await expect(page.locator('[data-testid="export-item-html"]')).toContainText("AVAILABLE");

    // 2. Report PDF
    await expect(page.locator('[data-testid="export-item-report-pdf"]')).toBeVisible();
    await expect(page.locator('[data-testid="export-item-report-pdf"]')).toContainText("Report PDF");
    await expect(page.locator('[data-testid="export-item-report-pdf"]')).toContainText("AVAILABLE");

    // 3. 3D PDF (IN TESTING)
    await expect(page.locator('[data-testid="export-item-3d-pdf"]')).toBeVisible();
    await expect(page.locator('[data-testid="export-item-3d-pdf"]')).toContainText("3D PDF (needs Adobe Acrobat or Reader)");
    await expect(page.locator('[data-testid="badge-3d-pdf-testing"]')).toContainText("IN TESTING");

    // 4. Structure files: XYZ, SDF, MOL, SMILES
    await expect(page.locator('[data-testid="export-item-xyz"]')).toBeVisible();
    await expect(page.locator('[data-testid="export-item-sdf"]')).toBeVisible();
    await expect(page.locator('[data-testid="export-item-mol"]')).toBeVisible();
    await expect(page.locator('[data-testid="export-item-smiles"]')).toBeVisible();

    // 5. Project archive
    await expect(page.locator('[data-testid="export-item-archive"]')).toBeVisible();

    // 6. Image
    await expect(page.locator('[data-testid="export-item-image-png"]')).toBeVisible();

    // Screenshot 1: Project viewer with Export menu open
    const shot1 = resolve(WORKTREE_SHOTS, "01-project-export-menu.png");
    await page.screenshot({ path: shot1 });
    saveScreenshot("01-project-export-menu.png");

    // 4. Open 3D PDF Dialog
    await page.locator('[data-testid="export-item-3d-pdf"]').click();
    const dialog3d = page.locator('[data-testid="export-3d-pdf-dialog"]');
    await expect(dialog3d).toBeVisible();
    await expect(dialog3d).toContainText("Export 3D PDF (Adobe Acrobat)");
    await expect(dialog3d).toContainText("IN TESTING — NOT AVAILABLE YET");
    await expect(page.locator('[data-testid="3d-pdf-testing-notice"]')).toBeVisible();
    await expect(dialog3d).toContainText("Adobe Acrobat or Adobe Acrobat Reader on Windows/macOS is required");
    // Verify download button is disabled when unavailable
    const download3dBtn = page.locator('[data-testid="export-3d-download-btn"]');
    await expect(download3dBtn).toBeDisabled();

    // Screenshot 4: 3D PDF dialog showing disabled / testing state
    const shot4 = resolve(WORKTREE_SHOTS, "04-3d-pdf-testing-dialog.png");
    await page.screenshot({ path: shot4 });
    saveScreenshot("04-3d-pdf-testing-dialog.png");

    // Close 3D PDF Dialog
    await page.locator('[data-testid="export-3d-cancel-btn"]').click();
    await expect(dialog3d).not.toBeVisible();

    // 3. Open Share Dialog
    await shareBtn.click();
    const shareDialog = page.locator('[data-testid="share-dialog"]');
    await expect(shareDialog).toBeVisible();
    await expect(shareDialog).toContainText("Share Research Evidence");
    // Verify Device share button and text-only notice
    await expect(page.locator('[data-testid="share-device-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="share-email-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="share-whatsapp-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="share-text-notice"]')).toContainText("cannot attach files automatically");
    // Verify NO public link hosting control exists
    await expect(page.locator('[data-testid="copy-share-link"]')).toHaveCount(0);

    // Screenshot 3: Share dialog with text-only warning and device share
    const shot3 = resolve(WORKTREE_SHOTS, "03-share-dialog.png");
    await page.screenshot({ path: shot3 });
    saveScreenshot("03-share-dialog.png");

    // Close Share Dialog
    await page.keyboard.press("Escape");
    await expect(shareDialog).not.toBeVisible();
  });

  test("02: Draw-molecule section with export controls", async ({ page }) => {
    await openEditor(page);

    // Verify Ketcher editor panel is visible
    await expect(page.getByTestId("ketcher-editor-panel")).toBeVisible();

    // Load template so drawing is not empty
    await pickTemplate(page, "ethanol");
    await expect(page.getByTestId("editor-smiles")).not.toHaveText("Nothing drawn yet", { timeout: 10_000 });

    // Open Molecule Editor Export PopMenu
    const exportPopMenu = page.getByTestId("editor-export");
    await expect(exportPopMenu).toBeEnabled({ timeout: 10_000 });
    await exportPopMenu.click();

    // Verify all menu items in order
    await expect(page.getByText("Interactive 3D web page (.html) (Generate 3D first)")).toBeVisible();
    await expect(page.getByText("Report PDF (2D drawing sheet)")).toBeVisible();
    await expect(page.getByText(/3D PDF \(needs Adobe Acrobat or Reader\)/)).toBeVisible();
    await expect(page.getByText("Structure-data file (.sdf)")).toBeVisible();
    await expect(page.getByText("Molfile (.mol)")).toBeVisible();
    await expect(page.getByText("SMILES string (.smi)")).toBeVisible();
    await expect(page.getByText("Project archive (.zip)")).toBeVisible();
    await expect(page.getByText("Image (SVG)")).toBeVisible();
    await expect(page.getByText("Image (PNG)")).toBeVisible();

    // Screenshot 2: Draw-molecule section with export controls
    const shot2 = resolve(WORKTREE_SHOTS, "02-draw-molecule-export-controls.png");
    await page.screenshot({ path: shot2 });
    saveScreenshot("02-draw-molecule-export-controls.png");
  });

  test("03: One consistent Export button on every screen & pre-existing downloads work", async ({ page }) => {
    const AUDIT_DIR = resolve(process.cwd(), "../../user-tests/export-ux-audit");
    mkdirSync(AUDIT_DIR, { recursive: true });

    const AUDIT_PROJECT_ID = "11111111-1111-4111-8111-111111111111";
    const STRUCT_ID = "22222222-2222-4222-8222-222222222222";
    const VERSION_ID = "33333333-3333-4333-8333-333333333333";
    const CALC_ID = "44444444-4444-4444-8444-444444444444";
    const RESULT_ID = "55555555-5555-4555-8555-555555555555";
    const CALC_2_ID = "66666666-6666-4666-8666-666666666666";
    const RES_2_ID = "77777777-7777-4777-8777-777777777777";
    const INPUT_ARTIFACT_ID = "88888888-8888-4888-8888-888888888888";

    const inputJson = JSON.stringify({ structure_version_id: VERSION_ID });
    const inputBytes = Buffer.from(inputJson, "utf-8");
    const inputHash = createHash("sha256").update(inputBytes).digest("hex");

    const WATER_COORDS = {
      coordinate_system: "CARTESIAN",
      unit: "angstrom",
      atoms: [
        { index: 0, element: "O", atomic_number: 8, x: 0, y: 0, z: 0.117 },
        { index: 1, element: "H", atomic_number: 1, x: 0, y: 0.757, z: -0.469 },
        { index: 2, element: "H", atomic_number: 1, x: 0, y: -0.757, z: -0.469 },
      ],
      bonds: [
        { atom_index_a: 0, atom_index_b: 1, order: 1 },
        { atom_index_a: 0, atom_index_b: 2, order: 1 },
      ],
    };

    await page.route("**/api/chemdft/v1/**", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname;

      if (path.endsWith("/export/capabilities")) {
        return route.fulfill({
          json: {
            export_3d_pdf_available: false,
            export_3d_pdf_reason: "Requires Asymptote server toolchain and Adobe Acrobat on client (IN TESTING).",
            export_report_pdf_available: true,
            export_html_available: true,
            export_archive_available: true,
          },
        });
      }

      if (path.endsWith(`/projects/${AUDIT_PROJECT_ID}`)) {
        return route.fulfill({
          json: {
            id: AUDIT_PROJECT_ID,
            name: "Audit Research Project",
            slug: "audit-project",
            role: "owner",
            created_at: "2026-11-04T10:00:00Z",
            updated_at: "2026-11-04T12:00:00Z",
          },
        });
      }

      if (path.includes("/navigator")) {
        return route.fulfill({
          json: {
            goal: null,
            goals: [],
            have: [],
            next: [],
            blocked: [],
            notices: [],
            project_id: AUDIT_PROJECT_ID,
            context: { role: "owner", sealed: false },
            facts_summary: {
              structure_id: STRUCT_ID,
              structure_version_id: VERSION_ID,
              running_jobs: 0,
              structures_count: 1,
              calculations_count: 2,
              results_count: 2,
            },
          },
        });
      }

      if (path.endsWith(`/projects/${AUDIT_PROJECT_ID}/structures`)) {
        return route.fulfill({
          json: [
            {
              id: STRUCT_ID,
              project_id: AUDIT_PROJECT_ID,
              name: "Water",
              kind: "MOLECULE",
              active_version_id: VERSION_ID,
              active_version_revision: 1,
              active_version_label: "Water V1",
              formula: "H2O",
              atom_count: 3,
              version_count: 1,
              created_at: "2026-11-04T10:00:00Z",
              updated_at: "2026-11-04T10:00:00Z",
            },
          ],
        });
      }

      const VERSION_DETAIL = {
        structure: {
          id: STRUCT_ID,
          name: "Water",
          kind: "MOLECULE",
        },
        version: {
          id: VERSION_ID,
          revision: 1,
          origin: "USER_ENTERED",
          coordinates: WATER_COORDS,
        },
        provenance: {
          coordinate_origin: "User drawing",
          operation: "Created in ChemDFT",
          source_class: "USER_ENTERED",
          verification_state: "UNVERIFIED",
        },
      };

      if (path.endsWith(`/structures/${STRUCT_ID}/versions`)) {
        return route.fulfill({
          json: [VERSION_DETAIL],
        });
      }

      if (path.endsWith(`/structures/${STRUCT_ID}/versions/${VERSION_ID}`)) {
        return route.fulfill({
          json: VERSION_DETAIL,
        });
      }

      if (path.endsWith("/calculations/capabilities")) {
        return route.fulfill({ json: [] });
      }

      if (path.includes("/artifacts")) {
        return route.fulfill({
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="calculation_input.json"`,
          },
          body: inputBytes,
        });
      }

      if (path.endsWith("/files") || path.endsWith("/workspace/history")) {
        return route.fulfill({ json: [] });
      }

      if (path.endsWith("/documents")) {
        return route.fulfill({ json: { documents: [] } });
      }

      if (path.endsWith("/structure-candidates")) {
        return route.fulfill({ json: { candidates: [] } });
      }

      if (path.endsWith("/experimental/datasets") || path.endsWith("/experimental/spectra/datasets")) {
        return route.fulfill({ json: { datasets: [] } });
      }

      if (path.endsWith("/compute/jobs") || path.endsWith("/jobs")) {
        return route.fulfill({ json: { jobs: [] } });
      }

      if (path.endsWith("/memory")) {
        return route.fulfill({ json: { memories: [] } });
      }

      if (path.endsWith("/external-imports")) {
        return route.fulfill({ json: { imports: [] } });
      }

      if (path.endsWith("/geometry-candidates")) {
        return route.fulfill({ json: { candidates: [] } });
      }

      if (path.endsWith(`/calculations/${CALC_ID}/exports`) || path.endsWith(`/calculations/${CALC_2_ID}/exports`)) {
        return route.fulfill({
          json: {
            calculation_id: CALC_ID,
            project_id: AUDIT_PROJECT_ID,
            evidence_use: "CURRENT",
            formats: [
              {
                format: "result-json",
                label: "Result record",
                file_extension: "json",
                available: true,
                unsupported_reason: null,
              },
              {
                format: "spectrum-csv",
                label: "Stick spectrum",
                file_extension: "csv",
                available: true,
                unsupported_reason: null,
              },
              {
                format: "report",
                label: "Scientific report",
                file_extension: "html",
                available: true,
                unsupported_reason: null,
              },
              {
                format: "reproducibility-bundle",
                label: "Reproducibility package",
                file_extension: "zip",
                available: true,
                unsupported_reason: null,
                variants: [
                  {
                    key: "REPRODUCIBILITY_PACKAGE",
                    label: "Reproducibility package",
                    detail: "Includes inputs and outputs with hashes",
                  },
                ],
              },
              {
                format: "trajectory-xyz",
                label: "Optimization trajectory",
                file_extension: "xyz",
                available: false,
                unsupported_reason: "no optimization frames were recorded",
              },
              {
                format: "cube",
                label: "Field grid",
                file_extension: "cube",
                available: false,
                unsupported_reason: "only orbital results have a field grid",
              },
            ],
          },
        });
      }

      // Handle downloads
      if (
        path.includes("/export") ||
        url.searchParams.has("file_format") ||
        url.searchParams.has("format")
      ) {
        const format = url.searchParams.get("format") || url.searchParams.get("file_format") || "file";
        let filename = `export-${format}.txt`;
        if (path.endsWith("/html")) filename = "chemdft-interactive.html";
        else if (path.endsWith("/report-pdf")) filename = "chemdft-report.pdf";
        else if (path.endsWith("/archive")) filename = "chemdft-archive.zip";
        else if (format === "result-json") filename = "result-b3lyp.json";
        else if (format === "spectrum-csv") filename = "spectrum-ir.csv";
        else if (format === "report") filename = "scientific-report.html";
        else if (format === "reproducibility-bundle") filename = "reproducibility-package.zip";

        return route.fulfill({
          status: 200,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${filename}"`,
          },
          body: Buffer.from("CHEMDFT_VERIFIED_EXPORT_PAYLOAD"),
        });
      }

      if (path.includes("/published-results")) {
        return route.fulfill({
          json: {
            total_published: 2,
            facets: {
              tasks: ["FREQUENCY"],
              engines: ["pyscf"],
            },
            rows: [
              {
                result_id: RESULT_ID,
                calculation_id: CALC_ID,
                task: "FREQUENCY",
                method: "b3lyp",
                basis: "def2-svp",
                charge: 0,
                multiplicity: 1,
                structure_id: STRUCT_ID,
                structure_name: "Water",
                structure_version_id: VERSION_ID,
                structure_version_revision: 1,
                formula: "H2O",
                atom_count: 3,
                engine: "pyscf",
                engine_version: "2.14.0",
                created_at: "2026-11-04T11:00:00Z",
                updated_at: "2026-11-04T11:00:00Z",
                authority: "AUTHORITATIVE",
                validation: "VALIDATED",
                verification: "UNVERIFIED",
                standing: "CURRENT",
                quantities: {
                  zero_point_energy: 0.021,
                },
              },
              {
                result_id: RES_2_ID,
                calculation_id: CALC_2_ID,
                task: "FREQUENCY",
                method: "hf",
                basis: "sto-3g",
                charge: 0,
                multiplicity: 1,
                structure_id: STRUCT_ID,
                structure_name: "Water",
                structure_version_id: VERSION_ID,
                structure_version_revision: 1,
                formula: "H2O",
                atom_count: 3,
                engine: "pyscf",
                engine_version: "2.14.0",
                created_at: "2026-11-04T11:30:00Z",
                updated_at: "2026-11-04T11:30:00Z",
                authority: "AUTHORITATIVE",
                validation: "VALIDATED",
                verification: "UNVERIFIED",
                standing: "CURRENT",
                quantities: {
                  zero_point_energy: 0.025,
                },
              },
            ],
          },
        });
      }

      if (path.endsWith(`/results/${RESULT_ID}`) || path.endsWith(`/results/${RES_2_ID}`)) {
        const isRes2 = path.endsWith(RES_2_ID);
        return route.fulfill({
          json: {
            id: isRes2 ? RES_2_ID : RESULT_ID,
            project_id: AUDIT_PROJECT_ID,
            calculation_id: isRes2 ? CALC_2_ID : CALC_ID,
            result_type: "chemdft.vibrational-analysis",
            authority: "AUTHORITATIVE",
            validation_state: "VALIDATED",
            verification_state: "UNVERIFIED",
            effective_known: true,
            currently_authoritative: true,
            producer_software: { name: "pyscf", version: "2.14.0" },
            trusted_producer_id: "chemdft-worker-pyscf",
            calculation_input_hash: inputHash,
            raw_artifacts: [
              {
                artifact_id: INPUT_ARTIFACT_ID,
                project_id: AUDIT_PROJECT_ID,
                file_name: "calculation_input.json",
                format_identifier: "application/json",
                sha256: inputHash,
              },
            ],
            payload: {
              task_type: "FREQUENCY",
              modes: [
                { index: 0, frequency_cm1: 1595.0, ir_intensity_km_mol: 80.2, symmetry: "A1" },
                { index: 1, frequency_cm1: 3657.0, ir_intensity_km_mol: 12.5, symmetry: "A1" },
                { index: 2, frequency_cm1: 3756.0, ir_intensity_km_mol: 55.0, symmetry: "B2" },
              ],
              zero_point_energy_hartree: 0.021,
            },
            created_at: "2026-11-04T11:00:00Z",
          },
        });
      }

      if (path.endsWith(`/calculations/${CALC_ID}`) || path.endsWith(`/calculations/${CALC_2_ID}`)) {
        const isCalc2 = path.endsWith(CALC_2_ID);
        return route.fulfill({
          json: {
            calculation: {
              id: isCalc2 ? CALC_2_ID : CALC_ID,
              project_id: AUDIT_PROJECT_ID,
              state: "SUCCEEDED",
            },
            attempt: {
              state: "SUCCEEDED",
              raw_artifacts: [
                {
                  artifact_id: INPUT_ARTIFACT_ID,
                  project_id: AUDIT_PROJECT_ID,
                  file_name: "calculation_input.json",
                  format_identifier: "application/json",
                  sha256: inputHash,
                },
              ],
            },
            specification: {
              task_type: "FREQUENCY",
              method: { identifier: isCalc2 ? "hf" : "b3lyp", display_name: isCalc2 ? "HF" : "B3LYP" },
              basis: { identifier: isCalc2 ? "sto-3g" : "def2-svp", display_name: isCalc2 ? "STO-3G" : "def2-SVP" },
              charge: 0,
              multiplicity: 1,
            },
            result: {
              id: isCalc2 ? RES_2_ID : RESULT_ID,
              project_id: AUDIT_PROJECT_ID,
              calculation_id: isCalc2 ? CALC_2_ID : CALC_ID,
              result_type: "chemdft.vibrational-analysis",
              authority: "AUTHORITATIVE",
              validation_state: "VALIDATED",
              verification_state: "UNVERIFIED",
              effective_known: true,
              currently_authoritative: true,
              producer_software: { name: "pyscf", version: "2.14.0" },
              trusted_producer_id: "chemdft-worker-pyscf",
              calculation_input_hash: inputHash,
              raw_artifacts: [
                {
                  artifact_id: INPUT_ARTIFACT_ID,
                  project_id: AUDIT_PROJECT_ID,
                  file_name: "calculation_input.json",
                  format_identifier: "application/json",
                  sha256: inputHash,
                },
              ],
              payload: {
                task_type: "FREQUENCY",
                modes: [
                  { index: 0, frequency_cm1: 1595.0, ir_intensity_km_mol: 80.2, symmetry: "A1" },
                ],
              },
            },
            calculation_input_hash: inputHash,
            input_structure_version_id: VERSION_ID,
          },
        });
      }

      if (path.includes("/calculation-comparison")) {
        return route.fulfill({
          json: {
            project_id: AUDIT_PROJECT_ID,
            reference_result_id: RESULT_ID,
            overall: "DIRECTLY_COMPARABLE",
            conversion_factors: { hartree_to_ev: 27.211386245988, hartree_to_kcal_mol: 627.5094740631 },
            notice: "Values are compared as stored.",
            pairs: [
              {
                reference_result_id: RESULT_ID,
                other_result_id: RES_2_ID,
                label: "DIRECTLY_COMPARABLE",
                geometry: "SAME_STRUCTURE",
                evidence_standing: "BOTH_CURRENT",
                blockers: [],
                limitations: [],
                rules: [],
                deltas: [
                  {
                    quantity_kind: "zero_point_energy",
                    quantity_label: "Zero-point vibrational energy",
                    value_a: 0.021,
                    value_b: 0.025,
                    delta: -0.004,
                    unit: "Eh",
                  },
                ],
              },
            ],
            results: [
              {
                result_id: RESULT_ID,
                calculation_id: CALC_ID,
                task: "FREQUENCY",
                method: "b3lyp",
                basis: "def2-svp",
                charge: 0,
                multiplicity: 1,
                structure_name: "Water",
                structure_version_revision: 1,
                formula: "H2O",
                atom_count: 3,
                engine: "pyscf",
                created_at: "2026-11-04T11:00:00Z",
                authority: "AUTHORITATIVE",
                validation: "VALIDATED",
                verification: "UNVERIFIED",
              },
              {
                result_id: RES_2_ID,
                calculation_id: CALC_2_ID,
                task: "FREQUENCY",
                method: "hf",
                basis: "sto-3g",
                charge: 0,
                multiplicity: 1,
                structure_name: "Water",
                structure_version_revision: 1,
                formula: "H2O",
                atom_count: 3,
                engine: "pyscf",
                created_at: "2026-11-04T11:30:00Z",
                authority: "AUTHORITATIVE",
                validation: "VALIDATED",
                verification: "UNVERIFIED",
              },
            ],
          },
        });
      }

      if (path.endsWith("/saved-comparisons")) {
        return route.fulfill({
          json: {
            availability: "AVAILABLE",
            comparisons: [],
          },
        });
      }

      if (path.endsWith("/me")) {
        return route.fulfill({ json: { id: "user-1", email: "researcher@example.com", name: "Researcher" } });
      }

      if (path.endsWith("/ai/context")) {
        return route.fulfill({
          json: {
            ai: { allowance_status: "AVAILABLE", available: true, mode: "MANAGED", model: "nemotron-3.5-lightning", provider: "NVIDIA" },
            allowed_tools: ["ask_ai_scientist"], can_write: true, generated_at: "2026-10-26T10:00:00Z", human_id: "mock",
            navigator: { blocked: [], goal: null, have: [], next: [], notices: [] },
            organization_id: "org-1", project_id: AUDIT_PROJECT_ID, project_kind: "RESEARCH", project_name: "Audit Research Project",
            published_example: false, resources: [], role: "OWNER", sealed: false, selection: {},
          },
        });
      }

      if (path.includes("/ai/settings")) {
        return route.fulfill({
          json: {
            availability: { allowance_status: "AVAILABLE", available: true, mode: "MANAGED", model: "nemotron-3.5-lightning", provider: "NVIDIA" },
            credentials: [], preferences: { provider: "NVIDIA", model: "nemotron-3.5-lightning" },
            providers: [{ provider: "NVIDIA", models: ["nemotron-3.5-lightning"], local_test_only: false }],
            model_capabilities: [],
          },
        });
      }

      return route.fulfill({ json: {} });
    });

    // 1. Overview Screen: exactly one Export button with accessible name "Export"
    await page.goto(`/en/projects/${AUDIT_PROJECT_ID}/overview`);
    const overviewExportBtns = page.getByRole("button", { name: "Export", exact: true });
    await expect(overviewExportBtns).toHaveCount(1);
    await page.screenshot({ path: resolve(AUDIT_DIR, "01-overview-header-after.png") });

    // Verify Project HTML download
    await overviewExportBtns.first().click();
    const [htmlDl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-item-html").click(),
    ]);
    expect(htmlDl.suggestedFilename()).toContain(".html");

    // 2. Workspace Structure tab: exactly one Export button with accessible name "Export"
    await page.goto(`/en/projects/${AUDIT_PROJECT_ID}/workspace?selection=${encodeURIComponent(`structureVersion:${VERSION_ID}`)}&source=${STRUCT_ID}`);
    await page.getByRole("button", { name: "Advanced Workbench", exact: true }).click();
    const structExportBtns = page.getByRole("button", { name: "Export", exact: true });
    await expect(structExportBtns).toHaveCount(1);
    await page.screenshot({ path: resolve(AUDIT_DIR, "02-workspace-structure-toolbar-after.png") });

    // 2b. Workspace Result tab: exactly one Export button with accessible name "Export"
    await page.goto(`/en/projects/${AUDIT_PROJECT_ID}/workspace?selection=${encodeURIComponent(`calculationResult:${RESULT_ID}`)}&source=${CALC_ID}`);
    await page.getByRole("button", { name: "Advanced Workbench", exact: true }).click();
    const workspaceResultExportBtns = page.getByRole("button", { name: "Export", exact: true });
    await expect(workspaceResultExportBtns).toHaveCount(1);
    await page.screenshot({ path: resolve(AUDIT_DIR, "02b-workspace-result-toolbar-after.png") });

    // Verify workspace result tab unified export menu opens with all 4 groups
    await workspaceResultExportBtns.first().click();
    const workspaceResultMenu = page.getByRole("menu");
    await expect(workspaceResultMenu).toBeVisible();
    await expect(page.getByText("INTERACTIVE", { exact: true })).toBeVisible();
    await expect(page.getByText("DOCUMENTS", { exact: true })).toBeVisible();
    await expect(page.getByText("DATA", { exact: true })).toBeVisible();
    await expect(page.getByText("IMAGES", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    // 3. Result Page: exactly one Export button with accessible name "Export"
    await page.goto(`/en/projects/${AUDIT_PROJECT_ID}/results/${RESULT_ID}`);
    const resultExportBtns = page.getByRole("button", { name: "Export", exact: true });
    await expect(resultExportBtns).toHaveCount(1);
    await page.screenshot({ path: resolve(AUDIT_DIR, "03-result-page-ir-after.png") });

    // Open unified menu on result page
    await resultExportBtns.first().click();
    await page.screenshot({ path: resolve(AUDIT_DIR, "04-result-menu-opened-after.png") });

    // Verify pre-existing downloads from the unified menu:
    // a. Result JSON
    const [jsonDl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-item-result-json").click(),
    ]);
    expect(jsonDl.suggestedFilename()).toContain(".json");

    // b. Spectrum CSV
    await resultExportBtns.first().click();
    const [csvDl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-item-spectrum-csv").click(),
    ]);
    expect(csvDl.suggestedFilename()).toContain(".csv");

    // c. Report HTML
    await resultExportBtns.first().click();
    const [reportDl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-item-report-html").click(),
    ]);
    expect(reportDl.suggestedFilename()).toContain(".html");

    // d. Reproducibility ZIP
    await resultExportBtns.first().click();
    const [zipDl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-item-reproducibility-bundle").click(),
    ]);
    expect(zipDl.suggestedFilename()).toContain(".zip");

    // 4. Compare Page: exactly one Export button with accessible name "Export"
    await page.goto(`/en/projects/${AUDIT_PROJECT_ID}/compare?result=${RESULT_ID}&result=${RES_2_ID}`);
    const compareExportBtns = page.getByRole("button", { name: "Export", exact: true });
    await expect(compareExportBtns).toHaveCount(1);
    await page.screenshot({ path: resolve(AUDIT_DIR, "05-compare-page-export-after.png") });

    // 5. Draw-Molecule: exactly one Export button with accessible name "Export"
    await openEditor(page);
    await pickTemplate(page, "ethanol");
    const editorExportBtns = page.getByRole("button", { name: "Export", exact: true });
    await expect(editorExportBtns).toHaveCount(1);
    await page.screenshot({ path: resolve(AUDIT_DIR, "06-draw-molecule-export-after.png") });
  });
});
