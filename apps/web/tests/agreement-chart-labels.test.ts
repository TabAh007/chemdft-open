import { describe, expect, it } from "vitest";

import { rowCount } from "../src/app/_components/comparison/agreement-chart";
import { axisTickText } from "../src/lib/chart-tick-label";

/** F12b: axis labels are scale labels, not data, and counts agree in number. */
describe("agreement chart labels", () => {
  it.each([
    [33.899480000000004, "33.8995"],
    [32, "32"],
    [-1.1167593073964255, "-1.11676"],
    [1527.768, "1527.77"],
    [0, "0"],
    [1e-10, "1e-10"],
  ])("axisTickText(%s) = %s", (value, text) => { expect(axisTickText(value)).toBe(text); });

  it("never renders a float artifact", () => {
    for (const value of [33.899480000000004, 0.1 + 0.2, 1234.5600000000002]) expect(axisTickText(value)).not.toMatch(/\d{9,}/);
  });

  it.each([[0, "0 rows"], [1, "1 row"], [2, "2 rows"], [10, "10 rows"]])("rowCount(%s)", (count, text) => { expect(rowCount(count)).toBe(text); });
});
