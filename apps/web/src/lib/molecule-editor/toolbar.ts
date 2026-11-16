/**
 * The labelled toolbar's model: which control exists, how it drives Ketcher, and how the highlighted tool is
 * resolved. Ketcher's own toolbars stay mounted (hidden) because several tools can only be started through
 * them; every item below records whether it is driven through the editor API or through a native button.
 */
import { FUNCTIONAL_GROUPS } from "./groups";

export type ToolDriver =
  /** `ketcher.editor.tool(tool, opts)` — public editor API. */
  | { kind: "tool"; tool: string; opts?: unknown }
  /** `ketcher.editor.tool("template", { struct })` with the MOL block parsed by Ketcher's own formatter. */
  | { kind: "stamp"; molfile: string }
  /** Click Ketcher's own (hidden) button, found by its stable data-testid. */
  | { kind: "native"; testId: string }
  /** `ketcher.editor.undo()` / `redo()`. */
  | { kind: "history"; action: "undo" | "redo" };

export type GlyphId =
  | "select" | "erase" | "single" | "double" | "triple" | "wedge" | "hash" | "benzene" | "ring6" | "ring5" | "chain"
  | "plus" | "minus" | "undo" | "redo" | "cleanup" | "rotate" | "flip" | "addh" | "properties" | "more";

export type ToolbarItem = {
  id: string;
  label: string;
  /** Accessible name and tooltip subject. */
  title: string;
  shortcut?: string;
  glyph: GlyphId;
  driver: ToolDriver;
  /** Becomes the highlighted tool (false for one-shot actions: undo, clean up, properties). */
  sticky: boolean;
};

export type ToolbarGroup = { id: string; label: string; items: readonly ToolbarItem[] };

const tool = (id: string, label: string, title: string, glyph: GlyphId, driver: ToolDriver, shortcut?: string, sticky = true): ToolbarItem =>
  ({ id, label, title, glyph, driver, sticky, ...(shortcut ? { shortcut } : {}) });

export const TOOLBAR_GROUPS: readonly ToolbarGroup[] = [
  { id: "tools", label: "Tools", items: [
    tool("select", "Select", "Select and move", "select", { kind: "tool", tool: "select", opts: "rectangle" }, "Shift+Tab"),
    tool("erase", "Erase", "Erase", "erase", { kind: "tool", tool: "eraser", opts: 1 }, "Del"),
  ] },
  { id: "bonds", label: "Bonds", items: [
    tool("bond-single", "Single", "Single bond", "single", { kind: "tool", tool: "bond", opts: { type: 1, stereo: 0 } }, "1"),
    tool("bond-double", "Double", "Double bond", "double", { kind: "tool", tool: "bond", opts: { type: 2, stereo: 0 } }, "2"),
    tool("bond-triple", "Triple", "Triple bond", "triple", { kind: "tool", tool: "bond", opts: { type: 3, stereo: 0 } }, "3"),
    tool("bond-wedge", "Wedge", "Wedge bond (stereo, up)", "wedge", { kind: "tool", tool: "bond", opts: { type: 1, stereo: 1 } }),
    tool("bond-hash", "Hash", "Hashed bond (stereo, down)", "hash", { kind: "tool", tool: "bond", opts: { type: 1, stereo: 6 } }),
  ] },
  { id: "rings", label: "Rings & chains", items: [
    tool("ring-benzene", "Benzene", "Benzene ring", "benzene", { kind: "native", testId: "template-0" }, "T"),
    tool("ring-6", "Ring 6", "Cyclohexane ring", "ring6", { kind: "native", testId: "template-2" }, "T"),
    tool("ring-5", "Ring 5", "Cyclopentane ring", "ring5", { kind: "native", testId: "template-3" }, "T"),
    tool("chain", "Chain", "Carbon chain", "chain", { kind: "tool", tool: "chain" }),
  ] },
  { id: "charge", label: "Charge", items: [
    tool("charge-plus", "Charge +", "Increase charge", "plus", { kind: "tool", tool: "charge", opts: 1 }, "+"),
    tool("charge-minus", "Charge −", "Decrease charge", "minus", { kind: "tool", tool: "charge", opts: -1 }, "−"),
  ] },
  { id: "history", label: "History", items: [
    tool("undo", "Undo", "Undo", "undo", { kind: "history", action: "undo" }, "Ctrl+Z", false),
    tool("redo", "Redo", "Redo", "redo", { kind: "history", action: "redo" }, "Ctrl+Shift+Z", false),
  ] },
  { id: "structure", label: "Structure", items: [
    tool("cleanup", "Clean up", "Clean up the layout", "cleanup", { kind: "native", testId: "Clean Up button" }, "Ctrl+Shift+L", false),
    tool("rotate", "Rotate", "Rotate the selection", "rotate", { kind: "tool", tool: "rotate" }),
    tool("flip", "Flip", "Flip the drawing horizontally", "flip", { kind: "tool", tool: "rotate", opts: "horizontal" }, "Alt+H", false),
    tool("add-h", "Add H", "Add or remove drawn hydrogens (schematic; the server places the 3D hydrogens)", "addh", { kind: "native", testId: "Add/Remove explicit hydrogens button" }, undefined, false),
  ] },
  { id: "analyze", label: "Analyze", items: [
    tool("properties", "Properties", "Calculated values", "properties", { kind: "native", testId: "Calculated Values button" }, "Alt+C", false),
  ] },
];

/** Controls reachable from the “More tools” menu: Ketcher actions that need no always-visible button. */
export const MORE_TOOLS: readonly { id: string; label: string; testId: string }[] = [
  { id: "check", label: "Check structure", testId: "Check Structure button" },
  { id: "aromatize", label: "Aromatize", testId: "Aromatize button" },
  { id: "dearomatize", label: "Dearomatize", testId: "Dearomatize button" },
  { id: "cip", label: "Calculate CIP labels", testId: "Calculate CIP button" },
  { id: "layout", label: "Re-layout the whole drawing", testId: "Layout button" },
  { id: "library", label: "Structure library", testId: "template-lib" },
];

export type AtomChip = { id: string; symbol: string; title: string; testId: string; color: string };

/** CPK-style colours chosen to stay readable on white (not exact CPK for S, P, Br). */
export const ATOM_CHIPS: readonly AtomChip[] = [
  { id: "atom-H", symbol: "H", title: "Hydrogen", testId: "H-button", color: "#1f2933" },
  { id: "atom-C", symbol: "C", title: "Carbon", testId: "C-button", color: "#1f2933" },
  { id: "atom-N", symbol: "N", title: "Nitrogen", testId: "N-button", color: "#2a4fd6" },
  { id: "atom-O", symbol: "O", title: "Oxygen", testId: "O-button", color: "#cc1f1f" },
  { id: "atom-S", symbol: "S", title: "Sulfur", testId: "S-button", color: "#9a7400" },
  { id: "atom-P", symbol: "P", title: "Phosphorus", testId: "P-button", color: "#c05a00" },
  { id: "atom-F", symbol: "F", title: "Fluorine", testId: "F-button", color: "#1b7a1b" },
  { id: "atom-Cl", symbol: "Cl", title: "Chlorine", testId: "Cl-button", color: "#1b7a1b" },
  { id: "atom-Br", symbol: "Br", title: "Bromine", testId: "Br-button", color: "#8f2d12" },
];

export const GROUP_CHIPS = FUNCTIONAL_GROUPS.map((group) => ({ id: `group-${group.id}`, label: group.label, title: `${group.label} group`, molfile: group.molfile }));

export const PERIODIC_TABLE_TEST_ID = "period-table";
export const STRUCTURE_LIBRARY_TEST_ID = "template-lib";

/** Which highlighted item each of Ketcher's own buttons stands for (read back from its `active` class). */
export const NATIVE_ACTIVE_TO_ITEM: Readonly<Record<string, string>> = {
  "select-rectangle": "select",
  erase: "erase",
  bonds: "bond-single",
  chain: "chain",
  "charge-plus": "charge-plus",
  "charge-minus": "charge-minus",
  "template-0": "ring-benzene",
  "template-2": "ring-6",
  "template-3": "ring-5",
  "H-button": "atom-H", "C-button": "atom-C", "N-button": "atom-N", "O-button": "atom-O", "S-button": "atom-S",
  "P-button": "atom-P", "F-button": "atom-F", "Cl-button": "atom-Cl", "Br-button": "atom-Br",
};

/**
 * Resolve the highlighted tool. `own` is what this toolbar last started; `nativeActive` are the testids of
 * Ketcher's buttons that currently carry the `active` class. Ketcher wins when the user switched tool
 * through a shortcut or a Ketcher dialog; a more specific own choice (a bond subtype, a stamp) is kept while
 * Ketcher still reports the same family.
 */
export function resolveActiveItem(own: string | null, nativeActive: readonly string[]): string | null {
  const nativeItems = nativeActive.map((testId) => NATIVE_ACTIVE_TO_ITEM[testId]).filter((id): id is string => Boolean(id));
  if (nativeItems.length === 0) return own;
  if (own && nativeItems.includes(own)) return own;
  if (own?.startsWith("bond-") && nativeItems.includes("bond-single")) return own;
  const toolItem = nativeItems.find((id) => !id.startsWith("atom-")) ?? nativeItems[0] ?? null;
  const atomItem = nativeItems.find((id) => id.startsWith("atom-"));
  // Ketcher keeps an atom highlighted next to the tool it applies to; the drawing tool is what the user sees.
  if (own?.startsWith("atom-") && atomItem) return atomItem;
  return toolItem ?? atomItem ?? own;
}

export function findToolbarItem(id: string): ToolbarItem | undefined {
  for (const group of TOOLBAR_GROUPS) for (const item of group.items) if (item.id === id) return item;
  return undefined;
}

export function tooltipFor(item: Pick<ToolbarItem, "title" | "shortcut">): string {
  return item.shortcut ? `${item.title} (${item.shortcut})` : item.title;
}

export type EditorToolApi = {
  editor: {
    tool: (name: string, opts?: unknown) => unknown;
    undo: () => void;
    redo: () => void;
  };
  formatterFactory: { create: (format: string, options?: unknown) => { getStructureFromStringAsync: (text: string) => Promise<unknown> } };
};

/** Start a tool or run an action. Returns false when a native button was not found (nothing happened). */
export async function driveTool(
  ketcher: EditorToolApi,
  driver: ToolDriver,
  clickNative: (testId: string) => boolean,
): Promise<boolean> {
  switch (driver.kind) {
    case "tool":
      ketcher.editor.tool(driver.tool, driver.opts);
      return true;
    case "stamp": {
      const struct = await ketcher.formatterFactory.create("mol", {}).getStructureFromStringAsync(driver.molfile);
      ketcher.editor.tool("template", { struct });
      return true;
    }
    case "native":
      return clickNative(driver.testId);
    case "history":
      if (driver.action === "undo") ketcher.editor.undo(); else ketcher.editor.redo();
      return true;
  }
}
