import { orcidIdUrl } from "../../lib/orcid";

/**
 * An authenticated ORCID iD in the "Full iD" form of ORCID's display guidelines: the unaltered official iD icon (24 px) before the
 * complete https URL, linked to the record. A sandbox iD points at sandbox.orcid.org and says so.
 */
export function OrcidId({ orcidId, environment }: { orcidId: string; environment: string }) {
  const url = orcidIdUrl(orcidId, environment);
  return (
    <span data-testid="orcid-id">
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`View ORCID record - ${orcidId}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the official icon file, used as provided */}
        <img src="/orcid-id-icon.svg" alt="ORCID iD" width={24} height={24} />
        <span>{url}</span>
      </a>
      {environment === "production" ? null : <span style={{ marginLeft: 8 }}>(ORCID sandbox test record)</span>}
    </span>
  );
}
