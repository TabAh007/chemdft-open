// Pure logic for scripts/live-smoke.mjs: argument parsing, credential checks and result comparison.
// No network, no browser, no file access: this module is covered by offline tests (apps/web/tests/live-smoke-lib.test.ts).

export const H2_HF_STO3G_ENERGY_HARTREE = -1.1167593073964255;
/** Same value the 0.0.53 live run reproduced to the last printed digit; tolerance only absorbs float formatting. */
export const ENERGY_TOLERANCE_HARTREE = 1e-9;

export function parseArgs(argv) {
  const options = { job: false, help: false, unknown: [] };
  for (const arg of argv) {
    if (arg === "--job") options.job = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else options.unknown.push(arg);
  }
  return options;
}

/** Credentials come from the environment only. The returned message never contains a credential value. */
export function readCredentials(env) {
  const email = (env.CHEMDFT_SMOKE_EMAIL ?? "").trim();
  const password = env.CHEMDFT_SMOKE_PASSWORD ?? "";
  const missing = [];
  if (!email) missing.push("CHEMDFT_SMOKE_EMAIL");
  if (!password) missing.push("CHEMDFT_SMOKE_PASSWORD");
  if (missing.length) {
    return { ok: false, message: `Missing environment variable(s): ${missing.join(", ")}. Set them from your password manager (see docs/implementation/LIVE_SMOKE.md).` };
  }
  return { ok: true, email, password };
}

export function readBaseUrl(env) {
  return (env.CHEMDFT_SMOKE_BASE_URL ?? "https://chemdft.com").replace(/\/+$/, "");
}

/** Expected live flags. Hosted geomeTRIC optimisation is deliberately ON live since 2026-11-14 (DECISIONS.md). */
export function readExpectations(env) {
  const flag = (name, fallback) => {
    const value = env[name];
    if (value === undefined || value === "") return fallback;
    return value === "1" || value.toLowerCase() === "true";
  };
  return {
    pyscfAvailable: flag("CHEMDFT_SMOKE_EXPECT_PYSCF", true),
    geometricOptimisation: flag("CHEMDFT_SMOKE_EXPECT_GEOMETRIC", true),
  };
}

export function checkHealth(body) {
  if (!body || typeof body !== "object") return { ok: false, detail: "health response is not a JSON object" };
  if (body.status !== "ok") return { ok: false, detail: `status is ${JSON.stringify(body.status)}, expected "ok"` };
  if (body.service !== "chemdft-api") return { ok: false, detail: `service is ${JSON.stringify(body.service)}, expected "chemdft-api"` };
  return { ok: true, detail: "status ok" };
}

/** Compares the capability list (EngineCapabilityView[]) against the expected flags. Returns one result per flag. */
export function checkCapabilities(capabilities, expectations) {
  if (!Array.isArray(capabilities)) return [{ name: "capabilities shape", ok: false, detail: "response is not a list" }];
  const pyscf = capabilities.find((c) => c && c.engine === "pyscf");
  const results = [];
  const available = Boolean(pyscf) && pyscf.availability === "AVAILABLE";
  results.push({
    name: "PySCF availability",
    ok: available === expectations.pyscfAvailable,
    detail: pyscf ? `availability ${pyscf.availability}${pyscf.version ? `, version ${pyscf.version}` : ""}` : "no pyscf entry",
  });
  const optimisers = pyscf && Array.isArray(pyscf.supported_optimizers) ? pyscf.supported_optimizers : [];
  const offersGeometric = optimisers.includes("geometric");
  results.push({
    name: "PySCF geometric optimiser flag",
    ok: offersGeometric === expectations.geometricOptimisation,
    detail: `geometric ${offersGeometric ? "offered" : "not offered"}, expected ${expectations.geometricOptimisation ? "offered" : "not offered"}`,
  });
  return results;
}

/** First number stored under `key` anywhere in a nested object (the result payload layout varies by task). */
export function findNumber(value, key, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return undefined;
  if (typeof value[key] === "number") return value[key];
  for (const child of Object.values(value)) {
    const found = findNumber(child, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function compareEnergy(detail, expected = H2_HF_STO3G_ENERGY_HARTREE, tolerance = ENERGY_TOLERANCE_HARTREE) {
  const state = detail?.calculation?.state;
  if (state !== "SUCCEEDED") return { ok: false, detail: `calculation state is ${JSON.stringify(state)}, expected "SUCCEEDED"` };
  const energy = findNumber(detail?.result?.payload, "energy_hartree");
  if (energy === undefined) return { ok: false, detail: "result carries no energy_hartree" };
  const difference = Math.abs(energy - expected);
  return {
    ok: difference <= tolerance,
    detail: `energy ${energy} Eh, expected ${expected} Eh, difference ${difference.toExponential(2)} (tolerance ${tolerance})`,
  };
}

export function isTerminalState(state) {
  return state === "SUCCEEDED" || state === "FAILED" || state === "CANCELED";
}

export function firstProjectId(hrefs) {
  for (const href of hrefs) {
    const match = /\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i.exec(href);
    if (match) return match[1];
  }
  return undefined;
}

export function formatCheck(result) {
  return `${result.ok ? "PASS" : "FAIL"}  ${result.name}${result.detail ? ` — ${result.detail}` : ""}`;
}

/** Builds the H2 HF/STO-3G submission body (same shape as the web app's PySCF energy request). */
export function buildH2Submission(projectId, structureVersionId, idempotencyKey) {
  return {
    structure_version: { project_id: projectId, entity_type: "structure.version", entity_id: structureVersionId },
    specification: {
      task_type: "ENERGY",
      method: { identifier: "hf", display_name: "HF", registry: "chemdft.method" },
      basis: { identifier: "sto-3g", display_name: "STO-3G", registry: "chemdft.basis" },
      charge: 0,
      multiplicity: 1,
      engine_preference: { engine: "pyscf" },
    },
    provider_preference: "AUTO",
    idempotency_key: idempotencyKey,
  };
}
