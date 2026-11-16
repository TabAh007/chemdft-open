/**
 * Release 0.0.25 follow-up: the result status header may only describe the record the page itself shows.
 * Before, a leftover selection (for example the IR result) kept its header on the Thermochemistry page even
 * when that page had no thermochemistry result ("No thermochemistry calculated yet").
 */
export function resultHeaderBelongsToView(
  view: string,
  selectedResultId: string,
  records: { thermoResultIds: readonly string[]; spectraResultIds: ReadonlyArray<string | undefined>; loadedResultId?: string | undefined },
): boolean {
  if (view === "thermochemistry") return records.thermoResultIds.includes(selectedResultId);
  if (view === "spectra") return records.spectraResultIds.includes(selectedResultId);
  return records.loadedResultId === undefined ? true : records.loadedResultId === selectedResultId;
}
