// PRESENTATION FIXTURES ONLY. Not scientific results; nothing here is real or persisted.
// The numbers are digit-preservation probes. Every request is logged at GET /__requests so specs can prove the page is read only.
import http from "node:http";
const PORT = Number(process.env.PORT ?? 8293);
export const RICH = "00000000-0000-4000-8000-0000000000d1";
export const BIG = "00000000-0000-4000-8000-0000000000e2";
export const EMPTY = "00000000-0000-4000-8000-0000000000f3";
const DOC = "77777777-7777-4777-8777-777777777777";
const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const iso = (m) => new Date(Date.now() - m * 60000).toISOString().replace("Z", "");

const claim = (pid, n, o) => ({
  id: id(n), project_id: pid, claim_type: "NUMERIC_VALUE", subject: "Fixture sample", predicate: "reported value", quantity_key: null, value: 1, unit: null,
  qualifier: null, uncertainty: null, source_authority: "EXTRACTED", source_record_type: "evidence_candidate", source_record_id: id(5000 + n),
  source_document_id: DOC, page: 1, figure: null, table: null, evidence_id: id(8000 + n), provenance_hash: "a".repeat(64), review_state: "DETECTED",
  semantic_status: "EXPLICIT", source_label: "Paper text · extracted",
  source_href: `/en/projects/${pid}/workspace?selection=documentEvidence:${id(8000 + n)}&source=${DOC}&page=1`, created_at: iso(500 - n), effective_result_state: null, ...o,
});
const dataset = (pid, n, o) => claim(pid, n, {
  source_authority: "DIGITIZED", source_record_type: "experimental_dataset", review_state: "COMMITTED", source_label: "Digitized dataset",
  source_href: `/en/projects/${pid}/workspace?selection=experimentalDataset:${id(9000 + n)}`, ...o,
});
const row = (n, section, topic, relation, source, project, o = {}) => ({
  id: `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`, section, topic, quantity_key: "fixture.quantity", source_document_id: DOC,
  source_claims: source, project_claims: project, relation, delta: null, delta_unit: null, comparison_rule: null,
  authority_summary: [...new Set([...source, ...project].map((c) => c.source_authority))].sort(),
  review_summary: [...new Set([...source, ...project].map((c) => c.review_state))].sort(), unresolved_reason: null, ...o,
});
const XRD = "xrd.two_theta.peak_position";
const SUMMARY = (rows) => ({
  source_claims: 9, project_claims: 6, directly_comparable_pairs: rows.filter((r) => r.relation === "SAME_QUANTITY").length,
  not_directly_comparable: rows.filter((r) => r.relation === "NOT_DIRECTLY_COMPARABLE").length, source_only_claims: rows.filter((r) => r.relation === "SOURCE_ONLY").length,
  project_only_claims: rows.filter((r) => r.relation === "PROJECT_ONLY").length, reconstructed_structures: 1, digitized_datasets: 4, calculated_results: 1,
});

function rich(pid) {
  const rows = [
    row(1, "Synthesis", "Feed gas ratio", "SOURCE_ONLY", [claim(pid, 1, { claim_type: "COMPOSITION", subject: "CVD feed gas", predicate: "argon to hydrogen feed ratio", value: "Ar:H2 2:1", quantity_key: "cvd.feed_gas.ratio", qualifier: "reported" })], [], { quantity_key: "cvd.feed_gas.ratio" }),
    row(2, "Crystallography", "Cell parameter a", "SOURCE_ONLY", [claim(pid, 2, { claim_type: "STRUCTURAL_PARAMETER", subject: "Reported crystal cell", predicate: "a", quantity_key: "crystal.cell.a", value: 4.958, unit: "Å", uncertainty: 0.002 })], [], { quantity_key: "crystal.cell.a" }),
    row(3, "Structure", "Structure depicted", "DERIVED_FROM",
      [claim(pid, 3, { claim_type: "STRUCTURE_ASSERTION", subject: "Paper structure figure", predicate: "structure depicted", value: "Figure 2 hypothetical structure", figure: "2" })],
      [claim(pid, 4, { claim_type: "STRUCTURE_ASSERTION", subject: "Chromium V1", predicate: "structure representation", quantity_key: "structure.representation", value: "Chromium V1 · V1 (RECONSTRUCTED)", source_authority: "RECONSTRUCTED", source_record_type: "structure_version", review_state: "USER REVIEWED", source_label: "Reconstructed structure", source_href: `/en/projects/${pid}/workspace?selection=structureVersion:${id(7000)}` })],
      { quantity_key: null, comparison_rule: "Structure version records the source evidence used for reconstruction." }),
    row(4, "XRD", "2θ peak 1", "SAME_QUANTITY",
      [claim(pid, 5, { claim_type: "PEAK_POSITION", subject: "XRD", predicate: "2θ peak 1", quantity_key: XRD, value: 24.482, unit: "degree", qualifier: "approximate, read from the printed table", page: 4, original_value_text: "24.4820" })],
      [dataset(pid, 6, { claim_type: "PEAK_POSITION", subject: "XRD pattern", predicate: "2θ digitized peak 1", quantity_key: XRD, value: 24.4565, unit: "degree" })],
      { quantity_key: XRD, delta: 0.0255, delta_unit: "degree", comparison_rule: "Ordered reported and digitized XRD peak positions from the same source document share 2θ and degree units. Delta convention: source minus ChemDFT." }),
    row(5, "XRD", "2θ peak 2", "SAME_QUANTITY",
      [claim(pid, 7, { claim_type: "PEAK_POSITION", subject: "XRD", predicate: "2θ peak 2", quantity_key: XRD, value: 33.2, unit: "degree", page: 4 })],
      [dataset(pid, 8, { claim_type: "PEAK_POSITION", subject: "XRD pattern", predicate: "2θ digitized peak 2", quantity_key: XRD, value: 33.123456789, unit: "degree" })],
      { quantity_key: XRD, delta: 0.07654321100000001, delta_unit: "degree", comparison_rule: "Ordered reported and digitized XRD peak positions from the same source document share 2θ and degree units. Delta convention: source minus ChemDFT." }),
    row(6, "Particle characterization", "Hydrodynamic radius", "NOT_DIRECTLY_COMPARABLE",
      [claim(pid, 9, { claim_type: "PARTICLE_SIZE", subject: "DLS particles", predicate: "hydrodynamic radius", quantity_key: "dls.hydrodynamic_radius", value: 1482.3, unit: "nm" })],
      [dataset(pid, 10, { claim_type: "DISTRIBUTION_SUMMARY", subject: "Digitized DLS distribution", predicate: "distribution peak", quantity_key: "dls.hydrodynamic_diameter.distribution_peak", value: 1524.4, unit: "nm" })],
      { quantity_key: "dls.hydrodynamic_radius", comparison_rule: "DLS quantities have different semantics; no conversion is inferred." }),
    row(7, "Thermal analysis", "Decomposition temperature", "SEMANTICS_DIFFER",
      [claim(pid, 11, { subject: "Thermal analysis", predicate: "decomposition temperature", quantity_key: "thermal.event.temperature", value: 189.3, unit: "°C" })],
      [dataset(pid, 12, { subject: "Digitized TGA", predicate: "decomposition temperature", quantity_key: "thermal.event.temperature", value: 462.45, unit: "K" })],
      { quantity_key: "thermal.event.temperature", comparison_rule: "The semantic quantity matches, but declared units differ and no deterministic conversion is defined." }),
    row(8, "Particle characterization", "Particle-size range", "UNRESOLVED",
      [claim(pid, 13, { claim_type: "RANGE", subject: "DLS particles", predicate: "reported particle-size range", quantity_key: "dls.size_range", value: [100, 1500.125], unit: "nm", semantic_status: "SOURCE_UNAVAILABLE", source_href: null })], [],
      { quantity_key: "dls.size_range", unresolved_reason: "The source claim has no valid linked passage." }),
    row(9, "Calculated results", "Total energy", "PROJECT_ONLY", [],
      [claim(pid, 14, { claim_type: "CALCULATION_RESULT", subject: "chemdft.energy", predicate: "total_energy", value: -1.1167593073964255, unit: "Eh", uncertainty: 1e-10, source_authority: "CALCULATED", source_record_type: "calculation_result", review_state: "UNVERIFIED", source_label: "Calculation result · fixture", source_document_id: null, page: null, qualifier: "HF/STO-3G, fixture value" })],
      { quantity_key: "chemdft.energy.total", source_document_id: null }),
    row(10, "Particle characterization", "Mean hydrodynamic diameter", "SAME_QUANTITY",
      [claim(pid, 15, { claim_type: "DISTRIBUTION_SUMMARY", subject: "DLS", predicate: "mean hydrodynamic diameter", quantity_key: "dls.hydrodynamic_diameter.mean", value: 1524.4, unit: "nm" })],
      [dataset(pid, 16, { claim_type: "DISTRIBUTION_SUMMARY", subject: "Digitized DLS", predicate: "mean hydrodynamic diameter", quantity_key: "dls.hydrodynamic_diameter.mean", value: 1482.3, unit: "nm" })],
      { quantity_key: "dls.hydrodynamic_diameter.mean", delta: 42.1, delta_unit: "nm", comparison_rule: "Semantic quantity and declared unit match. Delta convention: source minus ChemDFT." }),
  ];
  return { project_id: pid, rows, summary: SUMMARY(rows) };
}
function big(pid) {
  const rows = Array.from({ length: 300 }, (_, i) => row(100 + i, ["XRD", "Thermal analysis", "Particle characterization"][i % 3], `Bulk quantity ${i}`, i % 5 === 0 ? "SAME_QUANTITY" : "SOURCE_ONLY",
    [claim(pid, 1000 + i, { claim_type: "PEAK_POSITION", subject: "Bulk", predicate: `bulk quantity ${i}`, quantity_key: `bulk.q${i}`, value: 10 + i / 7, unit: "degree" })],
    i % 5 === 0 ? [dataset(pid, 2000 + i, { subject: "Bulk", predicate: `bulk digitized ${i}`, quantity_key: `bulk.q${i}`, value: 10 + i / 7 + 0.01, unit: "degree" })] : [],
    i % 5 === 0 ? { delta: -0.01, delta_unit: "degree" } : {}));
  return { project_id: pid, rows, summary: SUMMARY(rows) };
}
const STORE = { [RICH]: rich, [BIG]: big, [EMPTY]: (pid) => ({ project_id: pid, rows: [], summary: SUMMARY([]) }) };

const log = [];
const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/__requests") { if (req.method === "DELETE") log.length = 0; return send(res, 200, log); }
  log.push({ method: req.method, path: url.pathname });
  if (["/healthz", "/health", "/v1/health"].includes(url.pathname)) return send(res, 200, { ok: true });
  if (url.pathname === "/v1/projects" && req.method === "POST") return send(res, 201, { id: RICH, organization_id: id(1), name: "Fixture: comparison", slug: "fixture", role: "owner", created_at: iso(900), updated_at: iso(900) });
  const m = url.pathname.match(/^\/v1\/projects\/([^/]+)(\/.*)?$/);
  if (!m) return send(res, 404, { detail: "mock: not found" });
  const [, pid, rest = ""] = m;
  if (rest === "") return send(res, 200, { id: pid, organization_id: id(1), name: pid === BIG ? "Fixture: 300 rows" : pid === EMPTY ? "Fixture: no rows" : "Fixture: comparison", slug: "fixture", role: "owner", created_at: iso(900), updated_at: iso(900) });
  if (rest === "/scientific-comparison") return send(res, 200, (STORE[pid] ?? STORE[EMPTY])(pid));
  console.log("mock miss", req.method, url.pathname);
  return send(res, 404, { detail: "mock: not found" });
});
server.listen(PORT, "127.0.0.1", () => console.log("comparison mock on", PORT));
