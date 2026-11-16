/** A server amount: an integer count of the currency's smallest unit. */
export type MinorUnitMoney = { currency: string; minor_units: number };

/**
 * Exact money text from integer minor units, for example 1250 USD -> "$12.50", 100000 JPY -> "¥100,000", 1234 KWD -> "KWD 1.234".
 * Integer arithmetic only (BigInt quotient and remainder): no float division, no rounding. The number of minor digits comes from the
 * currency itself (Intl metadata), never from the amount. A non-integer amount, or a currency the runtime does not know, is not
 * formatted: the caller gets a labelled raw value, or "Unavailable" when there is nothing safe to print.
 */
export function formatMinorUnits(money: MinorUnitMoney): string {
  const { currency, minor_units: minor } = money;
  if (typeof minor !== "number" || !Number.isSafeInteger(minor)) return "Unavailable";
  try {
    const format = new Intl.NumberFormat("en", { style: "currency", currency });
    const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
    const symbol = format.formatToParts(0).find((part) => part.type === "currency")?.value ?? currency;
    const units = BigInt(minor);
    const negative = units < 0n;
    const absolute = negative ? -units : units;
    const base = 10n ** BigInt(digits);
    const whole = (absolute / base).toLocaleString("en");
    const fraction = digits > 0 ? `.${(absolute % base).toString().padStart(digits, "0")}` : "";
    const gap = /^[A-Za-z]+$/.test(symbol) ? " " : "";
    return `${negative ? "-" : ""}${symbol}${gap}${whole}${fraction}`;
  } catch {
    return `${minor} minor units (${currency})`;
  }
}
