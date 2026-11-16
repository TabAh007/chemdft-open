import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalculationExportCatalog, JobDiagnostics } from "@chemdft/schemas";

import { compareCalculations, downloadCalculationExport, downloadComparison, getJobLog } from "../src/lib/analysis-api";
import {
  canCompare, comparabilityLabel, describeSummary, formatNumber, MAX_SELECTION, selectionFromSearch, selectionToSearch,
  summarizeOverall, toggleSelection,
} from "../src/lib/comparison-view";
import { filenameFromDisposition, readAttachment } from "../src/lib/download";
import { exportMenuModel } from "../src/lib/export-view";
import {
  artifactAvailability, describeSpecification, diagnosticsPollInterval, formatAge, heartbeatBadge, jobTimes, parseUtc,
} from "../src/lib/job-view";

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

afterEach(() => vi.unstubAllGlobals());

describe("download primitive", () => {
  it("reads quoted, extended and hostile Content-Disposition values", () => {
    expect(filenameFromDisposition('attachment; filename="result-ab12.json"', "x")).toBe("result-ab12.json");
    expect(filenameFromDisposition("attachment; filename*=UTF-8''B%C4%B1%C4%B1.mol", "x")).toBe("Bıı.mol");
    expect(filenameFromDisposition('attachment; filename="../../etc/passwd"', "x")).toBe("passwd");
    expect(filenameFromDisposition('attachment; filename="..\\evil.sh"', "x")).toBe("evil.sh");
    expect(filenameFromDisposition("attachment; filename*=UTF-8''%E0%A4%A", "fallback.txt")).toBe("fallback.txt");
    expect(filenameFromDisposition(null, "fallback.txt")).toBe("fallback.txt");
    expect(filenameFromDisposition('attachment; filename=".."', "fallback.txt")).toBe("fallback.txt");
  });

  it("turns failed responses into the caller's error and successful ones into a named blob", async () => {
    const ok = new Response("a,b\n", { headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="s.csv"' } });
    const file = await readAttachment(ok, "fallback", async () => new Error("no"));
    expect(file.filename).toBe("s.csv");
    expect(file.mediaType).toBe("text/csv");
    expect(await file.blob.text()).toBe("a,b\n");
    await expect(readAttachment(new Response("{}", { status: 422 }), "x", async (r) => new Error(`failed ${r.status}`))).rejects.toThrow("failed 422");
  });
});

describe("analysis API client", () => {
  function stub(body: BodyInit = "{}", headers: Record<string, string> = { "content-type": "application/json" }) {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(body, { headers }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("addresses exports with encoded query parameters and never a path built from user text", async () => {
    const fetchMock = stub("x", { "content-type": "text/csv", "content-disposition": 'attachment; filename="s.csv"' });
    await downloadCalculationExport({ projectId: "p1", calculationId: "c1", format: "spectrum-csv", variant: "raman" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/chemdft/v1/projects/p1/calculations/c1/export?format=spectrum-csv&variant=raman");
  });

  it("repeats result_id for comparisons, in selection order", async () => {
    const fetchMock = stub();
    await compareCalculations("p1", [UUID(2), UUID(1)]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`/api/chemdft/v1/projects/p1/calculation-comparison?result_id=${UUID(2)}&result_id=${UUID(1)}`);
    stub("x", { "content-type": "text/csv" });
    const csv = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response("x", { headers: { "content-type": "text/csv" } }));
    vi.stubGlobal("fetch", csv);
    await downloadComparison({ projectId: "p1", resultIds: [UUID(1), UUID(2)], format: "csv" });
    expect(String(csv.mock.calls[0]?.[0])).toContain("/calculation-comparison/export?result_id=");
    expect(String(csv.mock.calls[0]?.[0])).toContain("format=csv");
  });

  it("surfaces API errors with their message instead of a generic failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Select between 2 and 8 results to compare." }), { status: 422, headers: { "content-type": "application/json" } })));
    await expect(compareCalculations("p1", [UUID(1)])).rejects.toThrow("Select between 2 and 8 results to compare.");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Log artifact does not exist for this job." }), { status: 404 })));
    await expect(getJobLog("p", "j", "a")).rejects.toThrow("Log artifact does not exist");
  });
});

describe("comparison view model", () => {
  it("keeps selection ordered, bounded and de-duplicated", () => {
    let selection: string[] = [];
    for (let n = 1; n <= MAX_SELECTION + 2; n += 1) selection = toggleSelection(selection, UUID(n));
    expect(selection).toHaveLength(MAX_SELECTION);
    expect(selection[0]).toBe(UUID(1));
    expect(toggleSelection(selection, UUID(1))[0]).toBe(UUID(2)); // removing the reference promotes the next one
    expect(canCompare([UUID(1)])).toBe(false);
    expect(canCompare([UUID(1), UUID(2)])).toBe(true);
  });

  it("round-trips a shared link and drops anything that is not a result id", () => {
    const search = new URLSearchParams(`result=${UUID(1)}&result=nope&result=${UUID(1)}&result=${UUID(2)}&x=1`);
    expect(selectionFromSearch(search)).toEqual([UUID(1), UUID(2)]);
    expect(selectionFromSearch(new URLSearchParams(selectionToSearch([UUID(3), UUID(4)])))).toEqual([UUID(3), UUID(4)]);
  });

  it("labels carry intent and the three comparability classes stay distinct", () => {
    const labels = (["DIRECTLY_COMPARABLE", "COMPARABLE_WITH_LIMITATIONS", "NOT_SCIENTIFICALLY_COMPARABLE"] as const).map((l) => comparabilityLabel(l));
    expect(new Set(labels.map((l) => l.text)).size).toBe(3);
    expect(labels.map((l) => l.intent)).toEqual(["success", "warning", "danger"]);
    expect(summarizeOverall({
      overall: "NOT_SCIENTIFICALLY_COMPARABLE",
      pairs: [{ label: "DIRECTLY_COMPARABLE" }, { label: "NOT_SCIENTIFICALLY_COMPARABLE" }, { label: "NOT_SCIENTIFICALLY_COMPARABLE" }] as never,
    })).toBe("1 directly comparable · 2 not scientifically comparable");
  });

  it("formats numbers without silently losing sign or scale and describes levels of theory", () => {
    expect(formatNumber(-76.35812051264632)).toBe("-76.358121");
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(-0.0123456789)).toBe("-0.012345679");
    expect(formatNumber(1.2e-7)).toBe("1.2000000e-7");
    expect(formatNumber(Number.NaN)).toBe("—");
    const summary = { task: "ENERGY", method: "b3lyp", basis: "def2-svp", dispersion: "D4", engine: "psi4", engine_version: "1.11" } as never;
    expect(describeSummary(summary)).toEqual({ title: "Single-point energy", level: "b3lyp / def2-svp + D4", engine: "psi4 1.11" });
  });
});

describe("export menu model", () => {
  const catalog = (evidence_use: CalculationExportCatalog["evidence_use"]): CalculationExportCatalog => ({
    project_id: UUID(1), calculation_id: UUID(2), result_id: UUID(3), evidence_use, schema_id: "chemdft.export-catalog.v1",
    formats: [
      { format: "result-json", label: "Result (JSON)", available: true, media_type: "application/json", file_extension: "json", variants: [] },
      { format: "cube", label: "Field grid", available: false, media_type: "chemical/x-cube", file_extension: "cube", unsupported_reason: "No grid has been generated.", variants: [] },
    ],
  });

  it("keeps unavailable formats visible with the server's reason and flags historical evidence", () => {
    const model = exportMenuModel(catalog("HISTORICAL_ONLY"));
    expect(model.anyAvailable).toBe(true);
    expect(model.entries.map((e) => e.option.available)).toEqual([true, false]);
    expect(model.historicalNotice).toMatch(/historical evidence/i);
    expect(exportMenuModel(catalog("CURRENT")).historicalNotice).toBeNull();
    expect(exportMenuModel(catalog("UNKNOWN")).historicalNotice).toMatch(/could not be established/);
  });
});

describe("job diagnostics presentation", () => {
  const base = { heartbeat_stale_after_seconds: 60 } as const;

  it("parses naive database timestamps as UTC and never fabricates a time", () => {
    expect(parseUtc("2026-10-12T00:00:00")).toBe(Date.parse("2026-10-12T00:00:00Z"));
    expect(parseUtc("2026-10-12T00:00:00+00:00")).toBe(Date.parse("2026-10-12T00:00:00Z"));
    expect(parseUtc(null)).toBeNull();
    expect(parseUtc("garbage")).toBeNull();
  });

  it("describes heartbeat freshness from server-judged status only", () => {
    expect(heartbeatBadge({ ...base, heartbeat_status: "FRESH", heartbeat_age_seconds: 12 })).toEqual({ label: "Worker heartbeat 12 s ago", intent: "success" });
    const stale = heartbeatBadge({ ...base, heartbeat_status: "STALE", heartbeat_age_seconds: 130 });
    expect(stale?.intent).toBe("warning");
    expect(stale?.label).toMatch(/overdue/);
    expect(heartbeatBadge({ ...base, heartbeat_status: "NOT_REPORTED" })?.label).toMatch(/No worker heartbeat/);
    expect(heartbeatBadge({ ...base, heartbeat_status: "NOT_APPLICABLE" })).toBeNull();
    expect(formatAge(null)).toBe("—");
    expect(formatAge(200)).toBe("3 min ago");
  });

  it("shows completion only for terminal jobs and says when a time is unknown", () => {
    const running = { state: "RUNNING", created_at: "2026-10-12T00:00:00", updated_at: "2026-10-12T00:01:00", latest_execution: { state: "RUNNING", started_at: "2026-10-12T00:00:05" } } as never;
    const done = { state: "SUCCEEDED", created_at: "2026-10-12T00:00:00", updated_at: "2026-10-12T00:01:00", latest_execution: { state: "FINISHED", started_at: "2026-10-12T00:00:05", finished_at: "2026-10-12T00:00:40" } } as never;
    expect(jobTimes(running).completed).toBe("—");
    expect(jobTimes(done).completed).not.toBe("—");
    const queued = { state: "READY", created_at: "2026-10-12T00:00:00", updated_at: "2026-10-12T00:00:00", latest_execution: null } as never;
    expect(jobTimes(queued).started).toBe("—");
  });

  it("describes specification, artifacts and polling without inventing progress", () => {
    expect(describeSpecification({ task_type: "ENERGY", method: "hf", basis: "sto-3g", charge: 0, multiplicity: 1 })).toBe("hf / sto-3g · charge +0, multiplicity 1");
    expect(describeSpecification(null)).toBe("Specification unavailable");
    const attempts = [{ artifacts: [{ log_readable: true }, { log_readable: false }] }, { artifacts: [] }] as unknown as JobDiagnostics["attempts"];
    expect(artifactAvailability({ attempts })).toEqual({ total: 2, logs: 1, text: "2 native artifacts stored (1 readable as text)." });
    expect(artifactAvailability({ attempts: [] }).text).toMatch(/No native artifacts/);
    expect(diagnosticsPollInterval("RUNNING", true)).toBe(3000);
    expect(diagnosticsPollInterval("RUNNING", false)).toBeNull();
    expect(diagnosticsPollInterval("SUCCEEDED", true)).toBeNull();
  });
});
