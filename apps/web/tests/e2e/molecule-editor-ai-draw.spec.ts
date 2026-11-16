import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import { EDITOR_PROJECT_ID, preferAdvancedWorkbench, setupEditorMocks } from "./helpers/molecule-editor-mocks";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => JSON.parse(readFileSync(join(here, "fixtures", "ai-draw", `${name}.json`), "utf8")) as Record<string, unknown>;

type DrawCall = { content: string; molfile: string | null; previous_molfile: string | null; history: { role: string; content: string }[] };

/** Mock transport for the draw endpoint: a queue of canned server responses (real RDKit output, see tools/gen_draw_fixtures.py). */
async function openEditor(page: Page, script: (Record<string, unknown> | { status: number; json: unknown })[], viewport = { width: 1366, height: 768 }) {
  await page.setViewportSize(viewport);
  await setupEditorMocks(page);
  const calls: DrawCall[] = [];
  const queue = [...script];
  await page.route("**/api/chemdft/v1/projects/*/ai/conversations", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({ status: 201, json: { conversation: { id: "conv-1", project_id: EDITOR_PROJECT_ID, title: "Drawing assistant", created_at: "2026-11-02T10:00:00Z", updated_at: "2026-11-02T10:00:00Z" }, messages: [], latest_run: null } });
  });
  await page.route("**/api/chemdft/v1/projects/*/ai/conversations/*/draw", async (route: Route) => {
    calls.push(JSON.parse(route.request().postData() ?? "{}") as DrawCall);
    const next = queue.shift() ?? fixture("refused");
    if ("json" in next && typeof next.status === "number") return route.fulfill({ status: next.status, json: next.json });
    return route.fulfill({ json: next });
  });
  await preferAdvancedWorkbench(page);
  await page.goto(`/en/projects/${EDITOR_PROJECT_ID}/workspace`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Create molecule/i }).first().click({ timeout: 20_000 });
  await page.getByRole("button", { name: /Draw manually/i }).click();
  await expect(page.getByTestId("ketcher-editor-panel")).toBeVisible();
  await expect(page.getByTestId("generate-3d-btn")).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("editor-tab-ai").click();
  return calls;
}

const smiles = (page: Page) => page.getByTestId("editor-smiles").innerText();
async function ask(page: Page, text: string) {
  await page.getByTestId("ai-draw-input").fill(text);
  await page.getByTestId("ai-draw-send").click();
}
async function settled(page: Page) {
  await expect(page.getByTestId("ai-draw-send")).toHaveText("Send", { timeout: 30_000 });
}

test.describe("AI Scientist Draw mode (mock transport, real Ketcher)", () => {
  test("draw ethanol: working state, steps applied one by one, banner, labels, live Drawing checks", async ({ page }) => {
    const calls = await openEditor(page, [fixture("ethanol")]);
    await ask(page, "draw ethanol");
    await expect(page.getByTestId("ai-draw-message-user")).toHaveText("draw ethanol");
    await expect(page.getByTestId("ai-draw-message-assistant")).toBeVisible();
    await settled(page);
    await expect(page.getByTestId("ai-draw-label")).toHaveText("AI-drafted · schematic");
    const steps = page.getByTestId("ai-draw-step");
    await expect(steps).toHaveCount(3);
    for (let i = 0; i < 3; i += 1) await expect(steps.nth(i)).toHaveAttribute("data-state", "applied");
    await expect.poll(() => smiles(page)).toBe("CCO");
    await expect(page.getByTestId("check-formula")).toHaveText("C2H6O");
    await expect(page.getByTestId("ai-draft-banner")).toBeVisible();
    await expect(page.getByTestId("ai-draft-banner")).toContainText("AI-drafted · schematic");
    await expect(page.getByTestId("ai-draw-usage")).toContainText("nemotron-3.5-lightning-30b-a3b");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ content: "draw ethanol", molfile: null, previous_molfile: null });
  });

  test("Undo last step, Undo all and Keep use their own snapshot trail", async ({ page }) => {
    await openEditor(page, [fixture("ethanol")]);
    await ask(page, "draw ethanol");
    await settled(page);
    await expect.poll(() => smiles(page)).toBe("CCO");
    await page.getByTestId("ai-draft-undo-last").click();
    await expect.poll(() => smiles(page)).toBe("CC");
    await expect(page.getByTestId("ai-draw-step").nth(2)).toHaveAttribute("data-state", "undone");
    await page.getByTestId("ai-draft-undo-last").click();
    await expect.poll(() => smiles(page)).toMatch(/^C\.C$|^C\.C/);
    await page.getByTestId("ai-draft-undo-all").click();
    await expect.poll(() => smiles(page)).toBe("Nothing drawn yet");
    await expect(page.getByTestId("ai-draft-banner")).toHaveCount(0);
  });

  test("Keep clears the marker and leaves the drawing editable", async ({ page }) => {
    await openEditor(page, [fixture("ethanol")]);
    await ask(page, "draw ethanol");
    await settled(page);
    await page.getByTestId("ai-draft-keep").click();
    await expect(page.getByTestId("ai-draft-banner")).toHaveCount(0);
    await expect.poll(() => smiles(page)).toBe("CCO");
    // Ketcher's own undo keeps working after Keep.
    await page.getByTestId("tool-undo").click();
    await expect(page.getByTestId("editor-smiles")).not.toHaveText("");
  });

  test("a follow-up request sends the current drawing and the previous snapshot; steps accumulate", async ({ page }) => {
    const calls = await openEditor(page, [fixture("ethanol"), fixture("add-oh-on-ethanol")]);
    await ask(page, "draw ethanol");
    await settled(page);
    await ask(page, "add an OH on atom 1");
    await settled(page);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.molfile).toContain("M  END");
    expect(calls[1]?.previous_molfile).toContain("M  END"); // the drawing before the first AI action (empty canvas)
    expect(calls[1]?.history).toEqual([{ role: "user", content: "draw ethanol" }, { role: "assistant", content: "Drew ethanol." }]);
    await expect(page.getByTestId("check-formula")).toHaveText("C2H6O2");
    await page.getByTestId("ai-draft-undo-last").click();
    await expect.poll(() => smiles(page)).toBe("CCO");
  });

  test("clarify buttons send the choice as the next message and each option draws", async ({ page }) => {
    const calls = await openEditor(page, [fixture("clarify"), fixture("methanediamine")]);
    await ask(page, "6 H + 2 N + 1 C");
    const options = page.getByTestId("ai-draw-clarify-option");
    await expect(options).toHaveCount(2);
    await expect(page.getByTestId("ai-draft-banner")).toHaveCount(0);
    await options.first().click();
    await settled(page);
    expect(calls[1]?.content).toBe("Draw 1 C, 2 N and 6 H as methanediamine");
    await expect.poll(() => smiles(page)).toBe("NCN");
    await expect(page.getByTestId("check-formula")).toHaveText("CH6N2");
  });

  test("a proposed named structure is labelled as an AI proposal, never as looked up", async ({ page }) => {
    await openEditor(page, [fixture("caffeine")]);
    await ask(page, "draw caffeine");
    await settled(page);
    await expect(page.getByTestId("ai-draw-proposal")).toHaveText("AI-proposed structure for 'caffeine' — verify against a trusted source before use");
  });

  test("a partial plan applies only the validated steps and shows the failure", async ({ page }) => {
    await openEditor(page, [fixture("partial")]);
    await ask(page, "draw a five-valent carbon");
    await settled(page);
    await expect(page.getByTestId("ai-draw-step").nth(0)).toHaveAttribute("data-state", "applied");
    await expect(page.getByTestId("ai-draw-step").nth(1)).toHaveAttribute("data-state", "failed");
    await expect(page.getByTestId("ai-draw-message-assistant")).toContainText("valence 5"); // the reply carries the reason once, not again in the step
    await expect.poll(() => smiles(page)).toBe("C");
  });

  test("a refusal changes nothing", async ({ page }) => {
    await openEditor(page, [fixture("refused")]);
    await ask(page, "what is the HOMO energy");
    await settled(page);
    await expect(page.getByTestId("ai-draw-message-assistant")).toContainText("Evidence");
    await expect(page.getByTestId("ai-draft-banner")).toHaveCount(0);
    await expect(page.getByTestId("editor-smiles")).toHaveText("Nothing drawn yet");
  });

  test("an unavailable AI shows a calm state and keeps hand drawing", async ({ page }) => {
    await openEditor(page, [{ status: 503, json: { detail: { code: "AI_UNAVAILABLE", message: "The selected AI mode/provider is unavailable." } } }]);
    await ask(page, "draw ethanol");
    await expect(page.getByTestId("ai-draw-notice")).toContainText("not available");
    await expect(page.getByTestId("ai-draw-unavailable")).toBeVisible();
    await expect(page.getByTestId("ai-draw-input")).toBeDisabled();
    await expect(page.getByTestId("generate-3d-btn")).toBeEnabled();
  });

  test("a server without the draw route (404) shows a plain message, not a raw status", async ({ page }) => {
    await openEditor(page, [{ status: 404, json: { detail: "Not Found" } }]);
    await ask(page, "hey how are you?");
    await expect(page.getByTestId("ai-draw-notice")).toHaveText(/not available on this server yet/);
    await expect(page.getByTestId("ai-draw-notice")).not.toContainText("404");
    await expect(page.getByTestId("ai-draw-input")).toBeEnabled();
  });

  test("a greeting gets the friendly assistant reply and changes nothing", async ({ page }) => {
    const reply = "Hi! I'm the drawing assistant. I draw and edit the molecule in this editor: try \"draw ethanol\".";
    await openEditor(page, [{ status: "NO_CHANGE", reply, steps: [], schema_version: "1.0.0", label: "AI-drafted · schematic" }]);
    await ask(page, "hey how are you?");
    await settled(page);
    await expect(page.getByTestId("ai-draw-message-assistant")).toContainText("draw ethanol");
    await expect(page.getByTestId("ai-draw-message-assistant")).toContainText("Nothing to draw");
    await expect(page.getByTestId("ai-draft-banner")).toHaveCount(0);
  });

  test("reduced motion applies the plan at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openEditor(page, [fixture("ethanol")]);
    await ask(page, "draw ethanol");
    await settled(page);
    await expect.poll(() => smiles(page)).toBe("CCO");
    await expect(page.getByTestId("ai-draw-step").nth(0)).toHaveAttribute("data-state", "applied");
    await page.getByTestId("ai-draft-undo-last").click();
    await expect.poll(() => smiles(page)).toBe("CC");
  });

  test("keyboard path: type, Enter sends, banner buttons reachable and activatable", async ({ page }) => {
    await openEditor(page, [fixture("ethanol")]);
    await page.getByTestId("ai-draw-input").focus();
    await page.keyboard.type("draw ethanol");
    await page.keyboard.press("Enter");
    await settled(page);
    await page.getByTestId("ai-draft-undo-last").focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => smiles(page)).toBe("CC");
    await page.getByTestId("ai-draft-keep").focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("ai-draft-banner")).toHaveCount(0);
    for (const id of ["ai-draw-input", "ai-draw-send"]) await expect(page.getByTestId(id)).toHaveAccessibleName(/.+/);
  });

  test("Generate 3D after an AI drawing sends the drawn molfile", async ({ page }) => {
    await openEditor(page, [fixture("ethanol")]);
    await ask(page, "draw ethanol");
    await settled(page);
    const request = page.waitForRequest((r) => r.url().endsWith("/geometry-candidates") && r.method() === "POST");
    await page.getByTestId("generate-3d-btn").click();
    const body = JSON.parse((await request).postData() ?? "{}") as { mol_block: string };
    expect(body.mol_block).toContain("M  END");
    expect(body.mol_block.match(/ C {3}0/g)?.length).toBe(2);
  });
});
