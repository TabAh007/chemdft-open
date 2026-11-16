import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export function createLegacyRaw2DFixture(projectId: string, molBlock: string): {
  project_id: string; structure_id: string; version_id: string;
} {
  // The isolated runner serves a copy of the web sources, so the repository is located through its environment.
  const root = process.env.CHEMDFT_REPO_ROOT ?? resolve("../..");
  return JSON.parse(execFileSync(resolve(root, ".venv/bin/python"),
    [resolve(root, "tools/create_isolated_e2e_fixture.py")], {
      input: JSON.stringify({ fixture: "legacy-raw-2d", project_id: projectId, mol_block: molBlock }),
      encoding: "utf8",
    }));
}
