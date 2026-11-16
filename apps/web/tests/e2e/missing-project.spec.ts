import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const missingProjectId = "f3629c54-0ba3-4b41-a143-33cc2fa240a5";
const staleFileId = "a55b1bd5-5b0a-46b3-8aa2-3fd6ea4a2142";

test("missing project clears stale workspace state and offers safe navigation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Missing project UI acceptance runs in the desktop browser project.");
  await page.addInitScript(({ projectId, fileId }) => {
    localStorage.setItem(`chemdft:workspace:${projectId}:v1`, JSON.stringify({
      tabs: [{ selection: { kind: "file", id: fileId, projectId }, label: "water.sdf" }],
      activeKey: `file:${fileId}`,
      expanded: ["files", "structures", "experimentalData", "calculations", "results", "notes", "history"],
      nodeExpansion: { [`file:${fileId}`]: true },
    }));
    localStorage.setItem(`chemdft:panels:${projectId}:explorer`, "false");
  }, { projectId: missingProjectId, fileId: staleFileId });

  await page.goto(`/en/projects/${missingProjectId}/workspace?selection=file%3A${staleFileId}`);
  await expect(page.getByRole("heading", { name: "This project is no longer available." })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: "Return to projects" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create new project" })).toHaveAttribute("href", "/en/projects#create-project");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);

  const screenshots = path.resolve(process.cwd(), "../../output/workspace-qa");
  fs.mkdirSync(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, "missing-project.png"), fullPage: true });

  await page.getByRole("link", { name: "Create new project" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  const suffix = Date.now().toString(36);
  await page.getByRole("button", { name: "New Project" }).click();
  await page.getByLabel("Project name").fill("Missing project recovery acceptance");
  await page.getByLabel("Project slug").fill(`missing-recovery-${suffix}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Import a structure to begin" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
});
