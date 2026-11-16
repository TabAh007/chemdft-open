/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures are mutated structurally to build edge cases */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StructureSummary, StructureVersionDetail } from "@chemdft/schemas";
import water from "../../../packages/scientific-scene/tests/fixtures/water-version.json";
import {
  PROJECT_SORTS,
  SLUG_PATTERN,
  deriveSlug,
  distinctRoles,
  folderTone,
  formatCreated,
  isInternalFixture,
  matchesQuery,
  sortProjects,
  splitFixtures,
} from "../src/lib/project-list";
import {
  MAX_PREVIEW_ATOMS,
  buildPreviewModel,
  candidateStructures,
  clearProjectPreviewCaches,
  hillFormula,
  loadProjectPreview,
  principalFrame,
  resetProjectPreviews,
  selectLatestCommitted,
} from "../src/lib/project-structure-preview";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
type Edit = {
  project?: string;
  structure?: string;
  version?: string;
  revision?: number;
  created?: string;
  name?: string;
  atoms?: Array<[string, number, number, number]>;
};
/** A StructureVersionDetail derived from the repository's own water fixture (never invented geometry). */
function detail(edit: Edit = {}): StructureVersionDetail {
  const base: any = clone(water);
  const project = edit.project ?? PROJECT;
  const structureId = edit.structure ?? "aaaaaaaa-0000-4000-8000-000000000001";
  const versionId = edit.version ?? "bbbbbbbb-0000-4000-8000-000000000001";
  base.structure.project_id = project;
  base.structure.id = structureId;
  if (edit.name) base.structure.name = edit.name;
  base.version.project_id = project;
  base.version.structure_id = structureId;
  base.version.id = versionId;
  base.version.revision = edit.revision ?? 1;
  base.version.created_at = edit.created ?? "2026-10-01T10:00:00";
  base.version.coordinates.structure_version_id = versionId;
  base.version.coordinates.source.project_id = project;
  base.version.representation_artifacts = base.version.representation_artifacts.map((r: any) => ({ ...r, project_id: project }));
  if (edit.atoms) {
    base.version.coordinates.atoms = edit.atoms.map(([element, x, y, z], index) => ({
      index,
      atomic_number: element === "H" ? 1 : 6,
      element,
      x,
      y,
      z,
      isotope: null,
      formal_charge: null,
      label: null,
      occupancy: null,
    }));
    base.version.coordinates.bonds = [];
  }
  return base as StructureVersionDetail;
}

describe("project list logic", () => {
  const projects = [
    { id: "a", name: "Benzene study", slug: "benzene-study", role: "owner", created_at: "2026-10-02T00:00:00" },
    { id: "b", name: "alpha water", slug: "water-hf", role: "viewer", created_at: "2026-10-03T00:00:00" },
    { id: "c", name: "Caffeine", slug: "caf", role: "owner", created_at: "2026-10-02T00:00:00" },
  ];
  it("searches name and slug case-insensitively and shows everything for an empty query", () => {
    expect(projects.filter((p) => matchesQuery(p, "BENZ")).map((p) => p.id)).toEqual(["a"]);
    expect(projects.filter((p) => matchesQuery(p, "water-HF")).map((p) => p.id)).toEqual(["b"]);
    expect(projects.filter((p) => matchesQuery(p, "  ")).length).toBe(3);
    expect(projects.filter((p) => matchesQuery(p, "zzz")).length).toBe(0);
  });
  it("sorts on real metadata only and is stable on ties", () => {
    expect(PROJECT_SORTS.map((s) => s.id)).toEqual(["newest", "oldest", "name-asc", "name-desc"]);
    expect(PROJECT_SORTS.map((s) => s.label).join(" ")).not.toMatch(/modified/i);
    expect(sortProjects(projects, "newest").map((p) => p.id)).toEqual(["b", "a", "c"]); // a and c tie on created_at → by name
    expect(sortProjects(projects, "oldest").map((p) => p.id)).toEqual(["a", "c", "b"]);
    expect(sortProjects(projects, "name-asc").map((p) => p.id)).toEqual(["b", "a", "c"]);
    expect(sortProjects(projects, "name-desc").map((p) => p.id)).toEqual(["c", "a", "b"]);
    const before = JSON.stringify(projects);
    sortProjects(projects, "name-desc");
    expect(JSON.stringify(projects)).toBe(before);
  });
  it("derives valid slugs and exposes only roles that exist", () => {
    expect(deriveSlug("Water cluster solvation!")).toBe("water-cluster-solvation");
    expect(deriveSlug("  --  Test__ 1 ")).toBe("test-1");
    expect(SLUG_PATTERN.test(deriveSlug("Catalyst screening 2026"))).toBe(true);
    expect(SLUG_PATTERN.test("Bad_Slug")).toBe(false);
    expect(SLUG_PATTERN.test("double--hyphen")).toBe(false);
    expect(distinctRoles(projects)).toEqual(["owner", "viewer"]);
  });
  it("keeps the previous internal-fixture rules and never hides ordinary projects", () => {
    expect(isInternalFixture({ id: "x", name: "P7 debug", slug: "p7-debug" })).toBe(true);
    expect(isInternalFixture({ id: "x", name: "Acceptance run", slug: "acceptance-1" })).toBe(true);
    expect(isInternalFixture({ id: "x", name: "Hosted beta check", slug: "hosted-beta-check" })).toBe(false);
    expect(isInternalFixture({ id: "f39aefcf-a1cd-4606-8f03-f9b18eadb96d", name: "debug", slug: "debug" })).toBe(false);
    const split = splitFixtures([
      { id: "1", name: "Kimi check", slug: "kimi" },
      { id: "2", name: "phase7 thing", slug: "p" },
    ]);
    expect(split.primary.map((p) => p.id)).toEqual(["1"]);
    expect(split.internal.map((p) => p.id)).toEqual(["2"]);
  });
  it("formats created dates safely and picks a deterministic accent tone", () => {
    expect(formatCreated(null)).toBeNull();
    expect(formatCreated("not-a-date")).toBeNull();
    expect(formatCreated("2026-10-18T09:00:00", "en-US")).toBe("Oct 18, 2026");
    expect(folderTone("abc")).toBe(folderTone("abc"));
    expect(["blue", "teal", "indigo", "orange"]).toContain(folderTone("xyz"));
  });
});

describe("latest committed structure selection", () => {
  it("picks the newest created version, then the highest revision, then the smallest id", () => {
    const older = detail({ structure: "aaaaaaaa-0000-4000-8000-0000000000a1", version: "bbbbbbbb-0000-4000-8000-0000000000a1", created: "2026-10-01T10:00:00", revision: 5 });
    const newer = detail({ structure: "aaaaaaaa-0000-4000-8000-0000000000a2", version: "bbbbbbbb-0000-4000-8000-0000000000a2", created: "2026-10-02T10:00:00", revision: 1 });
    expect(selectLatestCommitted(PROJECT, [older, newer])?.version.id).toBe(newer.version.id);
    const sameTimeHigher = detail({ structure: older.structure.id, version: "bbbbbbbb-0000-4000-8000-0000000000a3", created: "2026-10-02T10:00:00", revision: 2 });
    expect(selectLatestCommitted(PROJECT, [newer, sameTimeHigher])?.version.id).toBe(sameTimeHigher.version.id);
    const tieA = detail({ version: "bbbbbbbb-0000-4000-8000-0000000000b1", structure: "aaaaaaaa-0000-4000-8000-0000000000b1", created: "2026-10-03T10:00:00", revision: 1 });
    const tieB = detail({ version: "bbbbbbbb-0000-4000-8000-0000000000b2", structure: "aaaaaaaa-0000-4000-8000-0000000000b2", created: "2026-10-03T10:00:00", revision: 1 });
    expect(selectLatestCommitted(PROJECT, [tieB, tieA])?.version.id).toBe(tieA.version.id);
    expect(selectLatestCommitted(PROJECT, [tieA, tieB])?.version.id).toBe(tieA.version.id);
  });
  it("only accepts versions that provably belong to the project and its structure and that carry coordinates", () => {
    const foreign = detail({ project: OTHER, created: "2030-01-01T00:00:00" });
    const mismatched = detail({ created: "2031-01-01T00:00:00" });
    (mismatched.version as { structure_id: string }).structure_id = "cccccccc-0000-4000-8000-000000000009";
    const empty = detail({ created: "2032-01-01T00:00:00" });
    (empty.version.coordinates as { atoms: unknown[] }).atoms = [];
    const noCoordinates = detail({ created: "2033-01-01T00:00:00" });
    (noCoordinates.version as { coordinates: unknown }).coordinates = null;
    const good = detail({ created: "2026-01-01T00:00:00" });
    expect(selectLatestCommitted(PROJECT, [foreign, mismatched, empty, noCoordinates, good])?.version.id).toBe(good.version.id);
    expect(selectLatestCommitted(PROJECT, [foreign, mismatched, empty, noCoordinates])).toBeNull();
    expect(selectLatestCommitted(PROJECT, [])).toBeNull();
  });
  it("limits and orders candidate structures stably and ignores other projects", () => {
    const make = (id: string, project: string, updated: string) =>
      ({ id, project_id: project, name: id, kind: "MOLECULE", latest_version_id: `v-${id}`, latest_revision: 1, atom_count: 1, bond_count: 0, diagnostic_counts: {}, created_at: updated, updated_at: updated }) as unknown as StructureSummary;
    const summaries = [
      make("s1", PROJECT, "2026-01-01T00:00:00"),
      make("s2", PROJECT, "2026-03-01T00:00:00"),
      make("s3", OTHER, "2026-09-01T00:00:00"),
      ...Array.from({ length: 10 }, (_, i) => make(`t${i}`, PROJECT, `2026-02-0${(i % 9) + 1}T00:00:00`)),
    ];
    const picked = candidateStructures(PROJECT, summaries);
    expect(picked.length).toBe(6);
    expect(picked[0]!.id).toBe("s2");
    expect(picked.some((s) => s.project_id !== PROJECT)).toBe(false);
  });
});

describe("thumbnail model", () => {
  it("writes the Hill formula", () => {
    expect(hillFormula(["O", "H", "H"])).toBe("H2O");
    expect(hillFormula(["C", "H", "H", "H", "H"])).toBe("CH4");
    expect(hillFormula(["N", "C", "C", "O", "H"])).toBe("C2HNO");
    expect(hillFormula(["Cr", "O", "O", "O", "Cr"])).toBe("Cr2O3");
    expect(hillFormula(["H", "H"])).toBe("H2");
  });
  it("draws exactly the persisted atoms, with inferred bonds flagged as display-only", () => {
    const result = buildPreviewModel(detail({ name: "TEST WATER" }));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.model.formula).toBe("H2O");
    expect(result.model.atoms.map((a) => a.element).sort()).toEqual(["H", "H", "O"]);
    expect(result.model.structureName).toBe("TEST WATER");
    expect(result.model.bonds.length).toBe(2);
    expect(result.model.inferredBonds).toBe(true);
    expect(result.model.cell).toEqual([]);
    for (const a of result.model.atoms) expect(Math.abs(a.x) + a.r).toBeLessThanOrEqual(50);
    expect(JSON.stringify(buildPreviewModel(detail({ name: "TEST WATER" })))).toBe(JSON.stringify(result));
  });
  it("shows H2 as H2 (two atoms) and never adds atoms", () => {
    const h2 = buildPreviewModel(detail({ atoms: [["H", 0, 0, 0], ["H", 0, 0, 0.7414]] }));
    expect(h2.status === "ready" && h2.model.atoms.length).toBe(2);
    expect(h2.status === "ready" && h2.model.formula).toBe("H2");
    expect(h2.status === "ready" && h2.model.bonds.length).toBe(1);
  });
  it("uses the real lattice for periodic structures, with no inferred bonds and no invented cell", () => {
    const crystal = detail({ atoms: [["C", 0, 0, 0], ["C", 0.5, 0.5, 0.5]] }) as any;
    crystal.structure.kind = "PERIODIC";
    crystal.version.coordinates.coordinate_system = "FRACTIONAL";
    crystal.version.periodic_cell = { unit: "angstrom", a: 3, b: 3, c: 3, alpha: 90, beta: 90, gamma: 90, lattice_vectors: [[3, 0, 0], [0, 3, 0], [0, 0, 3]], periodic_dimensions: [true, true, true] };
    const result = buildPreviewModel(crystal);
    expect(result.status === "ready" && result.model.kind).toBe("periodic");
    expect(result.status === "ready" && result.model.cell.length).toBe(12);
    expect(result.status === "ready" && result.model.inferredBonds).toBe(false);
    const molecule = buildPreviewModel(detail());
    expect(molecule.status === "ready" && molecule.model.cell.length).toBe(0);
  });
  it("declines honestly: too large, no coordinates", () => {
    const big = buildPreviewModel(detail({ atoms: Array.from({ length: MAX_PREVIEW_ATOMS + 1 }, (_, i) => ["C", i, 0, 0] as [string, number, number, number]) }));
    expect(big.status).toBe("large");
    const none = detail();
    (none.version as { coordinates: unknown }).coordinates = null;
    expect(buildPreviewModel(none).status).toBe("unavailable");
  });
  it("orients molecules with a proper rotation, so chirality is never mirrored", () => {
    const pts: Array<readonly [number, number, number]> = [[0, 0, 0], [1.4, 0.2, 0.1], [-0.3, 1.1, 0.4], [0.2, -0.4, 1.3], [0.9, 0.8, -0.7]];
    const [e1, e2, e3] = principalFrame(pts);
    const det = e1![0]! * (e2![1]! * e3![2]! - e2![2]! * e3![1]!) - e1![1]! * (e2![0]! * e3![2]! - e2![2]! * e3![0]!) + e1![2]! * (e2![0]! * e3![1]! - e2![1]! * e3![0]!);
    expect(det).toBeCloseTo(1, 6);
    expect(Math.hypot(...e1!)).toBeCloseTo(1, 6);
    expect(Math.hypot(...e2!)).toBeCloseTo(1, 6);
  });
});

describe("loading from the authenticated API", () => {
  const calls: string[] = [];
  const s1 = detail({ structure: "aaaaaaaa-0000-4000-8000-0000000000c1", version: "bbbbbbbb-0000-4000-8000-0000000000c1", created: "2026-10-01T10:00:00", name: "Older" });
  const s2 = detail({ structure: "aaaaaaaa-0000-4000-8000-0000000000c2", version: "bbbbbbbb-0000-4000-8000-0000000000c2", created: "2026-10-05T10:00:00", name: "Newest" });
  const summary = (d: StructureVersionDetail) => ({
    id: d.structure.id,
    project_id: d.structure.project_id,
    name: d.structure.name,
    kind: "MOLECULE",
    latest_version_id: d.version.id,
    latest_revision: d.version.revision,
    atom_count: 3,
    bond_count: 0,
    diagnostic_counts: {},
    created_at: d.structure.created_at,
    updated_at: d.version.created_at,
  });
  beforeEach(() => {
    calls.length = 0;
    resetProjectPreviews();
    vi.stubGlobal("fetch", async (input: string) => {
      const url = String(input);
      calls.push(url);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (url.includes(`/projects/${OTHER}/`)) return json({ detail: "forbidden" }, 403);
      if (url.endsWith(`/projects/${PROJECT}/structures`)) return json([summary(s1), summary(s2)]);
      const match = url.match(/versions\/([^/?]+)/);
      const found = [s1, s2].find((d) => d.version.id === match?.[1]);
      return found ? json(found) : json({ detail: "missing" }, 404);
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("chooses the latest committed version across structures and reads only project-scoped endpoints", async () => {
    const result = await loadProjectPreview(PROJECT);
    expect(result.status === "ready" && result.model.structureName).toBe("Newest");
    expect(calls.every((url) => url.includes(`/v1/projects/${PROJECT}/structures`))).toBe(true);
  });
  it("is requested once per visit and does not repeat the fetch", async () => {
    await loadProjectPreview(PROJECT);
    const first = calls.length;
    await loadProjectPreview(PROJECT);
    expect(calls.length).toBe(first);
  });
  it("reports an inaccessible project as unavailable without a drawing", async () => {
    expect((await loadProjectPreview(OTHER)).status).toBe("unavailable");
  });
});

describe("dashboard source contracts", () => {
  const client = read("../src/app/[locale]/projects/projects-client.tsx");
  const thumb = read("../src/app/_components/projects/structure-thumbnail.tsx");
  const preview = read("../src/lib/project-structure-preview.ts");
  it("creates projects only through a dialog opened on demand, never a permanent form", () => {
    expect(client).toContain("<AppDialog");
    expect(client).toContain('title="Create New Project"');
    expect(client).not.toContain("create-project-panel");
    expect(client).toContain("submittingRef");
    expect(client).toContain("createProject(");
  });
  it("labels project dates as created and never as last modified", () => {
    expect(client).toContain("Created ");
    expect(client).not.toMatch(/last modified/i);
    expect(client).not.toContain("updated_at");
  });
  it("renders thumbnails as static SVG: no WebGL, canvas, 3D engine, storage, or public image location", () => {
    for (const source of [thumb, preview]) {
      expect(source).not.toMatch(/getContext|<canvas|from "three|from "3dmol|WebGLRenderer|requestAnimationFrame|toDataURL/);
      expect(source).not.toContain("localStorage");
      expect(source).not.toContain("/public/");
    }
    expect(thumb).toContain("IntersectionObserver");
  });
});

describe("freshness and isolation of thumbnails", () => {
  const calls: string[] = [];
  const older = detail({ structure: "aaaaaaaa-0000-4000-8000-0000000000d1", version: "bbbbbbbb-0000-4000-8000-0000000000d1", created: "2026-10-01T10:00:00", name: "First import" });
  const newer = detail({ structure: older.structure.id, version: "bbbbbbbb-0000-4000-8000-0000000000d2", created: "2026-10-09T10:00:00", revision: 2, name: "First import", atoms: [["H", 0, 0, 0], ["H", 0, 0, 0.7414]] });
  const summaryOf = (d: StructureVersionDetail) => ({ id: d.structure.id, project_id: d.structure.project_id, name: d.structure.name, kind: "MOLECULE", latest_version_id: d.version.id, latest_revision: d.version.revision, atom_count: 3, bond_count: 0, diagnostic_counts: {}, created_at: d.structure.created_at, updated_at: d.version.created_at });
  let committed: StructureVersionDetail[] = [];
  let hostile: ((url: string) => Response | null) | null = null;
  beforeEach(() => {
    calls.length = 0;
    committed = [older];
    hostile = null;
    clearProjectPreviewCaches();
    vi.stubGlobal("fetch", async (input: string) => {
      const url = String(input);
      calls.push(url);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      const override = hostile?.(url);
      if (override) return override;
      if (url.endsWith(`/projects/${PROJECT}/structures`)) return json(committed.map(summaryOf));
      const match = url.match(/versions\/([^/?]+)/);
      const found = committed.find((d) => d.version.id === match?.[1]);
      return found ? json(found) : json({ detail: "missing" }, 404);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it("shows the older version first, then the newer committed version on the next visit", async () => {
    const first = await loadProjectPreview(PROJECT);
    expect(first.status === "ready" && first.model.atomCount).toBe(3);
    committed = [newer];
    resetProjectPreviews(); // a new visit to the dashboard
    const second = await loadProjectPreview(PROJECT);
    expect(second.status === "ready" && second.model.atomCount).toBe(2);
    expect(second.status === "ready" && second.model.revision).toBe(2);
    expect(second.status === "ready" && second.model.formula).toBe("H2");
  });
  it("re-reads which version is latest on every visit even though old versions are cached", async () => {
    await loadProjectPreview(PROJECT);
    const before = calls.filter((url) => url.endsWith("/structures")).length;
    resetProjectPreviews();
    await loadProjectPreview(PROJECT);
    expect(calls.filter((url) => url.endsWith("/structures")).length).toBe(before + 1);
  });
  it("forgets all geometry when the dashboard closes", async () => {
    await loadProjectPreview(PROJECT);
    const fetched = calls.length;
    clearProjectPreviewCaches();
    await loadProjectPreview(PROJECT);
    expect(calls.length).toBeGreaterThan(fetched);
  });
  it("never draws structures that belong to another project, even if the server answers with them", async () => {
    const foreign = detail({ project: OTHER, structure: "aaaaaaaa-0000-4000-8000-0000000000e1", version: "bbbbbbbb-0000-4000-8000-0000000000e1", created: "2030-01-01T00:00:00", name: "Someone else's molecule" });
    hostile = (url) => {
      if (url.endsWith(`/projects/${PROJECT}/structures`)) return new Response(JSON.stringify([{ ...summaryOf(foreign), project_id: OTHER }, { ...summaryOf(foreign), project_id: PROJECT }]), { status: 200 });
      if (url.includes("/versions/")) return new Response(JSON.stringify(foreign), { status: 200 });
      return null;
    };
    const result = await loadProjectPreview(PROJECT);
    expect(result.status).toBe("none");
    expect(JSON.stringify(result)).not.toContain("Someone else");
  });
  it("shows nothing for unauthenticated or forbidden responses and only ever asks for its own project", async () => {
    hostile = () => new Response(JSON.stringify({ detail: "Not authenticated" }), { status: 401 });
    expect((await loadProjectPreview(PROJECT)).status).toBe("unavailable");
    expect(calls.every((url) => url.includes(`/v1/projects/${PROJECT}/`))).toBe(true);
  });
  it("falls back to an unavailable placeholder instead of loading forever", async () => {
    vi.useFakeTimers();
    hostile = () => new Promise<Response>(() => {}) as unknown as Response;
    const pending = loadProjectPreview(PROJECT);
    await vi.advanceTimersByTimeAsync(21_000);
    expect((await pending).status).toBe("unavailable");
  });
});

describe("identity banners stay in development", () => {
  const page = read("../src/app/[locale]/projects/page.tsx");
  const client = read("../src/app/[locale]/projects/projects-client.tsx");
  it("shows the development identity chip only when the dev identity is actually enabled", () => {
    const header = read("../src/app/_components/product-header.tsx");
    const gate = read("../src/lib/local-development.ts");
    expect(page).toContain("<ProductHeader");
    expect(header).toContain("isLocalDevelopment() ?");
    expect(gate).toContain('env.NODE_ENV !== "production"');
    expect(gate).toContain('authModeFromEnv(env) === "dev"');
  });
  it("reports a signed-in session in jwt mode and keeps development wording out of it", () => {
    expect(client).toContain('if (authMode === "jwt") return "Signed in";');
    expect(client).toContain('authMode === "jwt" ? "Authenticated project access."');
  });
});
