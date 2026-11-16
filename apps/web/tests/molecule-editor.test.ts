import { describe, expect, it, vi } from "vitest";
import { validateSmilesSyntax } from "../src/lib/molecule-editor/smiles-syntax";
import { classifyStructureInput, loadStructureIntoEditor, countMolfileAtoms } from "../src/lib/molecule-editor/structure-input";
import { STRUCTURE_TEMPLATES } from "../src/lib/molecule-editor/templates";
import { FUNCTIONAL_GROUPS } from "../src/lib/molecule-editor/groups";
import { driveTool, findToolbarItem, resolveActiveItem, TOOLBAR_GROUPS, tooltipFor, ATOM_CHIPS } from "../src/lib/molecule-editor/toolbar";
import { exportFilename } from "../src/lib/molecule-editor/export-name";
import { readMolfile } from "../src/lib/molecule-editor/read-molfile";
import { serializeKetcher } from "../src/lib/molecule-editor/serial-ketcher";
import { describeMolecules, describeSelectedAtom, hillFormula, formatCharge, formulaRuns, parseGrossFormula, summarizeCheck } from "../src/lib/molecule-editor/drawing-checks";

describe("SMILES syntax", () => {
  it.each(["O", "CCO", "c1ccccc1", "CC(=O)O", "C[C@H](N)C(=O)O", "[NH4+]", "[Na+].[Cl-]", "C%12CC%12", "Cn1cnc2c1c(=O)n(C)c(=O)n2C", "F/C=C/F", "[13CH4]", "[2H]O[2H]"])(
    "accepts %s",
    (smiles) => expect(validateSmilesSyntax(smiles).ok).toBe(true),
  );

  it.each([
    ["C(C", /never closed/],
    ["CC)", /no opening/],
    ["C1CC", /never closed/],
    ["hello", /not valid|not a known/],
    ["[Xx]", /not a known element/],
    ["C=", /ends before/],
    ["=C", /needs an atom/],
    ["C()C", /at least one atom/],
    ["CC O", /no spaces/],
    ["[C", /never closed/],
    ["", /empty/],
    ["()", /must follow an atom/],
    ["C%1", /two digits/],
  ])("rejects %s with a reason", (smiles, reason) => {
    const result = validateSmilesSyntax(smiles);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
  });

  it("counts atoms", () => {
    expect(validateSmilesSyntax("CC(=O)O")).toEqual({ ok: true, atoms: 4 });
    expect(validateSmilesSyntax("[NH4+]")).toEqual({ ok: true, atoms: 1 });
  });
});

const ETHANOL_MOL = ["", "  test", "", "  3  2  0  0  0  0  0  0  0  0999 V2000", "    0.0000    0.0000    0.0000 C   0  0", "    1.0000    0.0000    0.0000 C   0  0", "    2.0000    0.0000    0.0000 O   0  0", "  1  2  1  0", "  2  3  1  0", "M  END", ""].join("\n");

describe("structure input classification", () => {
  it("separates empty, SMILES, MOL and invalid text", () => {
    expect(classifyStructureInput("  \n ")).toEqual({ kind: "empty" });
    expect(classifyStructureInput(" CCO ")).toEqual({ kind: "smiles", text: "CCO", atoms: 3 });
    expect(classifyStructureInput(ETHANOL_MOL)).toMatchObject({ kind: "mol", atoms: 3 });
    expect(classifyStructureInput("C(C")).toMatchObject({ kind: "invalid" });
  });
  it("rejects incomplete, empty and multi-record MOL/SDF text", () => {
    expect(classifyStructureInput("a\nb\nc\nd")).toMatchObject({ kind: "invalid", reason: expect.stringContaining("M  END") });
    const noAtoms = ["", "x", "", "  0  0  0  0  0  0  0  0  0  0999 V2000", "M  END"].join("\n");
    expect(classifyStructureInput(noAtoms)).toMatchObject({ kind: "invalid", reason: expect.stringContaining("no atoms") });
    const truncated = ["", "x", "", "  3  2  0  0  0  0  0  0  0  0999 V2000", "    0.0 0.0 0.0 C   0  0", "M  END"].join("\n");
    expect(classifyStructureInput(truncated)).toMatchObject({ kind: "invalid", reason: expect.stringContaining("shorter") });
    expect(classifyStructureInput(`${ETHANOL_MOL}$$$$\n${ETHANOL_MOL}$$$$\n`)).toMatchObject({ kind: "invalid", reason: expect.stringContaining("2 structures") });
    expect(classifyStructureInput(`${ETHANOL_MOL}$$$$\n`)).toMatchObject({ kind: "mol", atoms: 3 });
  });
  it("counts molfile atoms", () => expect(countMolfileAtoms(ETHANOL_MOL)).toBe(3));
});

describe("loadStructureIntoEditor", () => {
  const converted = (atoms: number) => ["", "  x", "", `${String(atoms).padStart(3)}  0  0  0  0  0  0  0  0  0999 V2000`, "M  END"].join("\n");
  it("loads valid SMILES after Indigo parses it", async () => {
    const setMolecule = vi.fn().mockResolvedValue(undefined);
    const convert = vi.fn().mockResolvedValue({ struct: converted(3) });
    await expect(loadStructureIntoEditor({ setMolecule, indigo: { convert } }, "CCO")).resolves.toEqual({ ok: true, kind: "smiles", atoms: 3 });
    expect(setMolecule).toHaveBeenCalledWith("CCO");
  });
  it("never touches the canvas for invalid or unreadable input", async () => {
    const setMolecule = vi.fn();
    const convert = vi.fn().mockResolvedValue({ struct: converted(0) });
    const bad = await loadStructureIntoEditor({ setMolecule, indigo: { convert } }, "C(C");
    expect(bad).toEqual({ ok: false, error: expect.stringContaining("never closed") });
    const empty = await loadStructureIntoEditor({ setMolecule, indigo: { convert } }, "CC");
    expect(empty).toEqual({ ok: false, error: expect.stringContaining("could not read") });
    const none = await loadStructureIntoEditor({ setMolecule, indigo: { convert } }, "");
    expect(none.ok).toBe(false);
    expect(setMolecule).not.toHaveBeenCalled();
  });
  it("reports a Ketcher failure as a short sentence", async () => {
    const setMolecule = vi.fn();
    const convert = vi.fn().mockRejectedValue(new Error("Given string could not be loaded as molecule: 'x'. second part"));
    const result = await loadStructureIntoEditor({ setMolecule, indigo: { convert } }, "CCO");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Ketcher could not read this structure") });
    expect(setMolecule).not.toHaveBeenCalled();
  });
});

describe("templates and groups", () => {
  it("has Water, Ethanol and Benzene featured, with syntactically valid SMILES", () => {
    expect(STRUCTURE_TEMPLATES.filter((item) => item.featured).map((item) => item.label)).toEqual(["Water", "Ethanol", "Benzene"]);
    for (const template of STRUCTURE_TEMPLATES) expect(validateSmilesSyntax(template.smiles).ok, template.id).toBe(true);
  });
  it("builds well-formed MOL blocks for every functional group", () => {
    for (const group of FUNCTIONAL_GROUPS) {
      const classified = classifyStructureInput(group.molfile);
      expect(classified, group.id).toMatchObject({ kind: "mol", atoms: group.elements.length });
    }
    const no2 = FUNCTIONAL_GROUPS.find((group) => group.id === "no2")!;
    expect(no2.molfile).toContain("N   0  3");
    expect(no2.molfile).toContain("O   0  5");
    expect(FUNCTIONAL_GROUPS.map((group) => group.label)).toEqual(["CH3", "OH", "NH2", "COOH", "NO2", "CN"]);
  });
});

describe("toolbar model", () => {
  it("lists the requested groups and labelled tools in order", () => {
    expect(TOOLBAR_GROUPS.map((group) => group.label)).toEqual(["Tools", "Bonds", "Rings & chains", "Charge", "History", "Structure", "Analyze"]);
    const labels = TOOLBAR_GROUPS.flatMap((group) => group.items.map((item) => item.label));
    expect(labels).toEqual(["Select", "Erase", "Single", "Double", "Triple", "Wedge", "Hash", "Benzene", "Ring 6", "Ring 5", "Chain", "Charge +", "Charge −", "Undo", "Redo", "Clean up", "Rotate", "Flip", "Add H", "Properties"]);
    expect(new Set(TOOLBAR_GROUPS.flatMap((group) => group.items.map((item) => item.id))).size).toBe(labels.length);
  });
  it("tooltips carry the shortcut", () => {
    expect(tooltipFor(findToolbarItem("bond-double")!)).toBe("Double bond (2)");
    expect(tooltipFor(findToolbarItem("undo")!)).toBe("Undo (Ctrl+Z)");
    expect(tooltipFor(findToolbarItem("chain")!)).toBe("Carbon chain");
  });
  it("atom chips are H C N O S P F Cl Br", () => expect(ATOM_CHIPS.map((chip) => chip.symbol)).toEqual(["H", "C", "N", "O", "S", "P", "F", "Cl", "Br"]));

  describe("resolveActiveItem", () => {
    it("keeps the toolbar's own choice when Ketcher reports nothing", () => expect(resolveActiveItem("rotate", [])).toBe("rotate"));
    it("follows Ketcher when the user switched tool another way", () => expect(resolveActiveItem("erase", ["select-rectangle"])).toBe("select"));
    it("keeps a bond subtype while Ketcher shows the generic bond button", () => {
      expect(resolveActiveItem("bond-double", ["bonds"])).toBe("bond-double");
      expect(resolveActiveItem(null, ["bonds"])).toBe("bond-single");
    });
    it("keeps a chosen atom over the tool highlight", () => expect(resolveActiveItem("atom-O", ["select-rectangle", "O-button"])).toBe("atom-O"));
    it("ignores unknown Ketcher buttons", () => expect(resolveActiveItem("chain", ["hand"])).toBe("chain"));
  });

  describe("driveTool", () => {
    const makeKetcher = () => {
      const tool = vi.fn();
      const undo = vi.fn();
      const redo = vi.fn();
      const parse = vi.fn().mockResolvedValue({ parsed: true });
      return { tool, undo, redo, parse, api: { editor: { tool, undo, redo }, formatterFactory: { create: () => ({ getStructureFromStringAsync: parse }) } } };
    };
    it("starts an editor tool with its options", async () => {
      const k = makeKetcher();
      await expect(driveTool(k.api, findToolbarItem("bond-wedge")!.driver, () => false)).resolves.toBe(true);
      expect(k.tool).toHaveBeenCalledWith("bond", { type: 1, stereo: 1 });
      await driveTool(k.api, findToolbarItem("charge-minus")!.driver, () => false);
      expect(k.tool).toHaveBeenLastCalledWith("charge", -1);
    });
    it("stamps a parsed group through the template tool", async () => {
      const k = makeKetcher();
      await driveTool(k.api, { kind: "stamp", molfile: FUNCTIONAL_GROUPS[3]!.molfile }, () => false);
      expect(k.parse).toHaveBeenCalledWith(FUNCTIONAL_GROUPS[3]!.molfile);
      expect(k.tool).toHaveBeenCalledWith("template", { struct: { parsed: true } });
    });
    it("clicks a native button and reports a missing one", async () => {
      const k = makeKetcher();
      const click = vi.fn().mockReturnValue(true);
      await expect(driveTool(k.api, findToolbarItem("ring-benzene")!.driver, click)).resolves.toBe(true);
      expect(click).toHaveBeenCalledWith("template-0");
      await expect(driveTool(k.api, findToolbarItem("cleanup")!.driver, () => false)).resolves.toBe(false);
    });
    it("runs undo and redo", async () => {
      const k = makeKetcher();
      await driveTool(k.api, findToolbarItem("undo")!.driver, () => false);
      await driveTool(k.api, findToolbarItem("redo")!.driver, () => false);
      expect(k.undo).toHaveBeenCalledOnce();
      expect(k.redo).toHaveBeenCalledOnce();
    });
  });
});

describe("export filename", () => {
  it("uses the molecule name and the extension", () => {
    expect(exportFilename("Ethanol", "svg")).toBe("Ethanol.svg");
    expect(exportFilename("  n-Hexane  ", "png")).toBe("n-Hexane.png");
    expect(exportFilename("Бензол β", "svg")).toBe("Бензол-β.svg");
  });
  it("falls back for empty names and strips unsafe characters", () => {
    expect(exportFilename("", "svg")).toBe("drawn-molecule.svg");
    expect(exportFilename("   ", "png")).toBe("drawn-molecule.png");
    expect(exportFilename('a/b\\c:d*e?"f<g>h|i', "svg")).toBe("a-b-c-d-e-f-g-h-i.svg");
    expect(exportFilename("../../etc/passwd", "svg")).toBe("etc-passwd.svg");
    expect(exportFilename("...", "svg")).toBe("drawn-molecule.svg");
  });
  it("limits the length", () => expect(exportFilename("x".repeat(200), "svg")).toBe(`${"x".repeat(80)}.svg`));
});

describe("drawing checks", () => {
  it("parses Indigo gross formulas and counts heavy atoms", () => {
    expect(parseGrossFormula("C2 H6 O")).toEqual({ formula: "C2H6O", heavyAtoms: 3, counts: { C: 2, H: 6, O: 1 }, molecules: [] });
    expect(parseGrossFormula("H2 O")?.heavyAtoms).toBe(1);
    expect(parseGrossFormula("C H4")?.formula).toBe("CH4");
    expect(parseGrossFormula("")).toBeNull();
    expect(parseGrossFormula("not a formula")).toBeNull();
    expect(parseGrossFormula(undefined)).toBeNull();
  });
  it("splits a formula into subscript runs", () => expect(formulaRuns("C2H6O")).toEqual([{ text: "C", sub: false }, { text: "2", sub: true }, { text: "H", sub: false }, { text: "6", sub: true }, { text: "O", sub: false }]));
  it("summarises Indigo check results", () => {
    expect(summarizeCheck(null)).toBeNull();
    expect(summarizeCheck({})).toEqual({ valence: { ok: true, text: "No issues found" }, stereo: { none: true, text: "None defined" }, other: [] });
    const flagged = summarizeCheck({ valence: "Structure contains atoms with unusual valence", chiral: "Structure contains chirality", overlapping_atoms: "Structure contains overlapping atoms" });
    expect(flagged?.valence).toEqual({ ok: false, text: "Structure contains atoms with unusual valence" });
    expect(flagged?.stereo).toEqual({ none: false, text: "Structure contains chirality" });
    expect(flagged?.other).toEqual([{ id: "overlapping_atoms", text: "Structure contains overlapping atoms" }]);
  });
  it("describes a selected atom only from Ketcher's fields", () => {
    expect(describeSelectedAtom({ label: "N", charge: 1, valence: 4 })).toEqual({ element: "N", charge: 1, valence: 4 });
    expect(describeSelectedAtom({ label: "C", charge: null, valence: undefined })).toEqual({ element: "C", charge: 0, valence: null });
    expect(describeSelectedAtom(null)).toBeNull();
    expect(describeSelectedAtom({ label: "" })).toBeNull();
    expect(formatCharge(0)).toBe("0 (neutral)");
    expect(formatCharge(-2)).toBe("−2");
    expect(formatCharge(1)).toBe("+1");
  });
});

describe("export filename separators", () => {
  it("does not stack separators around replaced characters", () => {
    expect(exportFilename("My ethanol / test", "svg")).toBe("My-ethanol-test.svg");
    expect(exportFilename("n-Hexane", "svg")).toBe("n-Hexane.svg");
  });
});

describe("readMolfile", () => {
  const MOL = "\n  x\n\n  1  0  0  0  0  0  0  0  0  0999 V2000\n    0.0 0.0 0.0 C   0\nM  END\n";
  it("returns a MOL block unchanged", async () => {
    const source = { getMolfile: vi.fn().mockResolvedValue(MOL), getSmiles: vi.fn() };
    await expect(readMolfile(source)).resolves.toBe(MOL);
    expect(source.getSmiles).not.toHaveBeenCalled();
  });
  it("retries when Ketcher returns a bare sequence", async () => {
    const getMolfile = vi.fn().mockResolvedValueOnce("CCN").mockResolvedValueOnce(MOL);
    await expect(readMolfile({ getMolfile, getSmiles: vi.fn() })).resolves.toBe(MOL);
    expect(getMolfile).toHaveBeenCalledTimes(2);
  });
  it("rebuilds the MOL block from SMILES with Indigo when every read is a sequence", async () => {
    const convert = vi.fn().mockResolvedValue({ struct: MOL });
    const source = { getMolfile: vi.fn().mockResolvedValue("CCN"), getSmiles: vi.fn().mockResolvedValue("CCN"), indigo: { convert } };
    await expect(readMolfile(source)).resolves.toBe(MOL);
    expect(convert).toHaveBeenCalledWith("CCN", { outputFormat: "chemical/x-mdl-molfile" });
  });
  it("gives up with the last read when nothing can be rebuilt", async () => {
    const source = { getMolfile: vi.fn().mockResolvedValue("CCN"), getSmiles: vi.fn().mockResolvedValue("") };
    await expect(readMolfile(source)).resolves.toBe("CCN");
  });
});

describe("serializeKetcher", () => {
  it("runs asynchronous calls one at a time, in order, and leaves synchronous members alone", async () => {
    const log: string[] = [];
    let running = 0;
    let overlapped = false;
    const slow = (name: string, ms: number) => async () => {
      running += 1; overlapped ||= running > 1; log.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      log.push(`end ${name}`); running -= 1; return name;
    };
    const raw = {
      getMolfile: slow("mol", 20), getSmiles: slow("smiles", 1), calculate: slow("calc", 5),
      indigo: { check: slow("check", 5), convert: slow("convert", 1) },
      formatterFactory: { create: () => ({ getStructureFromStringAsync: slow("parse", 1) }) },
      editor: { tool: vi.fn(() => "tool-result") },
      changeEvent: { add: vi.fn() },
    };
    const safe = serializeKetcher(raw);
    const results = await Promise.all([safe.getMolfile(), safe.getSmiles(), safe.indigo.check(), safe.calculate(), safe.formatterFactory.create().getStructureFromStringAsync()]);
    expect(results).toEqual(["mol", "smiles", "check", "calc", "parse"]);
    expect(overlapped).toBe(false);
    expect(log.slice(0, 4)).toEqual(["start mol", "end mol", "start smiles", "end smiles"]);
    expect(safe.editor.tool()).toBe("tool-result");
    safe.changeEvent.add(() => undefined);
    expect(raw.changeEvent.add).toHaveBeenCalled();
  });
  it("keeps the queue alive after a failing call", async () => {
    const safe = serializeKetcher({ getSmiles: async () => { throw new Error("boom"); }, getMolfile: async () => "ok" });
    await expect(safe.getSmiles()).rejects.toThrow("boom");
    await expect(safe.getMolfile()).resolves.toBe("ok");
  });
});

describe("multi-fragment formulas (Indigo reports one formula per fragment, separated by ';')", () => {
  it("adds up six waters and counts the molecules", () => {
    const gross = parseGrossFormula("H2 O; H2 O; H2 O; H2 O; H2 O; H2 O");
    expect(gross?.formula).toBe("H12O6");
    expect(gross?.heavyAtoms).toBe(6);
    expect(gross?.molecules).toEqual([{ formula: "H2O", count: 6 }]);
    expect(describeMolecules(gross!.molecules)).toBe("6 × H2O");
  });

  it("keeps different molecules apart and uses Hill order for the total", () => {
    const gross = parseGrossFormula("C2 H6 O; H2 O; C2 H6 O");
    expect(gross?.formula).toBe("C4H14O3");
    expect(describeMolecules(gross!.molecules)).toBe("2 × C2H6O + 1 × H2O");
    expect(gross?.heavyAtoms).toBe(7);
  });

  it("orders without carbon alphabetically and drops count 1", () => {
    expect(hillFormula({ O: 1, H: 2 })).toBe("H2O");
    expect(hillFormula({ N: 1, H: 3, Cl: 1 })).toBe("ClH3N");
    expect(parseGrossFormula("C H4; ; ")?.molecules).toEqual([]);
    expect(parseGrossFormula("not a formula; H2 O")).toBeNull();
  });
});
