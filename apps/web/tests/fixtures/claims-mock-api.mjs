// PRESENTATION FIXTURES ONLY. Not scientific results; nothing here is real or persisted.
// The numbers are digit-preservation probes. Every request is logged at GET /__requests so specs can prove the page is read only.
import http from "node:http";
const PORT = Number(process.env.PORT ?? 8292);
export const RICH = "00000000-0000-4000-8000-0000000000a1";
export const BIG = "00000000-0000-4000-8000-0000000000b2";
export const EMPTY = "00000000-0000-4000-8000-0000000000c3";
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const iso = (m) => new Date(Date.now() - m * 60000).toISOString().replace("Z", "");
const claim = (pid, n, o) => ({
  id: id(n), project_id: pid, claim_type: "NUMERIC_VALUE", subject: "Fixture sample", predicate: "reported value", quantity_key: null, value: 1, unit: null,
  qualifier: null, uncertainty: null, source_authority: "EXTRACTED", source_record_type: "evidence_candidate", source_record_id: id(5000 + n),
  source_document_id: id(7000), page: 1, figure: null, table: null, evidence_id: id(8000 + n), provenance_hash: "a".repeat(64), review_state: "DETECTED",
  semantic_status: "EXPLICIT", source_label: "Paper text · extracted", source_href: `/en/projects/${pid}/workspace?selection=documentEvidence:${id(8000 + n)}&source=${id(7000)}&page=1`,
  created_at: iso(500 - n), effective_result_state: null, ...o,
});
const effective = (over) => ({ stored_authority: "CALCULATED", stored_validation_state: "VALIDATED", stored_verification_state: "UNVERIFIED", authority: "CALCULATED", validation_state: "VALIDATED", verification_state: "UNVERIFIED", source_lineage_validity: "ACTIVE", eligible_for_derivation: true, inactive_result_ids: [], reason: null, ...over });
const richClaims = (pid) => [
  claim(pid, 1, { claim_type: "PEAK_POSITION", subject: "XRD", predicate: "2θ peak position", quantity_key: "xrd.two_theta.peak_position", value: 24.4565, unit: "degree", page: 6, original_value_text: "24.45650" }),
  claim(pid, 2, { claim_type: "PEAK_POSITION", subject: "XRD pattern", predicate: "2θ digitized peak 1", quantity_key: "xrd.two_theta.peak_position", value: 24.4, unit: "degree", source_authority: "DIGITIZED", source_record_type: "experimental_dataset", review_state: "COMMITTED", source_label: "Digitized dataset · Figure 3 XRD", source_href: `/en/projects/${pid}/workspace?selection=experimentalDataset:${id(6002)}` }),
  claim(pid, 3, { claim_type: "PARTICLE_SIZE", subject: "DLS particles", predicate: "hydrodynamic radius", value: 1482.3, unit: "nm" }),
  claim(pid, 4, { claim_type: "DISTRIBUTION_SUMMARY", subject: "DLS distribution", predicate: "hydrodynamic diameter mean", value: 1496.1, unit: "nm" }),
  claim(pid, 5, { claim_type: "STRUCTURE_ASSERTION", subject: "TEST USER-SUPPLIED RECONSTRUCTION — NOT FROM PAPER", predicate: "structure representation", value: "TEST USER-SUPPLIED RECONSTRUCTION — NOT FROM PAPER · V1 (RECONSTRUCTED)", source_authority: "RECONSTRUCTED", source_record_type: "structure_version", review_state: "UNVERIFIED", source_label: "Structure · V1", source_href: `/en/projects/${pid}/workspace?selection=structureVersion:${id(6005)}&source=${id(6006)}` }),
  claim(pid, 6, { claim_type: "CALCULATION_RESULT", subject: "chemdft.energy", predicate: "total_energy", value: -1.1167593073964255, unit: "Eh", uncertainty: 0.02, source_authority: "CALCULATED", source_record_type: "calculation_result", review_state: "UNVERIFIED", source_label: "Calculation result · chemdft.energy", source_href: null, page: null, effective_result_state: effective({}) }),
  claim(pid, 7, { claim_type: "CALCULATION_RESULT", subject: "chemdft.geometry", predicate: "bond_length", value: 0.123456789, unit: "Å", uncertainty: { low: 0.1234, high: 0.1236, basis: "fixture" }, source_authority: "CALCULATED", source_record_type: "calculation_result", review_state: "UNVERIFIED", source_label: "Calculation result · chemdft.geometry", source_href: null, page: null, effective_result_state: effective({}) }),
  claim(pid, 8, { claim_type: "CALCULATION_RESULT", subject: "chemdft.energy", predicate: "retracted energy", value: 1e-10, unit: "Eh", source_authority: "CALCULATED", source_record_type: "calculation_result", review_state: "UNVERIFIED", semantic_status: "INACTIVE_SOURCE", source_label: "Source result retracted (fixture reason).", source_href: null, page: null, effective_result_state: effective({ source_lineage_validity: "RETRACTED", eligible_for_derivation: false, reason: "Source result retracted (fixture reason)." }) }),
  claim(pid, 9, { claim_type: "EXPERIMENTAL_CONDITION", subject: "CVD process", predicate: "deposition temperature", value: [-700.5, -600.25], unit: "°C", qualifier: "reported range" }),
  claim(pid, 10, { claim_type: "RANGE", subject: "DLS particles", predicate: "reported particle-size range", value: [100, 1500.125], unit: "nm" }),
  claim(pid, 11, { claim_type: "COMPOSITION", subject: "CVD feed gas", predicate: "argon to hydrogen feed ratio", value: "Ar:H2 20:1", qualifier: "reported" }),
  claim(pid, 12, { claim_type: "DISTRIBUTION_SUMMARY", subject: "DLS distribution", predicate: "hydrodynamic diameter median", value: 1234, unit: "nm", qualifier: "Source table token scaled from OCR context; inspect source text.", table: "2" }),
  claim(pid, 13, { claim_type: "STRUCTURAL_PARAMETER", subject: "Unit cell", predicate: "cell parameters", value: { a: 3.14159265358979, b: 3.14159265358979, c: { value: 5.2, unit: "Å" }, angles: [90, 90, 120], setting: "hexagonal", note: "fixture object value", extra: 1, more: 2 }, unit: "Å" }),
  claim(pid, 14, { claim_type: "FUTURE_TYPE", subject: "Unknown type fixture", predicate: "future claim", value: 3, source_authority: "FUTURE_AUTHORITY", review_state: "FUTURE_STATE", source_label: "A very long source label that goes on and on to test wrapping inside the narrow source column without any horizontal page scroll at all" }),
  claim(pid, 15, { claim_type: "NUMERIC_VALUE", subject: "A very long subject name that keeps going to test that nothing overflows the row or the page at desktop widths in either dock state", predicate: "a very long predicate name used to test wrapping behaviour", value: 123456789012.12345, unit: "unit-with-a-long-name" }),
];
const relations = () => [
  { left_claim_id: id(1), right_claim_id: id(2), relation: "SAME_QUANTITY", rationale: "Same 2θ quantity and units.", numeric_delta: 0.0565, delta_unit: "degree" },
  { left_claim_id: id(3), right_claim_id: id(4), relation: "NOT_DIRECTLY_COMPARABLE", rationale: "Radius and diameter are distinct quantities.", numeric_delta: null, delta_unit: null },
];
const bigClaims = (pid) => Array.from({ length: 400 }, (_, i) => claim(pid, 100 + i, { claim_type: ["PEAK_POSITION", "PARTICLE_SIZE", "CALCULATION_RESULT"][i % 3], subject: `Bulk sample ${i}`, predicate: `bulk quantity ${i}`, value: i + 0.123456789, unit: "nm", source_authority: i % 4 === 0 ? "DIGITIZED" : "EXTRACTED" }));
const STORE = { [RICH]: [richClaims(RICH), relations()], [BIG]: [bigClaims(BIG), []], [EMPTY]: [[], []] };
const log = [];
const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/__requests") { if (req.method === "DELETE") log.length = 0; return send(res, 200, log); }
  log.push({ method: req.method, path: url.pathname });
  if (["/healthz", "/health", "/v1/health"].includes(url.pathname)) return send(res, 200, { ok: true });
  if (url.pathname === "/v1/projects" && req.method === "POST") { STORE[RICH] ??= []; return send(res, 201, { id: RICH, organization_id: id(1), name: "Fixture: claims", slug: "fixture", role: "owner", created_at: iso(900), updated_at: iso(900) }); }
  const m = url.pathname.match(/^\/v1\/projects\/([^/]+)(\/.*)?$/);
  if (!m) return send(res, 404, { detail: "mock: not found" });
  const [, pid, rest = ""] = m;
  if (!STORE[pid]) return send(res, 404, { detail: "Project not found." });
  if (rest === "") return send(res, 200, { id: pid, organization_id: id(1), name: pid === BIG ? "Fixture: 400 claims" : pid === EMPTY ? "Fixture: no claims" : "Fixture: claims", slug: "fixture", role: "owner", created_at: iso(900), updated_at: iso(900) });
  if (rest === "/scientific-claims") return send(res, 200, { project_id: pid, claims: STORE[pid][0], relations: STORE[pid][1] });
  console.log("mock miss", req.method, url.pathname);
  return send(res, 404, { detail: "mock: not found" });
});
server.listen(PORT, "127.0.0.1", () => console.log("claims mock on", PORT));
