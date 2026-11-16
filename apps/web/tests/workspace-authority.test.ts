import { describe, expect, it } from "vitest";
import type { WorkspaceCatalogItem } from "../src/app/_components/workspace-state-provider";
import {
  evidenceVocabularyTooltip,
  structureAuthorityCounts,
  structureAuthorityLabel,
  structureAuthorityTooltip,
} from "../src/lib/workspace-authority";

function structureItem(kind: string, id: string, sourceId?: string): WorkspaceCatalogItem {
  return {
    section: "structures",
    label: id,
    detail: "",
    selection: {
      kind,
      id,
      projectId: "project-1",
      ...(sourceId ? { sourceId } : {}),
    },
  } as WorkspaceCatalogItem;
}

describe("Explorer structure authority counts and label mapping (Release 0.0.33)", () => {
  it("counts committed structures and candidates separately and excludes representations", () => {
    const counts = structureAuthorityCounts([
      structureItem("structureVersion", "version-1", "structure-1"),
      structureItem("structureVersion", "version-2", "structure-1"),
      structureItem("structureCandidate", "candidate-1"),
      structureItem("candidateRepresentation", "representation-1", "candidate-1"),
    ]);

    expect(counts).toEqual({ committed: 1, candidates: 1 });
    // Release 0.0.33: shows "Saved" instead of "Committed" and drops the candidate overlap line
    expect(structureAuthorityLabel(counts)).toBe("1 saved");
    expect(
      structureAuthorityLabel(
        structureAuthorityCounts([
          structureItem("structureCandidate", "candidate-1"),
          structureItem("candidateRepresentation", "representation-1", "candidate-1"),
        ]),
      ),
    ).toBe("0 saved");
  });

  it("provides rich scientific tooltip retaining exact docs/02 evidence vocabulary", () => {
    const counts = structureAuthorityCounts([
      structureItem("structureVersion", "version-1", "structure-1"),
      structureItem("structureCandidate", "candidate-1"),
    ]);

    expect(structureAuthorityTooltip(counts)).toContain("1 saved structure version (committed Cartesian coordinates)");
    expect(structureAuthorityTooltip(counts)).toContain("1 candidate awaiting review");
  });

  it("maps scientific evidence vocabulary to plain-language tooltips without renaming codes", () => {
    expect(evidenceVocabularyTooltip("COMMITTED")).toBe(
      "Saved · validated structure version with committed Cartesian coordinates",
    );
    expect(evidenceVocabularyTooltip("CANDIDATE")).toBe(
      "Candidate · unreviewed proposal awaiting researcher review",
    );
    expect(evidenceVocabularyTooltip("CALCULATED")).toContain("Scientific Result Firewall");
    expect(evidenceVocabularyTooltip("IMPORTED")).toContain("Imported from an external program");
    expect(evidenceVocabularyTooltip("EXPERIMENTAL")).toContain("Measured experimental data");
  });
});
