import { AppIcon } from "@chemdft/ui";

import { ALL, codeLabel, type CodeKind } from "@/lib/claim-format";

/**
 * Filter controls shared by the Claims and Paper vs ChemDFT pages. Markup and class names are the ones Claims shipped with
 * (styled by `.claims-toolbar` / `.claims-chips` in globals.css), so moving them changed nothing on Claims.
 */

export function FacetSelect({ label, ariaLabel, allLabel, kind, value, counts, known, onChange }: {
  label: string; ariaLabel: string; allLabel: string; kind?: CodeKind; value: string;
  counts: Map<string, number>; known: string[]; onChange: (value: string) => void;
}) {
  const options = [...new Set([...known, ...counts.keys(), ...(value !== ALL ? [value] : [])])];
  if (known.length === 0) options.sort();
  return <label>{label}
    <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value={ALL}>{allLabel}</option>
      {options.map((code) => <option key={code} value={code}>{kind ? codeLabel(kind, code) : code} ({counts.get(code) ?? 0})</option>)}
    </select>
  </label>;
}

export function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return <span className="claims-chip">{label}<button type="button" aria-label={`Remove filter ${label}`} onClick={onRemove}><AppIcon icon="small-cross" /></button></span>;
}

