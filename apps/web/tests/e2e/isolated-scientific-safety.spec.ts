import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("electronic authority, D4 rejection, and real queue/cancel without execution", async ({ request }) => {
  expect(process.env.CHEMDFT_E2E_WORKER_MODE).toBe("disabled");
  const root = "/api/chemdft/v1/projects";
  const created = await request.post(root, { data: { name: "Isolated scientific safety", slug: `safety-${randomUUID()}` } });
  expect(created.status()).toBe(201);
  const project = (await created.json()).id;
  const imported = await request.post(`${root}/${project}/structures/imports`, { multipart: {
    file_format: "XYZ", idempotency_key: randomUUID(),
    upload: { name: "water.xyz", mimeType: "chemical/x-xyz", buffer: Buffer.from(
      "3\nwater | chemdft:charge=0;multiplicity=1\nO 0 0 0\nH 0.758602 0 0.504284\nH -0.758602 0 0.504284\n") },
  } });
  expect(imported.status()).toBe(201);
  const structure = await imported.json();
  const version = structure.version;
  const versionUrl = `${root}/${project}/structures/${structure.structure.id}/versions/${version.id}`;
  const before = await (await request.get(versionUrl)).json();
  const command = {
    structure_version: { project_id: project, entity_type: "structure.version", entity_id: version.id },
    specification: {
      task_type: "ENERGY", method: { identifier: "hf", display_name: "HF", registry: "chemdft.method" },
      basis: { identifier: "sto-3g", display_name: "STO-3G", registry: "chemdft.basis" },
      charge: 0, multiplicity: 1, engine_preference: { engine: "pyscf" },
    }, idempotency_key: randomUUID(),
  };
  for (const [field, value, code] of [
    ["charge", 2, "CALCULATION_CHARGE_MISMATCH"],
    ["multiplicity", 3, "CALCULATION_MULTIPLICITY_MISMATCH"],
  ] as const) {
    const rejected = await request.post(`${root}/${project}/calculations`, { data: {
      ...command, specification: { ...command.specification, [field]: value }, idempotency_key: randomUUID(),
    } });
    expect(rejected.status()).toBe(422);
    expect((await rejected.json()).detail.code).toBe(code);
  }
  const d4 = await request.post(`${root}/${project}/calculations`, { data: {
    ...command, specification: { ...command.specification,
      dispersion: { identifier: "d4", display_name: "D4", registry: "chemdft.dispersion" } },
    idempotency_key: randomUUID(),
  } });
  expect(d4.status()).toBe(422);
  const listBefore = await request.get(`${root}/${project}/compute/jobs`);
  expect(listBefore.ok()).toBe(true);
  expect((await listBefore.json()).jobs).toHaveLength(0);
  const submitted = await request.post(`${root}/${project}/calculations`, { data: command });
  expect(submitted.status()).toBe(201);
  const detail = await submitted.json();
  expect(detail.calculation.state).toBe("QUEUED");
  expect(detail.result).toBeNull();
  const replay = await request.post(`${root}/${project}/calculations`, { data: command });
  expect(replay.ok()).toBe(true);
  expect((await replay.json()).calculation.id).toBe(detail.calculation.id);
  const canceled = await request.post(`${root}/${project}/calculations/${detail.calculation.id}/cancel`);
  expect(canceled.ok()).toBe(true);
  const final = await canceled.json();
  expect(final.calculation.state).toBe("CANCELED");
  expect(final.compute_job.state).toBe("CANCELED");
  expect(final.result).toBeNull();
  expect(await (await request.get(versionUrl)).json()).toEqual(before);
});
