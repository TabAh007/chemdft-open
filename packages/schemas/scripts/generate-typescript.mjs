// SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
// SPDX-License-Identifier: Apache-2.0
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = resolve(packageRoot, "generated/chemdft-contracts.schema.json");
const outputPath = resolve(packageRoot, "src/generated.ts");
const checking = process.argv.includes("--check");
const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const generated = await compile(schema, "ContractBundle", {
  bannerComment: "// SPDX-FileCopyrightText: 2026 Tabriz Ahmadli\n// SPDX-License-Identifier: Apache-2.0\n/* Generated from ChemDFT Pydantic contracts. Do not edit. */",
  style: { singleQuote: false, semi: true, tabWidth: 2, trailingComma: "all" },
  unreachableDefinitions: true,
});

if (checking) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== generated) {
    throw new Error("Generated TypeScript contracts are stale; run pnpm schemas:generate");
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generated);
}
