import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

function evidencePdf(): Buffer {
  const content = "BT /F1 12 Tf 40 330 Td (The measured particle diameter is 4.2 nm for the synthetic sample.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "binary"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}

test("project evidence answer stays cited and survives reopening", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Evidence desk uses the desktop workspace layout.");
  const screenshots = path.resolve(process.cwd(), "../../output/workspace-qa");
  const ideScreenshots = path.resolve(process.cwd(), "../../output/workspace-ide-qa");
  fs.mkdirSync(screenshots, { recursive: true });
  fs.mkdirSync(ideScreenshots, { recursive: true });
  const capture = (name: string) => page.screenshot({ path: path.join(screenshots, name), fullPage: true });
  const captureIde = (name: string) => page.screenshot({ path: path.join(ideScreenshots, name), fullPage: true });
  await page.goto("/en");
  await page.getByRole("link", { name: "Open ChemDFT" }).first().click();
  await page.getByRole("button", { name: "New Project" }).click();
  await page.getByLabel("Project name").fill("Evidence Workspace QA");
  await page.getByLabel("Project slug").fill(`evidence-qa-${Date.now().toString(36)}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByTestId("workspace-evidence")).toBeVisible();
  await expect(page.getByTestId("evidence-status")).toHaveText("READY");
  await capture("01-default-workspace.png");

  const prompt = page.getByTestId("ai-prompt-input");
  await prompt.fill("What particle diameter was measured?");
  await page.getByTestId("ai-ask-button").click();
  await expect(page.getByTestId("evidence-status")).toHaveText("INSUFFICIENT EVIDENCE");
  await expect(page.getByTestId("inline-evidence-citation")).toHaveCount(0);
  await capture("04-insufficient-evidence.png");

  await page.setInputFiles("#structure-upload", {
    name: "particle-report.pdf", mimeType: "application/pdf", buffer: evidencePdf(),
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByTestId("knowledge-index-status")).toContainText("Index ready", { timeout: 30_000 });
  await page.getByTestId("tree-item-document").first().click();
  await expect(page.getByTestId("selected-workspace-canvas")).toBeVisible();
  await expect(page.locator("#workspace-pdf-canvas")).toBeVisible();
  await expect(page.getByText("Page 1 rendered", { exact: true })).toBeVisible();
  await expect(page.getByTestId("ai-current-view")).toContainText("The measured particle diameter");
  await page.getByRole("button", { name: /Expand The measured particle diameter/ }).click();
  await expect(page.getByTestId("tree-item-documentEvidence")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("tree-item-documentEvidence")).toBeVisible();
  await expect(page.getByTestId("selected-workspace-canvas")).toBeVisible();
  await page.getByRole("button", { name: /Collapse The measured particle diameter/ }).click();
  await captureIde("02-pdf-selected.png");
  await prompt.fill("What particle diameter was measured in the synthetic sample?");
  await capture("02-question-with-evidence.png");
  await page.getByTestId("ai-ask-button").click();
  await expect(page.getByTestId("evidence-status")).toHaveText("SUPPORTED", { timeout: 20_000 });
  await expect(page.getByTestId("evidence-card").first()).toContainText("4.2 nm");
  await expect(page.getByTestId("inline-evidence-citation").last()).toHaveText("[E1]");
  await capture("03-cited-answer.png");

  await page.getByTestId("inline-evidence-citation").last().click();
  await expect(page.getByTestId("evidence-card").first()).toHaveClass(/selected/);
  await expect(page.getByTestId("selected-workspace-canvas")).toBeVisible();
  await expect(page.getByTestId("workspace-open-tab")).toHaveCount(1);
  await expect(page.getByText("Page 1 rendered", { exact: true })).toBeVisible();
  await expect(page.getByTestId("workspace-open-tab")).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/selection=document%3A/);
  await expect(page.locator(".phase7-pdf-page")).toHaveAttribute("data-render-page", "1");
  await expect(page.getByText("Cited passage · page 1. Exact region is not available from this source.")).toBeVisible();
  await expect(page.locator(".phase7-highlight")).toHaveCount(0);
  await captureIde("05-citation-source.png");
  await page.getByTestId("evidence-open-source").click();
  await expect(page.locator(".phase7-pdf-page")).toHaveAttribute("data-render-page", "1");
  await page.getByTestId("tree-item-file").first().click();
  await expect(page.getByTestId("workspace-open-tab")).toHaveCount(2);
  await page.getByTestId("workspace-open-tab").first().click();
  await page.reload();
  await expect(page.getByTestId("evidence-status")).toHaveText("SUPPORTED", { timeout: 20_000 });
  await expect(page.getByTestId("evidence-card").first()).toHaveClass(/selected/);
  await expect(page.getByTestId("selected-workspace-canvas")).toBeVisible();
  await expect(page.getByTestId("workspace-open-tab")).toHaveCount(2);
  await expect(page.getByText("Page 1 rendered", { exact: true })).toBeVisible();
  await captureIde("06-restored-tabs.png");
  await capture("05-reopened-project.png");
  const sourceUrl = page.url();
  await page.getByRole("button", { name: /^Close / }).first().click();
  await expect(page.getByTestId("workspace-open-tab")).toHaveCount(1);
  await page.goto(sourceUrl);
  await expect(page.getByTestId("selected-workspace-canvas")).toBeVisible();
  await page.goto(`${new URL(sourceUrl).pathname}?selection=document%3Anot-a-uuid`);
  await expect(page.locator(".workspace-tree-notice")).toContainText("malformed");
  await page.goto(`${new URL(sourceUrl).pathname}?selection=document%3A00000000-0000-4000-8000-000000000999`);
  await expect(page.locator(".workspace-tree-notice")).toContainText("no longer");
});
