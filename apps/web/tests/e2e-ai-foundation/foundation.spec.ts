import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import axe from "axe-core";
import { choosePlanMode } from "../e2e/ai-composer";
const artifacts = resolve("../../output/pf7-review");
const root = "/api/chemdft/v1";
const h2 = "2\nUser supplied H2 fixture\nH 0 0 0\nH 0 0 0.74\n";
async function preference(request: APIRequestContext, mode = "MANAGED", provider = "fake") {
  const result = await request.put(`${root}/ai/settings`, { data: { mode, provider, model: provider === "fake" ? "fake-standard" : "gpt-4o-mini" } });
  expect(result.ok(), await result.text()).toBe(true);
}
async function project(request: APIRequestContext) {
  const created = await request.post(`${root}/projects`, { data: { name: "PF-7 isolated H₂", slug: `pf7-${crypto.randomUUID()}` } });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const imported = await request.post(`${root}/projects/${id}/structures/imports`, { multipart: { upload: { name: "h2.xyz", mimeType: "chemical/x-xyz", buffer: Buffer.from(h2) }, file_format: "XYZ", structure_name: "H₂ fixture", idempotency_key: crypto.randomUUID() } });
  expect(imported.status()).toBe(201);
  return id as string;
}
async function openAI(page: Page, id: string) {
  await page.goto(`/en/projects/${id}/workspace`);
  if (await page.getByTestId("mode-toggle-guided").isVisible()) await page.getByTestId("mode-toggle-guided").click();
  await expect(page.getByTestId("mode-toggle-guided")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "AI Scientist Copilot", exact: true }).click();
  await expect(page.getByTestId("ai-provider-state")).toBeVisible();
}
async function capture(page: Page, name: string) {
  await expect(page.getByTestId("ai-pending-message")).toHaveCount(0);
  await page.screenshot({ path: resolve(artifacts, name), animations: "disabled" });
}
async function audit(page: Page, scope: string) {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async selector => (await (window as typeof window & { axe: typeof axe }).axe.run(selector, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), scope);
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function readable(page: Page, selector: string) {
  const element = page.locator(selector);
  const box = await element.boundingBox();
  if (!box) return false;
  return box.y >= 0 && box.y + box.height <= page.viewportSize()!.height && await element.evaluate(el => { const r=el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); });
}
async function scrollApproval(page: Page) {
  const thread = page.locator(".ai-conversation-scroll");
  const box = await thread.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  for (let i = 0; i < 20 && !(await readable(page, '[data-testid="ai-reject-button"]')); i++) { await page.mouse.wheel(0, 450); await page.waitForTimeout(80); }
  expect(await readable(page, '[data-testid="ai-approve-button"]')).toBe(true);
  expect(await readable(page, '[data-testid="ai-reject-button"]')).toBe(true);
}

test.beforeAll(() => mkdirSync(artifacts, { recursive: true }));
test("private BYOK add, masked replacement, invalid key, revoke; mobile settings; no storage or console leak", async ({ page, request }) => {
  await preference(request);
  const consoleMessages: string[] = [];
  page.on("console", message => consoleMessages.push(message.text()));
  const fake = "pf7-fake-browser-only-credential";
  await page.goto("/en/settings/ai");
  await expect(page.getByTestId("ai-provider-status")).toHaveAttribute("data-mode", "MANAGED");
  await expect(page.getByTestId("ai-provider-status")).toHaveAttribute("data-provider", "fake");
  await capture(page, "06-managed-local-test.png");
  const model = page.getByTestId("ai-settings-model");
  await model.selectOption(await model.locator("option").evaluateAll((options) => (options as HTMLOptionElement[]).find((o) => o.value.startsWith("openai::"))!.value));
  await page.getByRole("combobox", { name: "AI source", exact: true }).selectOption("BYOK");
  await page.getByRole("button", { name: "Save AI preferences" }).click();
  await expect(page.getByTestId("ai-provider-status")).toHaveAttribute("data-error-code", "BYOK_KEY_MISSING");
  await capture(page, "07-byok-configuration.png");
  await page.getByLabel("Provider API key").fill(fake);
  await page.getByRole("button", { name: "Save key", exact: true }).click();
  await expect(page.getByLabel("Provider API key")).toHaveValue("");
  await expect(page.getByTestId("ai-key-status")).toHaveAttribute("data-status", "CONFIGURED");
  await expect(page.getByTestId("ai-key-status")).not.toContainText(fake);
  await capture(page, "08-byok-masked.png");
  await audit(page, '[data-testid="ai-settings-panel"]');
  await page.getByLabel("Provider API key").fill("pf7-invalid-fake-only");
  await page.getByRole("button", { name: "Replace key" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Key saved" })).toBeVisible();
  const id = await project(request);
  await openAI(page, id);
  await page.getByTestId("ai-prompt-input").fill("Explain a qualitative concept.");
  await choosePlanMode(page, { general: true });
  await page.getByTestId("ai-ask-button").click();
  await expect(page.getByText(/BYOK.*(failed|invalid)|credential.*(invalid|rejected)/i).first()).toBeVisible();
  await capture(page, "09-byok-error.png");
  const state = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(JSON.stringify(state)).not.toContain(fake);
  expect(consoleMessages.join("\n")).not.toContain(fake);
  await page.goto("/en/settings/ai");
  await page.getByRole("button", { name: "Revoke key" }).click();
  await expect(page.getByTestId("ai-key-status")).toHaveAttribute("data-status", "REVOKED");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Provider API key").fill(fake);
  await page.getByRole("button", { name: "Save key", exact: true }).click();
  await expect(page.getByTestId("ai-key-status")).toHaveAttribute("data-status", "CONFIGURED");
  await page.mouse.move(200, 400);
  await page.mouse.wheel(0, -10000);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeInViewport();
  await capture(page, "12-mobile-byok.png");
  await page.getByTestId("ai-key-status").scrollIntoViewIfNeeded();
  await capture(page, "12b-mobile-byok-masked.png");
  await audit(page, '[data-testid="ai-settings-panel"]');
});

test("real shell read-only tools, PF-4 blockers and normalized approval; wheel and keyboard reach mobile approval", async ({ page, request }) => {
  await preference(request);
  const id = await project(request);
  await openAI(page, id);
  await page.getByTestId("ai-prompt-input").fill("What are the valid next steps for thermochemistry?");
  await page.getByTestId("ai-ask-button").click();
  await expect(page.getByTestId("ai-message-assistant").last()).toContainText("PF-4");
  await expect(page.getByTestId("ai-message-assistant").last()).toContainText("frequency");
  await capture(page, "02-navigator-blockers.png");
  await page.getByTestId("ai-prompt-input").fill("Inspect the available structures using a read-only tool.");
  await choosePlanMode(page, { general: true });
  await page.getByTestId("ai-ask-button").click();
  await page.locator(".ai-activity-disclosure > summary").click();
  await expect(page.locator(".step-tool-name").last()).toBeVisible();
  await expect(page.getByTestId("ai-approval-card")).toHaveCount(0);
  await capture(page, "03-read-only-tool.png");
  await page.getByTestId("ai-prompt-input").fill("Calculate the HF/STO-3G energy for this molecule.");
  await choosePlanMode(page, { general: false });
  await page.getByTestId("ai-ask-button").click();
  await expect(page.getByTestId("ai-approval-card")).toBeVisible();
  await expect(page.getByTestId("ai-approval-card")).toContainText("calculation.submit");
  await expect(page.getByTestId("ai-approval-card")).toContainText(/hf/i);
  await scrollApproval(page);
  await capture(page, "04-scientific-approval.png");
  await page.mouse.wheel(0, -450);
  await page.waitForTimeout(150);
  await capture(page, "04b-scientific-approval-parameters.png");
  await scrollApproval(page);
  await audit(page, '[data-testid="ai-scientist-panel"]');
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.getByRole("button", { name: "Show AI Scientist panel", exact: true }).isVisible())
    await page.getByRole("button", { name: "Show AI Scientist panel", exact: true }).click();
  writeFileSync(resolve(artifacts, "mobile-scroll-computed.json"), JSON.stringify(await page.evaluate(() => [...document.querySelectorAll(".project-shell,.project-document,.context-dock,.project-dock-inner,.dock-ai-content,.ai-scientist-panel,.ai-conversation-scroll")].map(el => { const style=getComputedStyle(el), rect=el.getBoundingClientRect(); return { classes:el.className, display:style.display, height:style.height, minHeight:style.minHeight, overflowY:style.overflowY, grid:style.gridTemplate, hidden:el.hasAttribute("hidden"), x:rect.x, y:rect.y, width:rect.width, rectHeight:rect.height }; })), null, 2));
  await expect(page.getByTestId("ai-approval-card")).toBeVisible();
  await scrollApproval(page);
  await expect(page.getByTestId("ai-dock-toggle")).toBeInViewport({ ratio: 1 });
  await capture(page, "11-mobile-approval.png");
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(150);
  await capture(page, "11b-mobile-approval-parameters.png");
  await scrollApproval(page);
  await audit(page, '[data-testid="ai-scientist-panel"]');
  const beforeKeyboard = await page.locator(".ai-conversation-scroll").evaluate(el => el.scrollTop);
  await page.getByTestId("ai-reject-button").focus();
  await page.keyboard.press("PageUp");
  await expect.poll(() => page.locator(".ai-conversation-scroll").evaluate(el => el.scrollTop)).toBeLessThan(beforeKeyboard);
  await page.keyboard.press("PageDown");
  await scrollApproval(page);
  await page.getByTestId("ai-reject-button").click();
  await expect(page.getByTestId("ai-approval-card")).toHaveCount(0);
  const facts = await (await request.get(`${root}/projects/${id}/navigator`)).json();
  expect(facts.facts_summary.running_jobs).toBe(0);
});

test("AI disabled leaves Navigator, sealed examples and onboarding usable", async ({ page, request }) => {
  await preference(request, "NONE");
  const id = await project(request);
  await openAI(page, id);
  await expect(page.getByTestId("ai-provider-state")).toContainText("AI_DISABLED");
  await expect(page.getByTestId("ai-prompt-input")).toBeDisabled();
  await capture(page, "10-ai-unavailable.png");
  await page.goto(`/en/projects/${id}/overview`);
  await expect(page.getByTestId("project-navigator")).toContainText("Molecular structure");
  await page.goto("/en/examples");
  await expect(page.getByRole("link", { name: /benzene/i }).first()).toBeVisible();
  await page.goto("/en/welcome");
  await expect(page.getByRole("heading", { name: /begin|start|what/i }).first()).toBeVisible();
  await page.goto("/en/learn");
  await expect(page.getByRole("heading", { name: /learn/i }).first()).toBeVisible();
});


test("approved existing engine produces cited result; Viewer cannot propose compute", async ({ page, request }) => {
  await preference(request);
  const id = await project(request);
  const conversation = await (await request.post(`${root}/projects/${id}/ai/conversations`, { data: {} })).json();
  const conv = conversation.conversation.id;
  const proposal = await (await request.post(`${root}/projects/${id}/ai/conversations/${conv}/messages`, { data: { content: "Calculate the HF/STO-3G energy for this molecule.", mode: "STANDARD" } })).json();
  expect(proposal.latest_run.status).toBe("WAITING_FOR_APPROVAL");
  const approved = await request.post(`${root}/projects/${id}/ai/approvals/${proposal.latest_run.pending_approval.id}/decision`, { data: { decision: "APPROVE" } });
  expect(approved.ok(), await approved.text()).toBe(true);
  execFileSync("uv", ["run", "--project", "../../services/api", "python", "../../services/api/tests/pf7_browser_actions.py", "compute"], { stdio: "pipe", cwd: process.cwd() });
  const run = await request.post(`${root}/projects/${id}/ai/runs/${proposal.latest_run.id}/resume`);
  expect(run.ok(), await run.text()).toBe(true);
  await openAI(page, id);
  await page.getByTestId("ai-prompt-input").fill("What calculations have I run?");
  await page.getByTestId("ai-ask-button").click();
  await expect(page.getByTestId("ai-message-assistant").last()).toContainText("-1.116759");
  await expect(page.getByTestId("ai-message-assistant").last()).toContainText("HF/STO-3G");
  await expect(page.getByTestId("ai-message-assistant").last()).not.toContainText("No authoritative");
  await expect(page.getByTestId("ai-message-assistant").last()).not.toContainText("Water");
  await capture(page, "01-authoritative-result-evidence.png");
  const context = await (await request.post(`${root}/projects/${id}/ai/context`, { data: {} })).json();
  expect(context.resources.some((r: { authoritative_calculation: boolean }) => r.authoritative_calculation)).toBe(true);
  writeFileSync(resolve(artifacts, "context-result.json"), JSON.stringify(context, null, 2));
  execFileSync("uv", ["run", "--project", "../../services/api", "python", "../../services/api/tests/pf7_browser_actions.py", "viewer", id], { stdio: "pipe", cwd: process.cwd() });
  await openAI(page, id);
  await expect(page.getByTestId("ai-read-only-state")).toBeVisible();
  await page.getByTestId("ai-prompt-input").fill("Run a calculation");
  await page.getByTestId("ai-composer-mode-plan").click();
  await expect(page.getByTestId("ai-composer-blocked")).toContainText("editable project");
  await expect(page.getByTestId("ai-plan-structure-first")).toHaveCount(0);
  await expect(page.getByTestId("ai-ask-button")).toBeDisabled();
  await capture(page, "05-viewer-write-denied.png");
});
