import type { ScientificClaim, ScientificComparisonRow } from "@chemdft/schemas";
import { AppIcon } from "@chemdft/ui";

import { codeLabel, uncertaintyView, valueText, valueView } from "@/lib/claim-format";
import { explainRow, rowDeltaText, whyHeading } from "@/lib/comparison-format";
import { ClaimValue } from "../claims/claim-value";
import styles from "./comparison.module.css";

/** The raw quantity key with break opportunities after "." and "_", so a narrow column wraps between words and not inside one. */
export const KeyText = ({ text }: { text: string }) => <>{text.split(/(?<=[._])/).map((part, index) => <span key={index}>{part}<wbr /></span>)}</>;

export const sourceIcon = (claim: ScientificClaim) =>
  claim.source_authority === "DIGITIZED" ? "timeline-events" : claim.source_authority === "RECONSTRUCTED" ? "cube" : "document-open";

export const locatorOf = (claim: ScientificClaim): string =>
  [claim.page ? `p. ${claim.page}` : null, claim.figure ? `Fig. ${claim.figure}` : null, claim.table ? `Table ${claim.table}` : null].filter(Boolean).join(" · ");

export function AuthorityTag({ claim }: { claim: ScientificClaim }) {
  return <span className={`claim-authority authority-${claim.source_authority.toLowerCase().replaceAll("_", "-")}`} data-authority={claim.source_authority}
    title={`Server code: ${claim.source_authority}`}>{codeLabel("source_authority", claim.source_authority)}</span>;
}

/** One claim of a row, value first, then what the server recorded about it. Never rounded, never reinterpreted. */
function SideClaim({ claim, side, topic }: { claim: ScientificClaim; side: "paper" | "chemdft"; topic: string }) {
  const context = { claimType: claim.claim_type, qualifier: claim.qualifier };
  const uncertainty = uncertaintyView(claim.uncertainty, claim.unit);
  const locator = locatorOf(claim);
  return <div className={styles.claim} data-claim-id={claim.id} data-side={side}>
    <div className={styles.claimValue} title={valueText(claim.value, claim.unit, context)}><ClaimValue view={valueView(claim.value, context)} unit={claim.unit} compact original={claim.original_value_text} /></div>
    {claim.qualifier ? <small className={styles.qualifier}>{claim.qualifier}</small> : null}
    {uncertainty ? <small className={styles.uncertainty}>Uncertainty (as recorded): <ClaimValue view={uncertainty} compact /></small> : null}
    <div className={styles.claimMeta}>
      <AuthorityTag claim={claim} />
      <span title={`Server code: ${claim.review_state}`}>{codeLabel("review_state", claim.review_state)}</span>
      {locator ? <span>{locator}</span> : null}
      {claim.source_href
        ? <a className={styles.jump} href={claim.source_href} aria-label={`${side === "paper" ? "Open source" : "Open ChemDFT record"} for ${topic}`} onClick={(event) => event.stopPropagation()}>
          <AppIcon icon={sourceIcon(claim)} />{side === "paper" ? "Source" : "Record"}
        </a>
        : <span className={styles.noLink}>No link</span>}
    </div>
  </div>;
}

function Side({ claims, side, topic, empty }: { claims: readonly ScientificClaim[]; side: "paper" | "chemdft"; topic: string; empty: string }) {
  return claims.length ? <>{claims.map((claim) => <SideClaim key={claim.id} claim={claim} side={side} topic={topic} />)}</> : <span className={styles.empty}>{empty}</span>;
}

type RowProps = { row: ScientificComparisonRow; selected: boolean; onSelect: (id: string) => void };

export function ComparisonRowGroup({ row, selected, onSelect }: RowProps) {
  const explanation = explainRow(row);
  const delta = rowDeltaText(row);
  const select = () => onSelect(row.id);
  const aux = explanation.blocked || explanation.rule;
  return <>
    <tr className={`comparison-row ${styles.row}`} data-row-id={row.id} data-relation={row.relation} data-blocked={explanation.blocked ? "true" : undefined}
      aria-selected={selected} tabIndex={0} onClick={select}
      onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); select(); } }}>
      <td className={styles.topicCell}><strong>{row.topic}</strong><small className={styles.mono}>{row.quantity_key ? <KeyText text={row.quantity_key} /> : "Qualitative claim"}</small></td>
      <td><Side claims={row.source_claims ?? []} side="paper" topic={row.topic} empty="No paper counterpart" /></td>
      <td className={styles.relationCell}>
        <span className={styles.relation} data-code={row.relation} title={`Server code: ${row.relation}`}>{codeLabel("relation", row.relation)}</span>
        {delta ? <div className={styles.delta}><small>Source minus ChemDFT</small><span className={styles.deltaValue}>{delta}</span></div> : null}
      </td>
      <td><Side claims={row.project_claims ?? []} side="chemdft" topic={row.topic} empty="No ChemDFT counterpart" /></td>
    </tr>
    {aux ? <tr className={`${styles.auxRow} ${explanation.blocked ? styles.blockedRow : ""}`} data-for={row.id} data-selected={selected} onClick={select}>
      <td colSpan={4}>
        {explanation.blocked ? <div className={styles.why} role="note">
          <strong><AppIcon icon="warning-sign" /> {whyHeading(row)}</strong>
          {explanation.reason ? <p><span>Reason</span> {explanation.reason}</p> : null}
          {explanation.rule ? <p><span>Rule</span> {explanation.rule}</p> : null}
        </div> : <p className={styles.rule}><span>Rule</span> {explanation.rule}</p>}
      </td>
    </tr> : null}
  </>;
}

export function ComparisonTable({ rows, sections, selectedId, onSelect, loading, emptyText }: {
  rows: ScientificComparisonRow[]; sections: string[]; selectedId: string | null; onSelect: (id: string) => void; loading: boolean; emptyText: string | null;
}) {
  return <table className={styles.table}>
    <thead><tr><th scope="col">Property / topic</th><th scope="col">Paper</th><th scope="col">Relation</th><th scope="col">ChemDFT</th></tr></thead>
    <tbody>
      {sections.map((section) => {
        const inSection = rows.filter((row) => row.section === section);
        return <SectionRows key={section} section={section} rows={inSection} selectedId={selectedId} onSelect={onSelect} />;
      })}
      {loading ? <tr><td colSpan={4}>Loading projected claims…</td></tr> : null}
      {emptyText ? <tr><td colSpan={4}>{emptyText}</td></tr> : null}
    </tbody>
  </table>;
}

function SectionRows({ section, rows, selectedId, onSelect }: { section: string; rows: ScientificComparisonRow[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return <>
    <tr className={`comparison-section ${styles.section}`}><th colSpan={4} scope="colgroup">{section}<span>{rows.length}</span></th></tr>
    {rows.map((row) => <ComparisonRowGroup key={row.id} row={row} selected={row.id === selectedId} onSelect={onSelect} />)}
  </>;
}
