/** Read-only view-model for the result lineage export. Only values present in the document are shown. */

export type ProvenanceArtifact = { artifactId: string; sha256: string };
export type ProvenanceStep = {
  id: string;
  operation: string;
  version: string;
  producer: string;
  createdAt: string;
  detail: string | null;
  approximate: boolean;
};
export type ProvenanceSummary = {
  schema: string;
  truncated: boolean;
  historicalEvidence: boolean;
  producer: Array<{ label: string; value: string }>;
  steps: ProvenanceStep[];
  artifacts: ProvenanceArtifact[];
  lineage: Array<{ resultId: string; resultType: string; authority: string; lineageValidity: string | null }>;
};

type Json = Record<string, unknown>;

const asObject = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;
const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : typeof value === "number" ? String(value) : null;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Returns null when the document is not a recognisable lineage export (never guesses). */
export function summarizeProvenance(document: unknown): ProvenanceSummary | null {
  const root = asObject(document);
  const result = asObject(root?.result);
  if (!root || !result || root.schema !== "chemdft.result-lineage-export.v1") return null;

  const software = asObject(result.producer_software);
  const producer: ProvenanceSummary["producer"] = [];
  const add = (label: string, value: unknown) => {
    const v = text(value);
    if (v) producer.push({ label, value: v });
  };
  add("Trusted producer", result.trusted_producer_id);
  add("Producer type", result.trusted_producer_type);
  add("Engine", [text(software?.name), text(software?.version)].filter(Boolean).join(" ") || null);
  add("Adapter version", software?.adapter_version);
  add("Execution backend", software?.execution_backend);
  add("Hardware class", software?.hardware_class);
  add("Environment digest (SHA-256)", software?.environment_digest);
  add("Execution attestation", result.producer_attestation_id);
  add("Result created", result.created_at);

  const steps = list(root.provenance_records).flatMap((raw): ProvenanceStep[] => {
    const row = asObject(raw);
    const id = text(row?.id);
    if (!row || !id) return [];
    return [{
      id,
      operation: text(row.operation) ?? "unspecified operation",
      version: text(row.operation_version) ?? "",
      producer: [text(row.producer_identifier), text(row.producer_software_version)].filter(Boolean).join(" "),
      createdAt: text(row.created_at) ?? "",
      detail: text(row.detail),
      approximate: row.approximate === true,
    }];
  });

  const artifacts = list(result.raw_artifacts).flatMap((raw): ProvenanceArtifact[] => {
    const row = asObject(raw);
    const artifactId = text(row?.artifact_id);
    const sha256 = text(row?.sha256);
    return artifactId && sha256 ? [{ artifactId, sha256 }] : [];
  });

  const lineage = list(root.lineage_results).flatMap((raw) => {
    const row = asObject(raw);
    const resultId = text(row?.id);
    if (!row || !resultId) return [];
    return [{
      resultId,
      resultType: text(row.result_type) ?? "unknown",
      authority: text(row.authority) ?? "unknown",
      lineageValidity: text(asObject(row.effective_state)?.source_lineage_validity),
    }];
  });

  return {
    schema: root.schema,
    truncated: root.truncated === true,
    historicalEvidence: root.historical_evidence === true,
    producer,
    steps,
    artifacts,
    lineage,
  };
}
