import type { ProjectScientificClaimsOutput, ScientificClaim } from "@chemdft/schemas";
import { AppIcon } from "@chemdft/ui";

import { codeLabel, deltaText, uncertaintyView, valueView } from "@/lib/claim-format";
import { ClaimValue } from "./claim-value";
import { ScientificTimestamp } from "../scientific-timestamp";

type Relation = ProjectScientificClaimsOutput["relations"][number];

export function ClaimInspector({ claim, claims, relations }: { claim: ScientificClaim | null; claims: ScientificClaim[]; relations: Relation[] }) {
  if (!claim) {
    return <aside className="claim-inspector" aria-label="Selected claim inspector" tabIndex={0}>
      <div className="claim-inspector-title"><span>CLAIM INSPECTOR</span><AppIcon icon="th-list" /></div>
      <p className="claim-inspector-empty">Select a claim to see its recorded value, qualifier, uncertainty, source and state.</p>
    </aside>;
  }
  const context = { claimType: claim.claim_type, qualifier: claim.qualifier };
  const uncertainty = uncertaintyView(claim.uncertainty, claim.unit);
  const related = relations.filter((relation) => relation.left_claim_id === claim.id || relation.right_claim_id === claim.id);
  const effective = claim.effective_result_state;
  const inactive = claim.semantic_status === "INACTIVE_SOURCE";
  const where = [claim.page ? `Page ${claim.page}` : null, claim.figure ? `Figure ${claim.figure}` : null, claim.table ? `Table ${claim.table}` : null].filter(Boolean).join(" · ");
  const code = (kind: Parameters<typeof codeLabel>[0], value: string) => <span title={`Server code: ${value}`} data-code={value}>{codeLabel(kind, value)}</span>;

  return <aside className="claim-inspector" aria-label="Selected claim inspector" tabIndex={0} data-claim-id={claim.id}>
    <div className="claim-inspector-title"><span>CLAIM INSPECTOR</span><AppIcon icon="th-list" /></div>
    <h2>{claim.subject}</h2>
    <p className="claim-predicate">{claim.predicate}</p>
    {inactive ? <p className="claim-inactive" role="note"><AppIcon icon="warning-sign" /> Inactive source{effective?.reason ? `: ${effective.reason}` : ""}. This claim is shown for the record and is not eligible for derivation.</p> : null}

    <div className="claim-value">
      <ClaimValue view={valueView(claim.value, context)} unit={claim.unit} original={claim.original_value_text} />
    </div>
    {claim.qualifier ? <p className="claim-qualifier"><span>Qualifier (as recorded)</span> {claim.qualifier}</p> : null}
    {uncertainty ? <div className="claim-uncertainty"><span>Uncertainty (as recorded)</span> <ClaimValue view={uncertainty} /></div> : null}
    {claim.original_value_text
      ? <p className="claim-precision-note" data-testid="claim-original-note">The number is shown as written in the source. Nothing is rounded or converted here.</p>
      : <p className="claim-precision-note">Digits are shown exactly as the server recorded them; nothing is rounded or converted here.</p>}

    <div className="claim-inspector-actions">
      {claim.source_href ? <a className="bp6-button bp6-intent-primary" href={claim.source_href}>
        <AppIcon icon={claim.source_authority === "DIGITIZED" ? "timeline-events" : claim.source_authority === "RECONSTRUCTED" ? "cube" : "document-open"} />
        {claim.source_record_type === "experimental_dataset" ? "View dataset" : claim.source_record_type === "structure_version" ? "View structure" : "View source"}
      </a> : <span className="claim-no-link">The server provided no link for this source.</span>}
      <small>Projection is read only · the source record remains authoritative</small>
    </div>

    <h3 className="claim-section-title">Recorded fields</h3>
    <dl className="claim-record">
      <dt>Claim type</dt><dd>{code("claim_type", claim.claim_type)}</dd>
      <dt>Authority</dt><dd>{code("source_authority", claim.source_authority)}</dd>
      <dt>Review state</dt><dd>{code("review_state", claim.review_state)}</dd>
      <dt>Semantic status</dt><dd>{code("semantic_status", claim.semantic_status ?? "EXPLICIT")}</dd>
      {claim.quantity_key ? <><dt>Quantity key</dt><dd className="claim-mono">{claim.quantity_key}</dd></> : null}
      <dt>Source</dt><dd>{claim.source_label}</dd>
      {where ? <><dt>Location</dt><dd>{where}</dd></> : null}
      <dt>Source record</dt><dd className="claim-mono">{claim.source_record_type} · {claim.source_record_id}</dd>
      {claim.source_document_id ? <><dt>Document id</dt><dd className="claim-mono">{claim.source_document_id}</dd></> : null}
      {claim.evidence_id ? <><dt>Evidence id</dt><dd className="claim-mono">{claim.evidence_id}</dd></> : null}
      {claim.provenance_hash ? <><dt>Source hash</dt><dd className="claim-mono claim-hash">{claim.provenance_hash}</dd></> : null}
      {claim.created_at ? <><dt>Recorded</dt><dd><ScientificTimestamp value={claim.created_at} /></dd></> : null}
    </dl>

    {effective ? <section className="claim-effective" aria-label="Effective result state">
      <h3 className="claim-section-title">Effective result state</h3>
      <dl className="claim-record">
        <dt>Lineage</dt><dd>{effective.source_lineage_validity}</dd>
        <dt>Derivation</dt><dd>{effective.eligible_for_derivation ? "Eligible" : "Not eligible"}</dd>
        <dt>Authority</dt><dd>{effective.authority}{effective.authority !== effective.stored_authority ? ` (stored: ${effective.stored_authority})` : ""}</dd>
        <dt>Validation</dt><dd>{effective.validation_state}{effective.validation_state !== effective.stored_validation_state ? ` (stored: ${effective.stored_validation_state})` : ""}</dd>
        <dt>Verification</dt><dd>{effective.verification_state}{effective.verification_state !== effective.stored_verification_state ? ` (stored: ${effective.stored_verification_state})` : ""}</dd>
        {effective.reason ? <><dt>Reason</dt><dd>{effective.reason}</dd></> : null}
      </dl>
    </section> : null}

    <section className="claim-relations" aria-label="Related claims">
      <h3>Related claims</h3>
      {related.length ? related.map((relation) => {
        const otherId = relation.left_claim_id === claim.id ? relation.right_claim_id : relation.left_claim_id;
        const other = claims.find((item) => item.id === otherId);
        const difference = deltaText(relation.numeric_delta, relation.delta_unit);
        return <article key={`${relation.left_claim_id}:${relation.right_claim_id}`}>
          <strong>{codeLabel("relation", relation.relation)}</strong>
          <p>{other ? <>{other.predicate}: <ClaimValue view={valueView(other.value, { claimType: other.claim_type, qualifier: other.qualifier })} unit={other.unit} compact /></> : otherId}</p>
          <small>{relation.rationale}</small>
          {difference ? <p className="claim-relation-difference">Server-provided difference: <span>{difference}</span></p> : null}
        </article>;
      }) : <p>No deterministic relation is assigned.</p>}
    </section>
  </aside>;
}
