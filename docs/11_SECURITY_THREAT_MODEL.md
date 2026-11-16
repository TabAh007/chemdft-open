# Initial Security and Scientific Threat Model

## Scope and assets

Protect tenant/project data, scientific source files and results, provenance/audit history, AI and compute credentials, budgets/payment state, intellectual property, worker infrastructure, availability, and scientific trust. Trust boundaries include browser↔API, API↔data/services, model provider, document ingestion, object storage, queue↔worker, compute provider/HPC, and WebMCP/MCP/API clients.

The baseline posture is deny by default, least privilege, tenant/project scoping, immutable evidence, isolated execution, explicit budgets/permissions, defense in depth, and auditable state changes.

## Threats and baseline controls

| Threat | Example impact | Required controls |
|---|---|---|
| Prompt injection in papers/retrieval | document orders agent to reveal data or invoke tools | treat content as untrusted evidence; instruction/data separation; tool allowlists; independent authorization; output encoding; injection tests |
| Malicious PDF/file | parser exploit, decompression bomb, malware | quarantine; magic/size/type limits; malware scanning; sandboxed parsers; no active content; resource/time limits; patched parsers; safe previews |
| RAG poisoning | false or malicious claims dominate answers | source ACLs; provenance/ranking; trust tiers; conflict display; ingestion audit; correction/supersession; no retrieved policy overrides |
| Tool abuse / WebMCP/MCP abuse | privilege escalation or unintended actions | authenticated typed registry; per-surface allowlists; schema validation; capability checks; consent; rate limits; audit; idempotency; no logic in registration |
| Schema/version confusion or mass assignment | downgrade authority, smuggle identity/policy, recursive payload denial | strict extra-forbid schemas; recognized versions; bounded scalar extensions; actor/approval/producer context out of band; request size/depth limits at transports |
| Trusted-producer spoofing | AI/client writes authoritative result | non-request capability object; internal issuance seam; allowlisted producer types; attestation; no public result-create route; firewall adversarial tests |
| Artifact hash/reference substitution | wrong or foreign data becomes authoritative | SHA-256 contract; immutable artifact row; composite project foreign keys; firewall existence/project/hash checks |
| Audit or provenance mutation | history rewritten after publication | append-only application models; correction/verification/supersession records; restricted production database roles later |
| Unauthorized expensive compute | financial loss / denial of service | deterministic estimates, quotas, reservations, signed approvals, hard resource/runtime limits, server-side cost caps, anomaly detection, kill switch |
| Budget bypass/race | concurrent jobs overspend cap | transactional reservation ledger; immutable usage events; idempotency; reconciliation; no client/model-controlled authorization values |
| AI API key theft | account compromise/cost/data leak | secrets manager/envelope encryption; OAuth where possible; scoped decrypt permission; rotation/revocation; redaction; never browser/prompt/log storage |
| Cross-project/tenant leakage | confidentiality breach | project-scoped authorization on every access; database RLS/defense; scoped object keys/URLs; cache/vector filters; tenant tests; no ID-only trust |
| Malicious scientific file parsing | native parser compromise or false chemistry | isolated parser workers; strict formats/limits; patched libraries; fuzzing; quarantine outputs; explicit parser version/error state |
| Arbitrary code via calculation inputs | worker takeover | structured allowlisted inputs only; no shell fragments/templates from users; argument arrays; immutable engine images; seccomp/container/microVM limits |
| Compute sandbox escape | infrastructure compromise | ephemeral hardened workers; non-root; minimal image; no host socket; network deny/allowlist; cloud IAM isolation; runtime patching; provider controls |
| Secrets exposure | data/provider compromise | short-lived workload identity and scoped artifact tokens; centralized redaction; secret scanning; separate environments; incident rotation plan |
| SSRF | metadata/internal service access | egress proxy/allowlist; block private/link-local metadata ranges; DNS/IP revalidation; no arbitrary URL fetching in privileged services |
| Destructive agent actions | deleted/overwritten scientific work | explicit authorization; variants/versioning; soft-delete/recovery; previews; bounded scope; audit; agent action limits |
| Hallucinated scientific output | unsafe scientific conclusions | Scientific Result Firewall; source-state labels; citations/result IDs; protected fields; deterministic renderers; evaluation and UI distinction |
| Provenance tampering | unverifiable/fraudulent results | append-only audit; content hashes; restricted service writes; signatures/attestation; immutable raw artifacts; corrections not mutation |
| Fraudulent result modification | manipulated conclusions/export | role separation; write-path restrictions; result versioning; review/verification records; export manifests; anomaly/audit review |
| Dependency/supply-chain compromise | code execution or silent numerical change | pinned hashes/images; SBOM; signature/provenance verification; vulnerability/license scans; controlled upgrades; scientific regression benchmarks |
| Model/provider data retention | leakage of project content | explicit provider policy configuration; minimal context; tenant controls; managed/BYOK disclosures; enterprise no-retention options where available |

## Authorization model

Authentication establishes identity; authorization derives organization/project capabilities server-side. Service identities are separate for API, ingestion, calculation workers, firewall writers, and billing reconciliation. Authoritative result and provenance mutations require narrowly scoped service roles. Support revocation and session/device audit.

Action policy combines role/capability, resource ownership, tool permission class, data sensitivity, budget, and approval. The LLM, browser, WebMCP client, and compute provider cannot declare their own trust level.

Phase 2 represents trusted tool context and producer context as separate server-created objects, never tool arguments. Permission/cost/side-effect metadata is immutable registry state. Current local trusted-producer issuance is a test/composition harness; production service authentication, signatures, rate limits, payload byte/depth limits, and restricted database roles remain mandatory before external authoritative writes.

## Scientific worker isolation

- Generate engine inputs from validated structures and allowlisted typed settings; never concatenate shell commands.
- Execute pinned minimal containers or stronger isolation for untrusted/native workloads; non-root, read-only base, ephemeral filesystem, restricted syscalls/devices/network.
- Mount only the job's inputs; provide short-lived write-only/scoped output credentials where possible.
- Apply CPU, memory, GPU, process, time, network, and artifact-size limits.
- Validate/hash/quarantine outputs before ingestion through the [Scientific Result Firewall](02_SCIENTIFIC_INTEGRITY.md).

BYOC/HPC adapters must assume the remote environment has a distinct trust boundary. Signed job bundles, mutually authenticated agents, least-privilege project access, explicit data movement, and verifiable artifact lineage are required.

## Detection and response

Correlate user request, agent run, tool call, calculation job, compute execution, usage event, and artifact without putting secrets/raw payloads in general logs. Alert on budget anomalies, repeated authorization failures, cross-tenant probes, unexpected egress, parser crashes, result provenance failures, and audit mutations. Define credential revocation, worker quarantine, job cancellation, customer notification, evidence preservation, and recovery playbooks before production.

## Validation before production

- Tenant-isolation and authorization matrix tests.
- Prompt-injection/tool-abuse adversarial evaluation.
- Parser fuzzing and malicious fixture tests.
- Worker escape/egress review and cloud IAM audit.
- Budget concurrency, cancellation, reconciliation, and idempotency tests.
- Secret scanning/log redaction tests.
- Dependency/SBOM and container scanning.
- Firewall bypass, provenance tampering, false-status, and misleading-UI tests.
- Independent security review for billing, BYOK, WebMCP/MCP, and BYOC/HPC milestones.

This is an initial model; maintain it as architecture and deployment evolve.
