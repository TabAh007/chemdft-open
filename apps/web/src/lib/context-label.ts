/**
 * Release 0.0.25 (third PR): the AI panel's context line ("Ask about …") can be long (project → structure → record →
 * member). Keep the first segment (what the researcher recognises) and the last (the current page) and elide the
 * middle; the full text stays in the tooltip. Display only.
 */
export function compactContextLabel(label: string, maxLength = 90): string {
  if (label.length <= maxLength) return label;
  const parts = label.split(" → ");
  if (parts.length > 2) return `${parts[0]} → … → ${parts[parts.length - 1]}`;
  const dot = label.split(" · ");
  if (dot.length > 3) return `${dot[0]} · … · ${dot[dot.length - 1]}`;
  return `${label.slice(0, Math.floor(maxLength * 0.45))}…${label.slice(-Math.floor(maxLength * 0.45))}`;
}
