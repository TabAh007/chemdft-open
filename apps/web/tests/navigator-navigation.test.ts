import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { NavigatorAction, NavigatorTarget } from "@chemdft/schemas";
import { navigatorHref, navigatorSelection, navigatorCalculationTask, NAVIGATOR_LAUNCHES } from "../src/lib/navigator-navigation";
import { navigatorMessage } from "../src/lib/navigator-messages";
import { getNavigator, isAbortError } from "../src/lib/navigator-api";

const root = resolve(import.meta.dirname, "../../..");
const schema = JSON.parse(readFileSync(resolve(root, "packages/schemas/generated/chemdft-contracts.schema.json"), "utf8"));
const ids = schema.$defs.NavigatorAction.properties.action_id.enum as string[];
const launches = schema.$defs.NavigatorTarget.properties.launch.enum as string[];
const projectId = "e11d9ea8-f66d-4a48-a872-859d4cb1d0ef";
const versionId = "e11d9ea8-f66d-4a48-a872-859d4cb1d0f0";
const sourceId = "e11d9ea8-f66d-4a48-a872-859d4cb1d0f1";
function action(id: string, target: NavigatorTarget): NavigatorAction {
  return { action_id: id as NavigatorAction["action_id"], category: "structure", title_key: `action.${id}.title`, description_key: `action.${id}.description`, required_capability: "read", minimum_role_key: "role.viewer", required_facts: [], conflicting_facts: [], resulting_fact: "reviewed", goal_ids: [], target, reasons: [] };
}

describe("Navigator contract and durable adapters", () => {
  it("covers every server action with localized title and description in all routed locales", () => {
    for (const locale of ["en", "tr", "ru", "de"] as const) for (const id of ids) {
      expect(navigatorMessage(locale, `action.${id}.title`)).not.toBe(`action.${id}.title`);
      expect(navigatorMessage(locale, `action.${id}.description`)).not.toBe(`action.${id}.description`);
    }
    for (const code of schema.$defs.NavigatorReason.properties.code.enum) expect(navigatorMessage("en", `reason.${code}`)).not.toBe(`reason.${code}`);
    expect([...NAVIGATOR_LAUNCHES].sort()).toEqual([...launches].sort());
  });

  it("every declared launch has a real workspace or Jobs route and an adapter", () => {
    const launcher = readFileSync(resolve(root, "apps/web/src/app/[locale]/projects/[projectId]/workspace/structure-workspace-client.tsx"), "utf8");
    for (const launch of NAVIGATOR_LAUNCHES) {
      const item = action("structure.inspect", { launch, route: launch === "jobs" ? "jobs" : "workspace" });
      const href = navigatorHref("de", projectId, item)!;
      const url = new URL(href, "https://chemdft.test");
      const route = launch === "jobs" ? "jobs" : "workspace";
      expect(existsSync(resolve(root, `apps/web/src/app/[locale]/projects/[projectId]/${route}/page.tsx`))).toBe(true);
      expect(url.pathname).toBe(`/de/projects/${projectId}/${route}`);
      if (["experimental", "compare", "spectra", "inspect"].includes(launch)) expect(launcher).toContain("openSelection(selection");
      else if (launch !== "jobs") expect(launcher + readFileSync(resolve(root, "apps/web/src/lib/navigator-navigation.ts"), "utf8")).toContain(`"${launch}"`);
    }
  });

  it("preserves source-bound selection, goal and scientific scope", () => {
    const target = { launch: "ir", route: "workspace", selection_kind: "structureVersion", selection_id: versionId, source_id: sourceId } as const;
    const href = navigatorHref("en", projectId, action("spectra.predict_ir", target), "ir")!;
    const params = new URL(href, "https://local.test").searchParams;
    expect(params.get("navigator_version")).toBe(versionId);
    expect(params.get("navigator_goal")).toBe("ir");
    expect(navigatorSelection(projectId, target)).toEqual({ projectId, kind: "structureVersion", id: versionId, sourceId });
    const orbitalTarget = { launch: "mo", selection_kind: "calculationResult", selection_id: versionId, source_id: sourceId } as const;
    const orbitalHref = navigatorHref("en", projectId, action("electronic.inspect_orbitals", orbitalTarget), "orbitals", versionId)!;
    expect(new URL(orbitalHref, "https://local.test").searchParams.get("navigator_version")).toBe(versionId);
  });

  it("never links blocked or malformed actions", () => {
    const item = action("calculation.optimize", { launch: "optimization" });
    expect(navigatorHref("en", projectId, { ...item, target: null })).toBeNull();
    expect(navigatorHref("en", projectId, { ...item, reasons: [{ code: "editor_required", message_key: "reason.editor_required" }] })).toBeNull();
    expect(navigatorHref("en", projectId, { ...item, target: { launch: "optimization", selection_kind: "structureVersion", selection_id: "forged", source_id: sourceId } })).toBeNull();
  });

  it("uses existing import controls and explicit calculation tasks", () => {
    expect(navigatorHref("en", projectId, action("spectra.upload_experimental", { launch: "spectrum_import" }))).toContain("import=spectrum");
    expect(navigatorHref("en", projectId, action("evidence.import_calculation", { launch: "calculation_import" }))).toContain("import=calculation");
    expect(navigatorCalculationTask("calculation.single_point")).toBe("ENERGY");
    expect(navigatorCalculationTask("calculation.orbitals")).toBe("ORBITAL");
    expect(navigatorCalculationTask("calculation.optimize")).toBe("GEOMETRY_OPTIMIZATION");
    expect(navigatorCalculationTask("unknown")).toBeUndefined();
  });

  it("fetches server state without client facts or AI settings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: 1 })));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await getNavigator(projectId, { goal: "thermochemistry", structureVersionId: versionId });
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toContain(`/v1/projects/${projectId}/navigator?`);
      expect(url).toContain("goal=thermochemistry");
      expect(options).toMatchObject({ cache: "no-store" });
      expect(options.body).toBeUndefined();
    } finally { vi.unstubAllGlobals(); }
  });

  it("identifies AbortError from DOMException or Error and distinguishes real failures", () => {
    const domAbort = new DOMException("The user aborted a request.", "AbortError");
    expect(isAbortError(domAbort)).toBe(true);

    const errorAbort = new Error("Operation cancelled");
    errorAbort.name = "AbortError";
    expect(isAbortError(errorAbort)).toBe(true);

    // A real network error whose message contains "aborted" has name "Error" and is still surfaced (isAbortError is false)
    const msgAbort = new Error("The request was aborted by peer.");
    expect(isAbortError(msgAbort)).toBe(false);

    expect(isAbortError(new Error("NetworkError: Failed to fetch"))).toBe(false);
    expect(isAbortError(new Error("Navigator request failed (500)"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});
