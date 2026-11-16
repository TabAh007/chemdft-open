import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkedExample } from "../src/app/_components/home/worked-example";

describe("home page Cr2O3 worked example", () => {
  const text = renderToStaticMarkup(createElement(WorkedExample)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  it("shows exactly the numbers of stored job 5682273d", () => {
    for (const v of ["5682273d-6bcc-45c0-8dd1-ab2bf07b426a", "−475.99968609 Ha", "±2.9995 μB", "3.239 eV", "463.6 s", "0.001093 Ry/bohr", "3 ionic steps", "ecutwfc 45 Ry, ecutrho 540 Ry", "2×2×2 (8 irreducible k-points)", "U_eff(Cr) = 3.7 eV", "Quantum ESPRESSO 7.6", "10 atoms (4 Cr, 6 O)", "SSSP PBE Efficiency v2.0", "Cr.us.pbe.z_14.uspp.gbrv.v1.5.upf", "O.paw.pbe.z_6.ld1.psl.v0.1.upf", "CALCULATED"]) expect(text).toContain(v);
  });
  it("shows the second stored run and prints the caveats, with no literature comparison", () => {
    for (const v of ["58a06173-0f87-46c1-b640-daa5c0803468", "2.896 eV", "±3.0028 μB", "not an optical or experimental gap", "platform default, not fitted", "not a benchmark", "not evidence for any other platform"]) expect(text).toContain(v);
    expect(text).not.toMatch(/experiment(al)? value|literature|agrees with|matches/i);
  });
});
