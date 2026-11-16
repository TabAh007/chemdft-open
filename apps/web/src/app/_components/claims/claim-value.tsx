import type { ValueView } from "@/lib/claim-format";

/**
 * A claim value exactly as the server recorded it. `compact` is for table rows: it shows at most two fields of an object
 * and says how many more there are; the inspector shows all of them. `original` is the source's own spelling of a single number
 * (for example 24.480); when present it is shown instead of the server's number.
 */
export function ClaimValue({ view, unit, compact = false, original }: { view: ValueView; unit?: string | null | undefined; compact?: boolean; original?: string | null | undefined }) {
  const unitNode = unit ? <small className="claim-unit"> {unit}</small> : null;
  switch (view.kind) {
    case "empty":
      return <span className="claim-no-value">No value recorded</span>;
    case "text":
      return <span className="claim-text-value">{view.text}</span>;
    case "scalar":
      return <span className="claim-number" data-original={original ? "true" : undefined}>{original ?? view.text}{unitNode}</span>;
    case "range":
      return <span className="claim-number">{view.from}<span className="claim-range-word"> to </span>{view.to}{unitNode}</span>;
    case "list":
      return <span className="claim-number">{view.items.join(", ")}{unitNode}</span>;
    case "fields": {
      const shown = compact ? view.fields.slice(0, 2) : view.fields;
      const more = view.fields.length - shown.length + view.omitted;
      return <dl className="claim-fields">
        {shown.map((field) => <div key={field.label}><dt>{field.label || "value"}</dt><dd>{field.text}{unitNode}</dd></div>)}
        {more > 0 ? <div className="claim-fields-more"><dt>+{more} more</dt><dd>{compact ? "see inspector" : "not shown here"}</dd></div> : null}
      </dl>;
    }
  }
}
