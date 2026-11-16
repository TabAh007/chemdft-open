import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isElectronicStateLocked } from "../src/lib/electronic-state";
import { ProjectApiError, renameProject } from "../src/lib/project-api";
import { canRenameProject, cleanProjectName, projectNameProblem, renameErrorText } from "../src/lib/settings-model";
import { valueView } from "../src/lib/claim-format";
import { ClaimValue } from "../src/app/_components/claims/claim-value";

describe("charge and multiplicity authority (server rule mirrored)", () => {
  it("is editable only when the server would accept a change, or when the server does not say", () => {
    expect(isElectronicStateLocked("CALCULATION_USER_DECLARED")).toBe(false);
    expect(isElectronicStateLocked("STRUCTURE_VERSION")).toBe(true);
    expect(isElectronicStateLocked("USER_DECLARED_XYZ")).toBe(true);
    expect(isElectronicStateLocked(undefined)).toBe(false);
    expect(isElectronicStateLocked(null)).toBe(false);
  });
  it("the stage shows the plain sentence and no number inputs when locked", () => {
    const source = readFileSync(new URL("../src/app/_components/guided/guided-structure-stage.tsx", import.meta.url), "utf8");
    expect(source).toContain("Taken from the structure file; it cannot be changed here.");
    expect(source).toContain("electronicLocked ?");
  });
});

describe("project rename", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("trims like the server and rejects empty or long names with plain text", () => {
    expect(cleanProjectName("  My   project ")).toBe("My project");
    expect(projectNameProblem("   ")).toBe("Enter a name for the project.");
    expect(projectNameProblem("x".repeat(161))).toBe("Use 160 characters or fewer.");
    expect(projectNameProblem("Fine")).toBeNull();
  });
  it("only owners and editors see Rename", () => {
    expect(canRenameProject("owner")).toBe(true);
    expect(canRenameProject("editor")).toBe(true);
    expect(canRenameProject("viewer")).toBe(false);
  });
  it("maps failures to plain sentences", () => {
    expect(renameErrorText(403)).toContain("not rename");
    expect(renameErrorText(404)).toContain("could not be found");
    expect(renameErrorText(null)).toContain("could not be saved");
  });
  it("PATCHes the name only", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "p", name: "New" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await renameProject("p", "New");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v1/projects/p");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ name: "New" });
  });
  it("surfaces the status on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    await expect(renameProject("p", "N")).rejects.toBeInstanceOf(ProjectApiError);
    await expect(renameProject("p", "N")).rejects.toMatchObject({ status: 403 });
  });
});

describe("original claim text", () => {
  const view = valueView(24.48);
  it("shows the source spelling when present and the server digits otherwise", () => {
    expect(renderToStaticMarkup(createElement(ClaimValue, { view, original: "24.480" }))).toContain("24.480");
    const without = renderToStaticMarkup(createElement(ClaimValue, { view, original: null }));
    expect(without).toContain("24.48");
    expect(without).not.toContain("24.480");
    expect(renderToStaticMarkup(createElement(ClaimValue, { view }))).not.toContain("data-original");
  });
  it("an old-server claim without the field still renders", () => {
    const claim: { original_value_text?: string | null } = {};
    expect(renderToStaticMarkup(createElement(ClaimValue, { view, original: claim.original_value_text }))).toContain("24.48");
  });
});
