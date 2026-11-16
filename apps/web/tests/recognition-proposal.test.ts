import { describe, expect, it } from "vitest";
import { latestRecognitionRepresentations, recognitionProposalFromDetail } from "../src/lib/recognition-proposal";

const row = (id: string, type: string, revision: number, origin = "IMAGE_RECONSTRUCTION") =>
  ({ id, representation_type: type, representation_origin: origin, revision }) as {
    id: string;
    representation_type: never;
    representation_origin: never;
    revision: number;
  };

describe("recognition proposal reload", () => {
  it("selects the newest recognition SMILES and the MOL block stored behind it", () => {
    const rows = [
      row("img", "IMAGE_REFERENCE", 1, "SOURCE_REFERENCE"),
      row("smi-1", "SMILES", 2),
      row("mol-1", "MOL_BLOCK", 3),
      row("smi-2", "SMILES", 4),
      row("mol-2", "MOL_BLOCK", 5),
    ];
    const latest = latestRecognitionRepresentations(rows);
    expect(latest.smiles?.id).toBe("smi-2");
    expect(latest.mol?.id).toBe("mol-2");
  });

  it("does not pair a stale MOL block with a newer SMILES, and ignores user-drawn SMILES", () => {
    const latest = latestRecognitionRepresentations([
      row("smi-1", "SMILES", 2),
      row("mol-1", "MOL_BLOCK", 3),
      row("smi-2", "SMILES", 4), // parse failure: no depiction stored
      row("user", "SMILES", 9, "USER_DRAFT"),
    ]);
    expect(latest.smiles?.id).toBe("smi-2");
    expect(latest.mol).toBeNull();
    expect(latestRecognitionRepresentations([row("user", "SMILES", 1, "USER_DRAFT")])).toEqual({ smiles: null, mol: null });
  });

  it("returns the stored proposal verbatim and never fabricates one", () => {
    const stored = {
      status: "AMBIGUOUS",
      recognition_engine: "DECIMER-Image_Transformer",
      formula: "C2H3O2",
      formal_charge: -1,
      unresolved_ambiguities: ["Multi-component mixture or salt proposal."],
    };
    expect(recognitionProposalFromDetail({ recognition_proposal: stored })).toEqual(stored);
    expect(recognitionProposalFromDetail({})).toBeNull();
    expect(recognitionProposalFromDetail({ recognition_proposal: null })).toBeNull();
    expect(recognitionProposalFromDetail({ recognition_proposal: { smiles: "CCO" } })).toBeNull();
  });
});
