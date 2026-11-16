import type { ScientificClaim, ScientificComparisonRow } from "@chemdft/schemas";
import { AppIcon } from "@chemdft/ui";

import { codeLabel, uncertaintyView, valueView } from "@/lib/claim-format";
import { claimsOf, explainRow, rowDeltaText } from "@/lib/comparison-format";
import { ClaimValue } from "../claims/claim-value";
import { ScientificTimestamp } from "../scientific-timestamp";
import { AuthorityTag, locatorOf, sourceIcon } from "./comparison-rows";
import styles from "./comparison.module.css";

const linkLabel = (claim: ScientificClaim) =>
  claim.source_record_type === "experimental_dataset" ? "View dataset" : claim.source_record_type === "structure_version" ? "View structure" : "View source";

function ClaimDetail({ claim }: { claim: ScientificClaim }) {
  const context = { claimType: claim.claim_type, qualifier: claim.qualifier };
  const uncertainty = uncertaintyView(claim.uncertainty, claim.unit);
  const locator = locatorOf(claim);
  return <article className={styles.detailClaim} data-claim-id={claim.id}>
    <strong>{claim.predicate}</strong>
    <div className={styles.detailValue}><ClaimValue view={valueView(claim.value, context)} unit={claim.unit} original={claim.original_value_text} /></div>
    {claim.qualifier ? <p className={styles.qualifier}><span>Qualifier (as recorded)</span> {claim.qualifier}</p> : null}
    {uncertainty ? <p className={styles.uncertainty}><span>Uncertainty (as recorded)</span> <ClaimValue view={uncertainty} /></p> : null}
    <p className={styles.claimMeta}>
      <AuthorityTag claim={claim} />
      <span title={`Server code: ${claim.review_state}`}>{codeLabel("review_state", claim.review_state)}</span>
      {claim.semantic_status === "INACTIVE_SOURCE" ? <span className="claim-inactive-tag" title="Server code: INACTIVE_SOURCE">Inactive source</span> : null}
    </p>
    <dl className={styles.record}>
      <dt>Source</dt><dd>{claim.source_label}</dd>
      {locator ? <><dt>Location</dt><dd>{locator}</dd></> : null}
    </dl>
    {claim.source_href
      ? <a className="bp6-button bp6-small" href={claim.source_href}><AppIcon icon={sourceIcon(claim)} /><span className="bp6-button-text">{linkLabel(claim)}</span></a>
      : <span className={styles.noLink}>The server provided no link for this record.</span>}
  </article>;
}

function Identifiers({ title, claims }: { title: string; claims: readonly ScientificClaim[] }) {
  return <>{claims.map((claim) => <dl className={styles.record} key={claim.id} aria-label={`${title} identifiers`}>
    <dt>{title}</dt><dd className={styles.mono}>{claim.predicate}</dd>
    <dt>Record</dt><dd className={styles.mono}>{claim.source_record_type} · {claim.source_record_id}</dd>
    {claim.source_document_id ? <><dt>Document</dt><dd className={styles.mono}>{claim.source_document_id}</dd></> : null}
    {claim.evidence_id ? <><dt>Evidence</dt><dd className={styles.mono}>{claim.evidence_id}</dd></> : null}
    {claim.provenance_hash ? <><dt>Provenance hash</dt><dd className={`${styles.mono} comparison-hash`}>{claim.provenance_hash}</dd></> : null}
    {claim.created_at ? <><dt>Recorded</dt><dd><ScientificTimestamp value={claim.created_at} /></dd></> : null}
  </dl>)}</>;
}

function Side({ title, claims, empty }: { title: string; claims: readonly ScientificClaim[]; empty: string }) {
  return <section className={styles.detailSection}><h3>{title}</h3>
    {claims.length ? claims.map((claim) => <ClaimDetail key={claim.id} claim={claim} />) : <p className={styles.empty}>{empty}</p>}
  </section>;
}

export function ComparisonInspector({ row }: { row: ScientificComparisonRow | null }) {
  if (!row) {
    return <aside className={styles.inspector} aria-label="Comparison row inspector" tabIndex={0}>
      <div className={styles.inspectorTitle}><span>ROW INSPECTOR</span><AppIcon icon="th-list" /></div>
      <p className={styles.empty}>Select a row to see both sides, the server&apos;s rule and where each value comes from.</p>
    </aside>;
  }
  const explanation = explainRow(row);
  const delta = rowDeltaText(row);
  const claims = claimsOf(row);
  const units = [...new Set(claims.map((claim) => claim.unit ?? "unit not declared"))];
  return <aside className={styles.inspector} aria-label="Comparison row inspector" tabIndex={0} data-row-id={row.id}>
    <div className={styles.inspectorTitle}><span>ROW INSPECTOR</span><span className={styles.relation} data-code={row.relation} title={`Server code: ${row.relation}`}>{codeLabel("relation", row.relation)}</span></div>
    <h2>{row.topic}</h2>
    <p className={`${styles.caption} ${styles.mono}`}>{row.quantity_key ?? "Qualitative claim"}</p>
    {row.section === "Structure" && row.relation === "DERIVED_FROM"
      ? <p className={styles.warning} role="note">The paper did not provide these full coordinates. The ChemDFT reconstruction uses user supplied coordinates and is not experimental validation.</p> : null}
    <section className={styles.detailSection}><h3>Relation</h3>
      <dl className={styles.record}>
        <dt>State</dt><dd><span title={`Server code: ${row.relation}`}>{codeLabel("relation", row.relation)}</span></dd>
        <dt>Units</dt><dd>{units.join(" · ") || "—"}</dd>
        {delta ? <><dt>Difference</dt><dd className={styles.mono}>{delta}</dd><dt>Convention</dt><dd>Source minus ChemDFT</dd></> : null}
        {explanation.rule ? <><dt>Rule</dt><dd>{explanation.rule}</dd></> : null}
        {explanation.reason ? <><dt>Unresolved</dt><dd>{explanation.reason}</dd></> : null}
        <dt>Authority</dt><dd>{(row.authority_summary ?? []).map((code) => codeLabel("source_authority", code)).join(" · ") || "—"}</dd>
        <dt>Review</dt><dd>{(row.review_summary ?? []).map((code) => codeLabel("review_state", code)).join(" · ") || "—"}</dd>
      </dl>
    </section>
    <Side title="Paper" claims={row.source_claims ?? []} empty="No paper counterpart exists for this row." />
    <Side title="ChemDFT" claims={row.project_claims ?? []} empty="No ChemDFT counterpart exists yet." />
    {claims.length ? <section className={styles.detailSection}><h3>Identifiers</h3>
      <Identifiers title="Paper" claims={row.source_claims ?? []} />
      <Identifiers title="ChemDFT" claims={row.project_claims ?? []} />
    </section> : null}
  </aside>;
}
