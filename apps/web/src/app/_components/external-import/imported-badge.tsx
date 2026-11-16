"use client";

/** Marks data that came from an external program's output. It is never a ChemDFT engine result. */
export function ImportedBadge({ source }: { source: string }) {
  return (
    <span
      className="import-badge"
      data-testid="imported-badge"
      title="Imported from the output of an external program. Not calculated by ChemDFT."
    >
      <span className="import-badge-tag">Imported</span>
      <span className="import-badge-source" data-testid="imported-source">{source}</span>
    </span>
  );
}
