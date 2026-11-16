import { describe, expect, it } from "vitest";

import { formatMoney } from "../src/lib/job-view";
import { formatMinorUnits } from "../src/lib/money";

const usd = (minor_units: number) => ({ currency: "USD", minor_units });

describe("money display is integer-only (0.0.18)", () => {
  it.each([
    [0, "$0.00"], [1, "$0.01"], [7, "$0.07"], [99, "$0.99"], [100, "$1.00"], [101, "$1.01"],
    [-1, "-$0.01"], [-250, "-$2.50"], [123456789, "$1,234,567.89"], [Number.MAX_SAFE_INTEGER, "$90,071,992,547,409.91"],
  ])("USD %i minor units -> %s", (minor, text) => {
    expect(formatMinorUnits(usd(minor))).toBe(text);
    expect(formatMoney(usd(minor))).toBe(text); // job-view's formatMoney is the same function now
  });
  it("uses the currency's own digits", () => {
    expect(formatMinorUnits({ currency: "JPY", minor_units: 100000 })).toBe("¥100,000");
    expect(formatMinorUnits({ currency: "KWD", minor_units: 1234 }).replace(/\s/g, " ")).toBe("KWD 1.234");
  });
  it("keeps the page's wording for an unknown currency code", () => {
    expect(formatMoney({ currency: "not-a-code", minor_units: 7 })).toBe("7 not-a-code (minor units)");
  });
  it("refuses a non-integer amount instead of rounding it", () => {
    expect(formatMoney(usd(12.5))).toBe("Unavailable");
  });
});
