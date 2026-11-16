import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

/**
 * RW-2 repair: historical standing of a CUBE export must survive the Next proxy and the file itself.
 * Runs against the disposable evidence copy (tools/rw2_evidence_stack.py); see rw2-evidence-viewers.spec.ts.
 */
const PROJECT = "3537048e-306a-4f4f-9b9e-493681c0df83";
const FOREIGN_PROJECT = "f39aefcf-a1cd-4606-8f03-f9b18eadb96d";
const CALCULATION = "d964b79f-a9dc-4e85-b6bd-b6e35c3385a3";
const API = "/api/chemdft";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function parseCube(text: string) {
  const lines = text.split("\n");
  const natoms = Number(lines[2]!.trim().split(/\s+/)[0]);
  const axes = [3, 4, 5].map((i) => lines[i]!.trim().split(/\s+/).map(Number));
  return {
    comments: [lines[0]!, lines[1]!], natoms,
    origin: lines[2]!.trim().split(/\s+/).slice(1).map(Number),
    dims: axes.map((a) => a[0]!), step: axes[0]![1]!,
    values: lines.slice(6 + natoms).join(" ").trim().split(/\s+/).map(Number),
  };
}

test.describe.configure({ mode: "serial" });

test.describe("CUBE evidence standing through the Next proxy", () => {
  test.setTimeout(120_000);
  let variant = "";
  let stored: Json;

  test("a currently active CUBE says CURRENT in the header, no-store and the file", async ({ request }) => {
    const catalog = (await (await request.get(`${API}/v1/projects/${PROJECT}/calculations/${CALCULATION}/exports`)).json()) as Json;
    const cube = catalog.formats.find((f: Json) => f.format === "cube");
    variant = cube.variants.find((v: Json) => /density/i.test(v.label)).key;
    const response = await request.get(`${API}/v1/projects/${PROJECT}/calculations/${CALCULATION}/export?format=cube&variant=${variant}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["x-chemdft-evidence-use"]).toBe("CURRENT");
    expect(response.headers()["cache-control"]).toBe("no-store");
    const cubeFile = parseCube(await response.text());
    expect(cubeFile.comments.join(" ")).toContain("EVIDENCE_USE=CURRENT");
    stored = (await (await request.post(`${API}/v1/projects/${PROJECT}/calculations/${CALCULATION}/fields/grid`, { data: { field_kind: "ELECTRON_DENSITY" } })).json()) as Json;
    expect(cubeFile.dims).toEqual(stored.manifest.dimensions);
    expect(cubeFile.values.length).toBe(stored.field_values.length);
    expect(cubeFile.values.every((v, i) => Math.fround(v) === Math.fround(stored.field_values[i]))).toBe(true);
  });

  test("a SUPERSEDED CUBE keeps its historical standing end to end", async ({ request }) => {
    const db = process.env.RW2_EVIDENCE_DB;
    test.skip(!db, "RW2_EVIDENCE_DB is required to supersede evidence in the disposable copy");
    const result = ((await (await request.get(`${API}/v1/projects/${PROJECT}/results`)).json()) as Json[])[0]!;
    const handle = new DatabaseSync(db!);
    const original = handle.prepare("select * from provenance_records where id = ?").get(result.provenance_record_id) as Json;
    const successor: Json = { ...original, id: randomUUID(), subject_id: randomUUID(), supersedes_id: original.id, verification_state: "SUPERSEDED", correlation_id: randomUUID() };
    const columns = Object.keys(successor);
    handle.prepare(`insert into provenance_records (${columns.join(",")}) values (${columns.map(() => "?").join(",")})`).run(...columns.map((c) => successor[c]));
    handle.close();

    const response = await request.get(`${API}/v1/projects/${PROJECT}/calculations/${CALCULATION}/export?format=cube&variant=${variant}`);
    expect(response.status()).toBe(200);
    // through the Next proxy: standing and cache policy are visible to the browser
    expect(response.headers()["x-chemdft-evidence-use"]).toBe("HISTORICAL_ONLY");
    expect(response.headers()["cache-control"]).toBe("no-store");
    // and inside the file, independent of any header
    const cubeFile = parseCube(await response.text());
    const comments = cubeFile.comments.join(" ");
    expect(comments).toContain("EVIDENCE_USE=HISTORICAL_ONLY");
    expect(comments).toContain("LINEAGE=SUPERSEDED");
    expect(comments).toContain("VERIFICATION=UNVERIFIED");
    expect(comments).not.toContain("EVIDENCE_USE=CURRENT");
    // numbers, geometry and units are unchanged by the standing
    expect(cubeFile.dims).toEqual(stored.manifest.dimensions);
    expect(cubeFile.values.every((v, i) => Math.fround(v) === Math.fround(stored.field_values[i]))).toBe(true);
    expect(comments).toContain("e/bohr^3");
  });

  test("ownership is enforced through the proxy", async ({ request }) => {
    const foreign = await request.get(`${API}/v1/projects/${FOREIGN_PROJECT}/calculations/${CALCULATION}/export?format=cube&variant=${variant}`);
    expect(foreign.status()).toBe(404);
    expect(foreign.headers()["x-chemdft-evidence-use"]).toBeUndefined();
    const missing = await request.get(`${API}/v1/projects/${randomUUID()}/calculations/${CALCULATION}/export?format=cube&variant=${variant}`);
    expect(missing.status()).toBe(404);
  });

  test("protected downloads are no-store even without standing headers (lineage JSON, errors)", async ({ request }) => {
    const result = ((await (await request.get(`${API}/v1/projects/${PROJECT}/results`)).json()) as Json[])[0]!;
    const lineage = await request.get(`${API}/v1/projects/${PROJECT}/results/${result.id}/export`);
    expect(lineage.status()).toBe(200);
    expect(lineage.headers()["x-chemdft-evidence-use"]).toBeUndefined(); // this route sets no standing header
    expect(lineage.headers()["cache-control"]).toBe("no-store");
    const missing = await request.get(`${API}/v1/projects/${FOREIGN_PROJECT}/results/${result.id}/export`);
    expect(missing.status()).toBe(404);
    expect(missing.headers()["cache-control"]).toBe("no-store");
  });
});
