import { afterEach, expect, it, vi } from "vitest";
import { CandidateApiError, createCandidateRepresentation, generateCandidateConformer, reviewCandidateRepresentation, validateCandidateGraph } from "../src/lib/phase7-api";

// Isolated transport-only unit tests. Chemical correctness is covered by real RDKit acceptance.
afterEach(() => vi.unstubAllGlobals());
it("sends MOL headers and blank title unchanged, with explicit source lineage", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ is_valid: true }), { status: 200 })));
  vi.stubGlobal("fetch", fetchMock);
  const mol = "\n  Ketcher\n\n  1  0  0  0  0  0            999 V2000\nM  END\n";
  await validateCandidateGraph("project", "candidate", { content: mol, format: "MOL", parent_representation_id: "proposal" });
  await createCandidateRepresentation("project", "candidate", { representation_type: "MOL", mol_block: mol, parent_representation_id: "proposal" });
  expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)).content).toBe(mol);
  expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toEqual({ representation_type: "MOL", mol_block: mol, parent_representation_id: "proposal" });
});
it("never fills missing stereo or charge reviews and sends explicit false unchanged", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response("{}")));
  vi.stubGlobal("fetch", fetchMock);
  await reviewCandidateRepresentation("p", "c", "r", { stereochemistry_reviewed: false, charges_reviewed: false });
  await reviewCandidateRepresentation("p", "c", "r");
  expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({ checklist: { stereochemistry_reviewed: false, charges_reviewed: false } });
  expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toEqual({});
});
it.each([
  [400, { detail: "Malformed graph" }, "Malformed graph"],
  [403, { detail: "Project edit access required." }, "Project edit access required."],
  [404, { detail: "Candidate not found" }, "Candidate not found"],
  [409, { detail: "REVISION_CONFLICT" }, "Your drawing has been kept"],
  [422, { detail: [{ loc: ["body", "content"], msg: "Field required" }] }, "Field required"],
  [422, { detail: { code: "INVALID_GRAPH", message: "Invalid valence" } }, "Invalid valence"],
  [500, {}, "500"], [503, { detail: "Worker unavailable" }, "Worker unavailable"],
])("reports HTTP %s errors without retrying scientific mutations", async (status, body, expected) => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  const promise = generateCandidateConformer("p", "c", "r", { name: "Explicit conformer", multiplicity: 1 });
  await expect(promise).rejects.toBeInstanceOf(CandidateApiError);
  await expect(promise).rejects.toThrow(expected);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
