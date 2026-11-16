import { formulaParts } from "./structures";

/** A chemical formula with real subscripts; assistive technology gets the plain text ("Cr2O3"). */
export function Formula({ formula }: { formula: string }) {
  return (
    <>
      <span aria-hidden="true" className="formula">
        {formulaParts(formula).map((part, i) => (part.sub ? <sub key={i}>{part.text}</sub> : <span key={i}>{part.text}</span>))}
      </span>
      <span className="sr-only">{formula}</span>
    </>
  );
}
