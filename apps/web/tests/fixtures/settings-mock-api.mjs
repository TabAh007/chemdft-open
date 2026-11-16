// PRESENTATION FIXTURES ONLY. Realistic server responses for the Settings pages; nothing here is real, persisted or a provider call.
// No key is ever stored: the credential routes keep only a fixed masked fingerprint. Every request is logged (method and path, never a body)
// so a test can assert what a page did or did not send.
import http from "node:http";
const PORT = Number(process.env.PORT ?? 8292);
const WITH_FAKE = process.env.MOCK_INCLUDE_FAKE === "1";
const PROJECT = "00000000-0000-4000-8000-0000000000e1";
const LIGHTNING = "nvidia/nemotron-3.5-lightning-30b-a3b";
const SUPER = "nvidia/nemotron-3-super-120b-a12b";
const KIMI = "kimi-k2.6";
const iso = (m) => new Date(Date.now() - m * 60000).toISOString().replace("Z", "");
const row = (provider, model, name, extra = {}) => ({
  provider, model_identifier: model, display_name: name, status: "LIVE-VERIFIED", endpoint: "https://example.invalid/v1/chat/completions", endpoint_availability: "AVAILABLE",
  documented_capabilities: ["Tool calling"], published_context: "256K (published)", configuration_requirements: [], configured: true, selectable: true, eligibility: "STANDARD",
  tool_compatibility_verified: true, proposal_workflow_verified: true, verification_scope: "H2 and water single-point proposals (fixture text)", limitations: [], source_urls: [], reviewed_on: "2026-10-18", planning_profiles: ["GENERAL"], unselectable_reason: null, ...extra,
});
const state = {
  preferences: { mode: "MANAGED", provider: "nvidia", model: LIGHTNING },
  credentials: [],
  secretStorage: process.env.MOCK_SECRET_STORAGE !== "0",
  log: [],
};
const providers = () => [
  ...(WITH_FAKE ? [{ provider: "fake", models: ["fake-standard", "fake-alternate"], local_test_only: true }] : []),
  { provider: "nvidia", models: [LIGHTNING, SUPER] },
  { provider: "moonshot", models: [KIMI] },
];
const settingsView = () => {
  const p = state.preferences;
  return {
    preferences: p,
    availability: { mode: p.mode, provider: p.provider, model: p.model, available: p.provider !== "fake" || WITH_FAKE, error_code: p.mode === "BYOK" && !state.credentials.some((c) => c.provider === p.provider && c.status === "CONFIGURED") ? "BYOK_KEY_MISSING" : null, managed_enabled: true, byok_enabled: true, secret_storage_available: state.secretStorage, local_test_only: p.provider === "fake", allowance_status: "AVAILABLE" },
    providers: providers(),
    credentials: state.credentials,
    model_capabilities: [
      row("nvidia", LIGHTNING, "Nemotron 3.5 Lightning (NVIDIA)"),
      row("nvidia", SUPER, "Nemotron 3 Super (NVIDIA)", { eligibility: "DEVELOPMENT", development_evidence: ["Fixture: one successful H2 proposal, n=1."], limitations: ["Development use only."] }),
      row("moonshot", KIMI, "Kimi K2.6 (Moonshot)", { eligibility: "DEVELOPMENT", development_evidence: ["Fixture: single sample."] }),
      row("nvidia", "fixture/unconfigured-model", "Unconfigured Fixture Model (NVIDIA)", { configured: false, selectable: false, unselectable_reason: "Not configured on this server." }),
    ],
  };
};
const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(body === undefined ? undefined : JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve) => { let data = ""; req.on("data", (c) => { data += c; }); req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } }); });
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/__requests") return send(res, 200, state.log);
  if (url.pathname === "/__reset") { state.log.length = 0; state.credentials = []; state.preferences = { mode: "MANAGED", provider: "nvidia", model: LIGHTNING }; return send(res, 200, {}); }
  if (url.pathname === "/healthz" || url.pathname === "/health" || url.pathname === "/v1/health") return send(res, 200, { ok: true });
  state.log.push({ method: req.method, path: url.pathname });
  if (url.pathname === "/v1/me") return send(res, 200, { id: "00000000-0000-4000-8000-0000000000a1", display_name: "Priya Raman", email: "priya.raman@example.org", kind: "HUMAN", auth_mode: "dev", organization: { id: "00000000-0000-4000-8000-0000000000b1", name: "Raman Lab", kind: "PERSONAL", role: "owner" }, setup: { has_personal_organization: true, project_count: 3 } });
  if (url.pathname === `/v1/projects/${PROJECT}` && req.method === "PATCH") {
    const body = await readBody(req);
    if (typeof body.name !== "string" || !body.name.trim() || Object.keys(body).some((key) => key !== "name")) return send(res, 422, { detail: "mock: invalid name" });
    state.projectName = body.name.trim().replace(/\s+/g, " ");
  }
  if (url.pathname === `/v1/projects/${PROJECT}`) return send(res, 200, { id: PROJECT, organization_id: "00000000-0000-4000-8000-0000000000b1", name: state.projectName ?? "Water B3LYP benchmark", slug: "water-b3lyp-benchmark", role: "owner", created_at: iso(60 * 24 * 12), updated_at: iso(95) });
  if (url.pathname === "/v1/ai/settings" && req.method === "GET") return send(res, 200, settingsView());
  if (url.pathname === "/v1/ai/settings" && req.method === "PUT") {
    const body = await readBody(req);
    const ok = providers().some((o) => o.provider === body.provider && o.models.includes(body.model));
    if (!ok) return send(res, 422, { detail: "That provider and model are not offered by this server." });
    state.preferences = { mode: body.mode, provider: body.provider, model: body.model };
    return send(res, 200, settingsView());
  }
  if (url.pathname === "/v1/billing/byok" && req.method === "POST") {
    const body = await readBody(req);
    const view = { provider: body.provider, status: "CONFIGURED", fingerprint: "sha256:4f2a…9c1d", created_at: iso(0), updated_at: iso(0), validated: false };
    state.credentials = [...state.credentials.filter((c) => c.provider !== body.provider), view];
    return send(res, 200, view);
  }
  if (url.pathname === "/v1/billing/byok/revoke" && req.method === "POST") {
    const body = await readBody(req);
    state.credentials = state.credentials.map((c) => (c.provider === body.provider ? { ...c, status: "REVOKED" } : c));
    return send(res, 204);
  }
  console.log("mock miss", req.method, url.pathname);
  return send(res, 404, { detail: "mock: not found" });
});
server.listen(PORT, "127.0.0.1", () => console.log(`settings mock API on ${PORT} (fake provider ${WITH_FAKE ? "OFFERED" : "not offered"})`));
