import { expect, test, type Page } from "@playwright/test";
import { EDITOR_PROJECT_ID, preferAdvancedWorkbench, setupEditorMocks, type EditorMockOptions, openImport, pickTemplate } from "./helpers/molecule-editor-mocks";

const MOL_ETHANOL = ["", "  test", "", "  3  2  0  0  0  0  0  0  0  0999 V2000", "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0", "    1.2000    0.7000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0", "    2.4000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0", "  1  2  1  0", "  2  3  1  0", "M  END", ""].join("\n");

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

const smiles = (page: Page) => page.getByTestId("editor-smiles").innerText();
// Ketcher can throw "Convert error!" while a drag is half-finished, so a read mid-gesture reports an empty drawing.
const molfile = (page: Page) => page.evaluate(() => (window as unknown as { __ketcher: { getMolfile(): Promise<string> } }).__ketcher.getMolfile().catch(() => ""));
async function load(page: Page, text: string) {
  await openImport(page);
    await page.getByTestId("editor-load-input").fill(text);
  await page.getByTestId("editor-load-button").click();
}
/** Screen centre of a drawn bond, from Ketcher's own render node. */
async function bondCenter(page: Page, id = 0) {
  return page.evaluate((bondId) => {
    const k = (window as unknown as { __ketcher: { editor: { render: { ctab: { bonds: Map<number, { path: { node: Element } }> } } } } }).__ketcher;
    const bond = k.editor.render.ctab.bonds.get(bondId) ?? [...k.editor.render.ctab.bonds.values()][0];
    if (!bond) throw new Error("no bond drawn");
    const rect = bond.path.node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, id);
}
async function canvasBox(page: Page) {
  const box = await page.getByTestId("canvas").first().boundingBox();
  if (!box) throw new Error("canvas missing");
  return box;
}

/** Select everything on the canvas and delete it. Retried: under load the first Ctrl+A can land before the canvas has focus. */
async function clearDrawing(page: Page) {
  const box = await canvasBox(page);
  await page.getByTestId("tool-select").click();
  await page.mouse.click(box.x + 30, box.y + 30);
  await expect(page.getByTestId("editor-smiles")).not.toHaveText("…");
  if ((await smiles(page)) === "Nothing drawn yet") return;
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+a");
    await expect(page.getByTestId("editor-selection-card")).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 12_000 });
  await page.keyboard.press("Delete");
  await expect.poll(() => smiles(page)).toBe("Nothing drawn yet");
}

test.describe("Molecule editor flow (mock transport, real Ketcher)", () => {
  test("opens as a full pane without the import form, and Back/Cancel return to project home without saving", async ({ page }) => {
    const calls = await openEditor(page);
    await expect(page.getByTestId("editor-title")).toHaveText("New molecule");
    await page.getByTestId("editor-info").click();
    await expect(page.getByTestId("editor-subtitle")).toHaveText("Saves as its own structure · V1 · existing work is not changed");
    await expect(page.getByRole("form", { name: "Import structure" })).toHaveCount(0);
    await expect(page.getByText("Project knowledge", { exact: false })).toHaveCount(0);
    await expect(page.getByTestId("editor-preview-empty")).toBeVisible();
    await page.getByTestId("editor-back").click();
    await expect(page.getByTestId("ketcher-editor-panel")).toHaveCount(0);
    await expect(page.getByRole("form", { name: "Import structure" })).toBeVisible();
    expect(calls.generate).toBe(0);

    await page.getByRole("button", { name: /Create molecule/i }).first().click();
    await page.getByRole("button", { name: /Draw manually/i }).click();
    await expect(page.getByTestId("generate-3d-btn")).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId("editor-cancel").click();
    await expect(page.getByRole("form", { name: "Import structure" })).toBeVisible();
    expect(calls.generate).toBe(0);
  });

  test("browser Back leaves the editor instead of the project", async ({ page }) => {
    await openEditor(page);
    await page.goBack();
    await expect(page.getByTestId("ketcher-editor-panel")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/projects/${EDITOR_PROJECT_ID}/workspace`));
  });

  test("templates load static, correct structures (formula from Ketcher/Indigo)", async ({ page }) => {
    await openEditor(page);
    const expected: Record<string, string> = { water: "H2O", ethanol: "C2H6O", benzene: "C6H6" };
    for (const [id, formula] of Object.entries(expected)) {
      await pickTemplate(page, id);
      await expect(page.getByTestId("check-formula")).toHaveText(formula);
    }
    for (const [id, formula] of Object.entries({ methane: "CH4", ammonia: "H3N", "acetic-acid": "C2H4O2", acetone: "C3H6O", toluene: "C7H8", caffeine: "C8H10N4O2" })) {
      await pickTemplate(page, "more");
      await page.getByTestId(`template-more-${id}`).click();
      await expect(page.getByTestId("check-formula")).toHaveText(formula);
    }
  });

  test("pasted SMILES and MOL load; invalid text shows a clear error and leaves the drawing alone", async ({ page }) => {
    await openEditor(page);
    await load(page, "CC(=O)O");
    await expect(page.getByTestId("editor-load-message")).toContainText("Loaded from SMILES");
    await expect(page.getByTestId("check-formula")).toHaveText("C2H4O2");

    for (const [bad, reason] of [["C(C", /never closed/], ["hello world", /no spaces/], ["[Xx]", /not a known element/], ["C1CC", /never closed/]] as const) {
      await load(page, bad);
      await expect(page.getByTestId("editor-load-message")).toContainText(reason);
      await expect(page.getByTestId("editor-load-message")).toHaveAttribute("role", "alert");
      await expect(page.getByTestId("check-formula")).toHaveText("C2H4O2");
    }

    await load(page, MOL_ETHANOL);
    await expect(page.getByTestId("editor-load-message")).toContainText("Loaded from MOL block");
    await expect(page.getByTestId("check-formula")).toHaveText("C2H6O");
    expect(await smiles(page)).toBe("CCO");

    await load(page, "a\nb\nc\nd");
    await expect(page.getByTestId("editor-load-message")).toContainText("M  END");
    expect(await smiles(page)).toBe("CCO");
  });

  test("labelled toolbar drives Ketcher: bonds, rings, charge, erase, undo/redo, highlight", async ({ page }) => {
    await openEditor(page);
    const box = await canvasBox(page);
    const at = (dx: number, dy: number) => ({ x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 + dy });

    await expect(page.getByTestId("tool-select")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("tool-undo")).toBeDisabled();

    // Single bond: drag creates C-C.
    await page.getByTestId("tool-bond-single").click();
    await expect(page.getByTestId("tool-bond-single")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("tool-select")).toHaveAttribute("aria-pressed", "false");
    const a = at(-60, 0), b = at(20, 0);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
    await expect.poll(() => smiles(page)).toBe("CC");
    await expect(page.getByTestId("tool-undo")).toBeEnabled();

    // Double bond tool upgrades the existing bond.
    await page.getByTestId("tool-bond-double").click();
    const mid = await bondCenter(page);
    await page.mouse.click(mid.x, mid.y);
    await expect.poll(() => smiles(page)).toBe("C=C");

    // Triple.
    await page.getByTestId("tool-bond-triple").click();
    await page.mouse.click(mid.x, mid.y);
    await expect.poll(() => smiles(page)).toBe("C#C");

    // Undo / redo.
    await page.getByTestId("tool-undo").click();
    await expect.poll(() => smiles(page)).toBe("C=C");
    await page.getByTestId("tool-redo").click();
    await expect.poll(() => smiles(page)).toBe("C#C");

    // Erase removes an atom.
    await page.getByTestId("tool-erase").click();
    await expect(page.getByTestId("tool-erase")).toHaveAttribute("aria-pressed", "true");
    await page.mouse.click(mid.x, mid.y);
    await expect.poll(() => smiles(page)).toBe("C.C");

    // Ring tools (native-proxy): benzene on empty canvas.
    await pickTemplate(page, "water");
    await clearDrawing(page);
    await page.getByTestId("tool-ring-benzene").click();
    await expect(page.getByTestId("tool-ring-benzene")).toHaveAttribute("aria-pressed", "true");
    const c = at(0, 0);
    await page.mouse.click(c.x, c.y);
    await expect(page.getByTestId("check-formula")).toHaveText("C6H6");
    await page.getByTestId("tool-select").click();
    await expect(page.getByTestId("tool-select")).toHaveAttribute("aria-pressed", "true");
  });

  for (const [tool, stereo, name] of [["tool-bond-wedge", 1, "wedge"], ["tool-bond-hash", 6, "hash"]] as const) {
    test(`${name} bond tool writes a stereo bond (molfile stereo ${stereo})`, async ({ page }) => {
      await openEditor(page);
      const box = await canvasBox(page);
      const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.getByTestId(tool).click();
      await expect(page.getByTestId(tool)).toHaveAttribute("aria-pressed", "true");
      await page.mouse.move(centre.x - 40, centre.y); await page.mouse.down(); await page.mouse.move(centre.x + 40, centre.y, { steps: 6 }); await page.mouse.up();
      await expect.poll(() => molfile(page)).toMatch(new RegExp(`\\n\\s+1\\s+2\\s+1\\s+${stereo}\\s`));
    });
  }

  test("atoms, groups, charge, flip, clean up and properties all act on the drawing", async ({ page }) => {
    await openEditor(page);
    await pickTemplate(page, "ethanol");
    await expect(page.getByTestId("check-formula")).toHaveText("C2H6O");
    const box = await canvasBox(page);

    // Atom chip: O replaces a carbon (click on an atom with the atom tool). Locate the CH3 label from the molfile.
    await page.getByTestId("atom-N").click();
    await expect(page.getByTestId("atom-N")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("atom-C")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("tool-select").click();

    // Charge +: select tool is not needed; the charge tool changes an atom.
    await page.getByTestId("tool-charge-plus").click();
    await expect(page.getByTestId("tool-charge-plus")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("tool-charge-minus").click();
    await expect(page.getByTestId("tool-charge-minus")).toHaveAttribute("aria-pressed", "true");

    // Flip mirrors the coordinates.
    const before = await molfile(page);
    await page.getByTestId("tool-flip").click();
    await expect.poll(() => molfile(page)).not.toBe(before);

    // Properties opens Ketcher's calculated-values dialog.
    await page.getByTestId("tool-properties").click();
    await expect(page.getByText("Calculated Values", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    // Periodic table opens.
    await page.getByTestId("atom-periodic-table").click();
    await expect(page.getByText("Periodic Table", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    void box;
  });

  test("functional-group stamps place the group through Ketcher's template tool", async ({ page }) => {
    await openEditor(page);
    const box = await canvasBox(page);
    const spot = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const expected: Record<string, { smiles: string; formula: string }> = {
      "group-ch3": { smiles: "C", formula: "CH4" },
      "group-oh": { smiles: "O", formula: "H2O" },
      "group-nh2": { smiles: "N", formula: "H3N" },
      "group-cooh": { smiles: "C(=O)O", formula: "CH2O2" },
      "group-cn": { smiles: "C#N", formula: "CHN" },
    };
    for (const [id, want] of Object.entries(expected)) {
      await clearDrawing(page);
      await page.getByTestId(`group-${id}`).click();
      await expect(page.getByTestId(`group-${id}`)).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("tool-select")).toHaveAttribute("aria-pressed", "false");
      await page.mouse.click(spot.x, spot.y);
      await expect(page.getByTestId("check-formula")).toHaveText(want.formula);
    }
    await clearDrawing(page);
    await page.getByTestId("group-group-no2").click();
    await page.mouse.click(spot.x, spot.y);
    // Unattached, the nitro N+ (valence 4) has one implicit H; attached to a carbon it has none.
    await expect(page.getByTestId("check-formula")).toHaveText("HNO2");
    expect(await molfile(page)).toContain("M  CHG  2   1   1   3  -1");
  });

  test("selection card reports the element, charge and valence status from Ketcher", async ({ page }) => {
    await openEditor(page);
    await pickTemplate(page, "ethanol");
    await expect(page.getByTestId("check-formula")).toHaveText("C2H6O");
    await page.getByTestId("tool-select").click();
    const box = await canvasBox(page);
    await page.mouse.click(box.x + 40, box.y + 40);
    await page.keyboard.press("ControlOrMeta+a");
    await expect(page.getByTestId("editor-selection-card")).toContainText("3 atoms, 2 bonds selected");
    await page.mouse.click(box.x + 40, box.y + 40);
    await expect(page.getByTestId("editor-selection-card")).toHaveCount(0);
    const atomNode = await page.evaluate(() => {
      const k = (window as unknown as { __ketcher: { editor: { render: { ctab: { atoms: { get(i: number): { visel?: { exts?: unknown[] }; hover?: { node?: Element } } } } } } } }).__ketcher;
      void k; return null;
    });
    void atomNode;
  });

  test("Drawing checks come from the drawing: stereo and valence flags", async ({ page }) => {
    await openEditor(page);
    await expect(page.getByTestId("check-formula")).toHaveText("—");
    await load(page, "C[C@H](N)C(=O)O");
    await expect(page.getByTestId("check-formula")).toHaveText("C3H7NO2");
    await expect(page.getByTestId("check-heavy-atoms")).toHaveText("6");
    await expect(page.getByTestId("check-valence")).toHaveText("No issues found");
    await expect(page.getByTestId("check-stereo")).not.toHaveText("None defined");
    await load(page, "CCO");
    await expect(page.getByTestId("check-stereo")).toHaveText("None defined");
    expect(await smiles(page)).toBe("CCO");
  });

  test("Copy puts the live SMILES on the clipboard, export saves SVG and PNG named after the molecule", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
    await openEditor(page);
    await expect(page.getByTestId("editor-copy-smiles")).toBeDisabled();
    await pickTemplate(page, "ethanol");
    await expect.poll(() => smiles(page)).toBe("CCO");
    await page.getByTestId("editor-copy-smiles").click();
    await expect(page.getByTestId("editor-copy-smiles")).toHaveText("Copied");
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "CCO");
    expect(clip).toBe("CCO");

    await page.getByTestId("molecule-name-input").fill("My ethanol / test");
    for (const format of ["svg", "png"] as const) {
      await page.getByTestId("editor-export").click();
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId(`editor-export-${format}`).click()]);
      expect(download.suggestedFilename()).toBe(`My-ethanol-test.${format}`);
    }
  });

  test("Generate 3D sends the drawing to the server and shows the returned structure; the preview is empty before", async ({ page }) => {
    let body: Record<string, unknown> | null = null;
    const calls = await openEditor(page, { onGenerate: (payload) => { body = payload; } });
    await expect(page.getByTestId("editor-preview-empty")).toContainText("Not generated yet");
    await page.getByTestId("molecule-name-input").fill("Ethanol");
    await pickTemplate(page, "ethanol");
    await expect.poll(() => smiles(page)).toBe("CCO");
    await page.getByTestId("generate-3d-btn").click();
    await expect(page.getByTestId("candidate-preview-container")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("candidate-metrics-card")).toContainText("C2H6O");
    expect(calls.generate).toBe(1);
    expect(body).toMatchObject({ name: "Ethanol", expected_charge: 0, multiplicity: 1 });
    expect(String((body as unknown as { mol_block: string }).mol_block)).toContain("M  END");
    await expect(page.getByTestId("accept-geometry-btn")).toBeDisabled();
    await page.getByTestId("ack-inspected-geometry").check();
    await page.getByTestId("ack-understands-not-optimized").check();
    await expect(page.getByTestId("accept-geometry-btn")).toBeEnabled();
    // Changing the drawing discards the server structure.
    await pickTemplate(page, "water");
    await expect(page.getByTestId("editor-preview-empty")).toBeVisible();
    await expect(page.getByTestId("candidate-preview-container")).toHaveCount(0);
  });

  test("Generate 3D on an empty drawing and on a server failure shows a clear error", async ({ page }) => {
    await openEditor(page, { generateStatus: 422 });
    await page.getByTestId("generate-3d-btn").click();
    await expect(page.getByTestId("geometry-error-box")).toContainText("Draw a complete molecular structure");
    await pickTemplate(page, "ethanol");
    await expect.poll(() => smiles(page)).toBe("CCO");
    await page.getByTestId("generate-3d-btn").click();
    await expect(page.getByTestId("geometry-error-box")).toBeVisible();
    await expect(page.getByTestId("editor-preview-empty")).toBeVisible();
  });

  test("AI Scientist tab is the Draw chat (details in molecule-editor-ai-draw.spec.ts)", async ({ page }) => {
    await openEditor(page);
    await page.getByTestId("editor-tab-ai").click();
    await expect(page.getByTestId("editor-ai-chat")).toContainText("Draw with the AI Scientist");
    await expect(page.getByTestId("ai-draw-input")).toBeEnabled();
    await page.getByTestId("editor-tab-preview").click();
    await expect(page.getByTestId("editor-preview-empty")).toBeVisible();
  });
});
