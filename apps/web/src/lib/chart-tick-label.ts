/**
 * Text for a chart AXIS label. The end points of a plot axis are the data range plus a margin, so they come out as floating-point
 * artifacts such as 33.899480000000004; they are rounded for display here. This is a scale label only: it is never used for a
 * value, a table cell, an export or a tooltip (those keep every digit the server sent; see claim-format.ts).
 */
export function axisTickText(value: number): string {
  return String(Number(value.toPrecision(6)));
}
