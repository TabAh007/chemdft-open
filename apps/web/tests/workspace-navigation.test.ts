import { describe, expect, it } from "vitest";

import { parseWorkspaceSelection, selectionKey, validSelection, workspaceSelectionUrl } from "../src/lib/workspace-selection";
import { closeWorkspaceTab, deduplicateWorkspaceTabs, emptyWorkspaceState, focusWorkspaceTab, openWorkspaceTab, pruneWorkspaceTabs, restoreWorkspaceState } from "../src/lib/workspace-tabs";

const projectId = "e11d9ea8-f66d-4a48-a872-859d4cb1d0ef";
const documentId = "e11d9ea8-f66d-4a48-a872-859d4cb1d0f0";
const candidateId = "e11d9ea8-f66d-4a48-a872-859d4cb1d0f1";
const versionId = "e11d9ea8-f66d-4a48-a872-859d4cb1d0f2";
const document = { kind: "document" as const, id: documentId, projectId, locator: { page: 6 } };
const version = { kind: "structureVersion" as const, id: versionId, projectId, sourceId: candidateId };

describe("persistent workspace navigation", () => {
  it("round trips source and page locators through a stable project URL", () => {
    const url = workspaceSelectionUrl("https://local.test/en/projects/x/workspace?other=1", document);
    expect(url).toContain(`selection=document%3A${documentId}`);
    expect(url).toContain("page=6");
    expect(parseWorkspaceSelection(new URL(url, "https://local.test").search, projectId)).toEqual(document);
    const versionUrl = workspaceSelectionUrl(`https://local.test${url}`, version);
    expect(parseWorkspaceSelection(new URL(versionUrl, "https://local.test").search, projectId)).toEqual(version);
    expect(versionUrl).not.toContain("page=6");
  });

  it("rejects malformed, cross project, and source-free selections", () => {
    expect(validSelection(document, "another-project")).toBe(false);
    expect(parseWorkspaceSelection(`?selection=document:${documentId}&page=0`, projectId)).toBeNull();
    expect(parseWorkspaceSelection(`?selection=structureVersion:${versionId}`, projectId)).toBeNull();
    expect(parseWorkspaceSelection("?selection=unknown:bad", projectId)).toBeNull();
  });

  it("opens, focuses, closes, restores, and prunes tabs without storing source data", () => {
    const first = openWorkspaceTab(emptyWorkspaceState(), { selection: document, label: "paper.pdf" });
    const second = openWorkspaceTab(first, { selection: version, label: "Structure V1" });
    expect(second.tabs).toHaveLength(2);
    expect(openWorkspaceTab(second, { selection: document, label: "paper.pdf" }).tabs).toHaveLength(2);
    expect(focusWorkspaceTab(second, selectionKey(document)).activeKey).toBe(selectionKey(document));
    const restored = restoreWorkspaceState(JSON.stringify(second), projectId);
    expect(restored.activeKey).toBe(selectionKey(version));
    expect(restored.expanded).toEqual(emptyWorkspaceState().expanded);
    expect(closeWorkspaceTab(restored, selectionKey(version)).activeKey).toBe(selectionKey(document));
    expect(pruneWorkspaceTabs(restored, new Set([selectionKey(document)])).tabs).toHaveLength(1);
    expect(pruneWorkspaceTabs(restored, new Set()).activeKey).toBeNull();
    expect(pruneWorkspaceTabs({ ...restored, activeKey: null }, new Set([selectionKey(document), selectionKey(version)])).activeKey).toBeNull();
    expect(restoreWorkspaceState(JSON.stringify({ ...second, activeKey: null }), projectId).activeKey).toBeNull();
    expect(restoreWorkspaceState(JSON.stringify({ ...second, nodeExpansion: { [selectionKey(document)]: true } }), projectId).nodeExpansion).toEqual({ [selectionKey(document)]: true });
  });

  it("deduplicates identical resources while preserving distinct calculations with similar names", () => {
    const calcId1 = "e3146f9f-f143-4ba9-957f-281ac23e68af";
    const calcId2 = "2c7b712c-4934-4b47-baea-fb814c40aa28";
    const resultId1 = "35e0b59d-ab9c-47fe-8b1b-f7449d9fbe78";
    const resultId2 = "77a9a7c9-f19b-4ff6-932d-327c62c3f8e5";

    const calc1Selection = { kind: "calculation" as const, id: calcId1, projectId };
    const calc2Selection = { kind: "calculation" as const, id: calcId2, projectId };
    const result1Selection = { kind: "calculationResult" as const, id: resultId1, projectId, sourceId: calcId1 };
    const result2Selection = { kind: "calculationResult" as const, id: resultId2, projectId, sourceId: calcId2 };

    // 1. Two distinct calculations with similar display labels must remain separate
    let state = openWorkspaceTab(emptyWorkspaceState(), { selection: calc1Selection, label: "Electronic structure · RHF/STO-3G" });
    state = openWorkspaceTab(state, { selection: calc2Selection, label: "Electronic structure · RHF/STO-3G" });
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[0]?.selection.id).toBe(calcId1);
    expect(state.tabs[1]?.selection.id).toBe(calcId2);

    // 2. Re-opening identical calculation 1 must activate existing tab, NOT append duplicate
    state = openWorkspaceTab(state, { selection: calc1Selection, label: "Electronic structure · RHF/STO-3G" });
    expect(state.tabs).toHaveLength(2);
    expect(state.activeKey).toBe(selectionKey(calc1Selection));

    // 3. Opening UV/Vis result tab
    state = openWorkspaceTab(state, { selection: result1Selection, label: "UV/Vis absorption spectrum" });
    expect(state.tabs).toHaveLength(3);
    expect(state.activeKey).toBe(selectionKey(result1Selection));

    // 4. Opening same UV/Vis result with extended label reuses tab and updates label without duplicate
    state = openWorkspaceTab(state, { selection: result1Selection, label: "UV/Vis absorption spectrum · B3LYP/6-31G*" });
    expect(state.tabs).toHaveLength(3);
    expect(state.activeKey).toBe(selectionKey(result1Selection));
    expect(state.tabs.find((t) => selectionKey(t.selection) === selectionKey(result1Selection))?.label).toBe("UV/Vis absorption spectrum · B3LYP/6-31G*");

    // 5. Distinct calculation result remains separate
    state = openWorkspaceTab(state, { selection: result2Selection, label: "Electronic structure · RHF/STO-3G" });
    expect(state.tabs).toHaveLength(4);

    // 6. deduplicateWorkspaceTabs unit function
    const rawTabsWithDuplicates = [
      { selection: result1Selection, label: "UV/Vis" },
      { selection: calc1Selection, label: "Calc 1" },
      { selection: result1Selection, label: "UV/Vis duplicate" },
      { selection: calc2Selection, label: "Calc 2" },
      { selection: calc1Selection, label: "Calc 1 duplicate" },
    ];
    const deduped = deduplicateWorkspaceTabs(rawTabsWithDuplicates);
    expect(deduped).toHaveLength(3);
    expect(deduped.map((t) => selectionKey(t.selection))).toEqual([
      selectionKey(result1Selection),
      selectionKey(calc1Selection),
      selectionKey(calc2Selection),
    ]);

    // 7. restoreWorkspaceState cleans up any duplicate tabs from storage
    const restored = restoreWorkspaceState(JSON.stringify({ tabs: rawTabsWithDuplicates, activeKey: selectionKey(result1Selection) }), projectId);
    expect(restored.tabs).toHaveLength(3);
  });
});
