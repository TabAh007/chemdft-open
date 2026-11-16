# Ownership, Roles and Project Authorization (PF-2)

**Status**: implemented in the working tree, pre-launch. Builds on `AUTH_ARCHITECTURE.md` (PF-1). No real legacy project has been claimed; the real development database was migrated (schema only) after a rehearsal on a copy.

**Hard rule: access ownership is not scientific provenance.** A claim changes which organization a project belongs to and who may *access* it. It never rewrites `created_by`, `submitted_by`, producers, audit rows, imported-file attribution or any scientific record, and there is no `projects.owner_user_id`: access is `project_members` inside the project's organization.

## 0. What `projects.organization_id` means (decided from the code, PF-2.1)

**Conclusion: (A) it is the project's CURRENT tenant, access and billing organization.** It is not historical provenance, and it does not mix the two. Evidence:

| Where it is used | What it shows |
|---|---|
| `authorize_project_access`, `list_projects`, `/v1/me` project count (`actions.in_active_organization`) | tenant/access boundary: the caller's active organization must equal it |
| `UNIQUE (organization_id, slug)` on `projects` | the project's slug namespace is its current organization |
| compute usage: workers act as a `ServiceIdentity` whose organization is copied from the project (PF-0), and `BillingService.record_compute_usage` charges the `BillingAccount` of `identity.organization_id` | compute is billed to the project's organization |
| AI usage and managed-AI authorization: `BillingService(..., caller identity)` | billed to the caller's organization, which authorization forces to equal the project's |
| `scientific_actions` result-acceptance audit event (`organization_id=project.organization_id`) | an audit row records the organization *at that moment* |
| `AuditEventRecord.organization_id`, `ToolInvocationRecordRow.organization_id` (the actor's active organization at the time) and now `ownership_events.source/destination_organization_id` | **historical organization attribution lives in append-only event rows, not in the project** |
| Tables carrying `organization_id` | only `memberships`, `projects`, `billing_accounts`, `audit_events`, `tool_invocations`, `ownership_events`. No compute, ledger, artifact, provenance, calculation or result table does |
| Cross-organization sharing | nothing implements it; PF-1 documented that a membership in another organization grants nothing, and billing, audit and service attribution all assume project organization = acting organization |

Consequence: PF-2's first design (a `LEGACY_LOCAL` project reached through a cross-organization membership) was **removed**. It contradicted the model above and would have charged a claimed project's compute to the legacy organization's billing account while the claimant's AI usage went to their own (a test proves the corrected behavior). A project now changes organization only by an audited re-home.

## 1. Project kinds (`projects.kind`, migration `0023_legacy_ownership`)

| Kind | Meaning | Claimable | Reachable by a human |
|---|---|---|---|
| `NORMAL` (default) | a user's own project; belongs to that user's organization | no (a claimed legacy project becomes this) | owner/editor/viewer through `project_members`, and only while the project's organization is the caller's active one |
| `LEGACY_LOCAL` | created before real accounts under the fixed development identity; lives in the legacy organization | **yes**, by an authorized administrator: the claim re-homes it to the claimant's personal organization, after which it is `NORMAL` | only the legacy identity until claimed; afterwards its new owner, like any normal project |
| `ACCEPTANCE_FROZEN` | regression / acceptance reference project | **never** | never (no human membership can be created; an inserted row is ignored by the authorization query) |

`EXAMPLE_TEMPLATE` is intentionally absent until the examples work (PF-5); `SYSTEM` was not needed.

### How the 12 existing projects were classified (evidence, not names)

Rule applied by the migration: every project of the legacy organization becomes `LEGACY_LOCAL`; those named by the repository's acceptance records or regression tests become `ACCEPTANCE_FROZEN`. On any other database the ids do not exist and the labelling is a no-op.

| Project (id prefix) | Kind | Evidence |
|---|---|---|
| `f39aefcf` Water (USER_SUPPLIED) | ACCEPTANCE_FROZEN | Project memory §13.1 (accepted reference), IR/Raman/thermochemistry/electronic-fields acceptance records, renderer benchmark tool |
| `7ae7e41b` Chromium CVD paper | ACCEPTANCE_FROZEN | Project memory §13.2 |
| `3537048e` Electronic structure acceptance — water | ACCEPTANCE_FROZEN | `unified-visualization-acceptance.spec.ts` (`LEGACY_WATER_ID`) |
| `85130614` test-user-supplied-water | ACCEPTANCE_FROZEN | same spec (`TEST_WATER_ID`) |
| `3606543b` Phase 7 Local Walkthrough | ACCEPTANCE_FROZEN | `pre-merge-fixes.spec.ts` (`PHASE7_PROJECT_ID`) |
| `70d5fc2d` External Import V1 — visual acceptance | ACCEPTANCE_FROZEN | created by the External Import visual acceptance run; holds its 4 external imports |
| `1`, Phase 7 review, Phase7Acceptance, P7Debug, P7Debug2, Phase7AcceptanceFinal | LEGACY_LOCAL | not referenced by any acceptance record or test; development leftovers |

**Operator review required before any real claim:** `Phase7Acceptance` (`p7accept`) and `Phase7AcceptanceFinal` (`p7final`) have "acceptance" in their names but no acceptance record, document or test refers to them, so they are **not** frozen (a name is not evidence) and stay `LEGACY_LOCAL`. `list-legacy` flags any claimable project whose name looks like reference data (`OPERATOR REVIEW REQUIRED`); this is a hint for the operator, never a classification. If you decide they are reference data, reclassify them through a reviewed migration before claiming anything; over-protecting is always the safe direction.

## 2. The claim (operator CLI only, never an HTTP route)

```bash
CHEMDFT_BOOTSTRAP_ADMIN_EMAILS=admin@example.org \
python -m chemdft_api.ownership_cli list-legacy            # read-only inventory (+ review hints)
python -m chemdft_api.ownership_cli claim --actor-email admin@example.org --project <id> \
    --destination-organization <personal-org-id> --reason "…" --idempotency-key <key>
```

**What a claim does, in one transaction:** sets `projects.organization_id` to the destination personal organization (and `projects.kind` `LEGACY_LOCAL` → `NORMAL`), gives that organization's single owner the `OWNER` membership, deletes the project's other (legacy-context) membership rows, and appends the ownership events. `project_members` is **current effective access state** (audit of every use: it is only ever read as the access join in `authorize_project_access`, `list_projects` and `/v1/me`, written when a project is created or claimed, and documented as "project-specific role and permissions"; there is no active/inactive or history concept), so a row saying someone is `OWNER` who can no longer reach the project would mislead. Removal is scoped to the claimed project: the legacy user itself, its memberships on every other legacy project, and all historical attribution (`created_by` etc.) stay. Each removed membership is preserved as a `MEMBERSHIP_REMOVED` event (subject = the removed user, `previous_role` = the role it held, `new_role` empty, source = legacy organization, destination = new organization, same reason, key `<claim key>:removed:<user id>`), next to the `LEGACY_CLAIM_GRANTED` event (subject = new owner, `previous_role` = any role it already held, `new_role` = owner). Nothing else is touched: not `created_by`, `submitted_by`, producers, calculations, results, artifacts, provenance, audit events or billing rows (a whole-database snapshot test and the rehearsal prove that only `projects`, `project_members` and `ownership_events` change, and `projects` only in `organization_id`, `kind` and `updated_at`).

**Requirements:** a configured bootstrap administrator; an exact project id of kind `LEGACY_LOCAL`; an explicit destination **personal** organization whose single owner is an active HUMAN account; a reason; an idempotency key. **Refused, writing nothing:** frozen projects (never re-homed), normal or unknown projects, non-personal or invalid destinations, disabled users, SERVICE and LEGACY_LOCAL principals, every non-administrator, and a destination that already has a project with the same slug (`destination_slug_conflict`; the project is not renamed).

**Atomicity.** Every write happens in one transaction; any exception rolls the session back before it propagates. The membership deletes, the new owner row and all events are part of that same transaction. Tests inject a failure at the project re-home, the legacy membership removal, the destination owner membership creation, the first event insert and the claim-event insert (after every other write was flushed), and require the whole database to be identical afterwards, then require the same claim to succeed completely once the fault is removed.

**Idempotency.** The same key and request returns the original event; the same key with a different request is refused (`idempotency_key_conflict`); a new key for a project already in the destination with the owner membership is a no-op without further events or memberships; a project already claimed cannot be re-homed again (`project_not_claimable`).

**Billing and organization attribution after a claim.** Compute is charged to the project's organization and AI to the caller's; re-homing keeps them equal, both going to the claimant's organization. A test shows the compute worker's identity for a claimed project resolving to the claimant's billing account instead of the legacy one. Usage recorded before the claim stays on the legacy organization's account (history is not rewritten). Allowances, entitlements and BYOK credentials are keyed by billing account = organization, so they follow the project with no special case; no Phase 11 behavior was added.

## 3. Bootstrap administrator

`CHEMDFT_BOOTSTRAP_ADMIN_EMAILS` (comma-separated exact emails). No default, no "first user", no domain or prefix matching. The matching account must be a HUMAN user, not disabled, with a mapped identity (it has actually signed in). SERVICE and LEGACY_LOCAL principals can never administer, even if their email is listed. Hosted deployments must set it explicitly; empty means nobody can run an ownership operation.

**Post-launch governance (planned, not built).** The email list is a pre-launch stopgap held in deployment configuration. It should be replaced by a database-backed administrative capability granted through its own audited ownership event, with two-person approval for claims of non-owned data, and the CLI replaced by an admin surface. Until then every operation is attributable (`actor_user_id`) and reversible only by a new event.

## 4. Ownership events (`ownership_events`)

Append-only (ORM rejects update/delete; no API exposes the table; the FK to `projects` has no cascade). Columns: id, project, `event_type` (closed vocabulary: `LEGACY_CLAIM_GRANTED`, `MEMBERSHIP_REMOVED`; the existing `String(32)` column holds it, so no migration was needed), actor, subject, source organization, destination organization, previous role, new role, reason (≤500 chars), unique idempotency key, timestamp. No secrets. Project copy events arrive with the examples work. `source_organization_id` and `destination_organization_id` are how a project's organizational history is reconstructed.

## 5. Role matrix (`project_access.py`, the only place roles are interpreted)

| Capability | owner | editor | viewer |
|---|---|---|---|
| `read` (see the project and its records) | ✓ | ✓ | ✓ |
| `write` (imports, uploads, calculations, spectrum processing and comparison, investigations, approvals, AI conversations/messages/runs, project memory, knowledge reindex) | ✓ | ✓ | ✗ |
| `manage` (membership, rename, archive) | ✓ | ✗ | ✗ |

Findings from the audit: the API has **no** rename, delete, archive or member-management route and no PATCH/DELETE route at all, so no route needs `manage`; **owner and editor are behaviourally identical** on every current route (a test asserts it). `manage` is reserved for the ownership operations. Before PF-2 the owner/editor rule was copied into ~28 call sites; it is now `can(member, ProjectCapability.WRITE)` everywhere, and a test fails if any module compares roles itself. Service principals use the same mapping through their grant role (PF-0).

**Gaps closed.** The audit found four project-scoped writes with no write check, so a viewer could create project memory, create AI conversations, resume AI runs and trigger knowledge reindexing. All four now require `write`.

## 6. Failure policy (enumeration resistance)

* **Not a member / project in another organization / unknown project → `404`**, identical to a missing project. 84 of 90 project routes answer an outsider with 404; 5 answer `422` (request-body validation runs before authorization and reveals nothing); never a 2xx and never a 403.
* **A member without the capability → `403`.** A member may know the project exists.
* **A resource id that belongs to a different project → `404`**, the same as a missing resource (tested across 17 routes and 4 directions, for the same user's two projects and for two users). Two places previously answered `403 "references cannot cross project boundaries"` and thereby confirmed that the id exists elsewhere (`GET /calculations/{id}` and the structure-version id of a calculation submission); both now answer 404. The remaining `CrossProjectReference` raises are internal consistency checks on records the caller already named.

## 7. Route authorization matrix

`services/api/tests/route_authorization_matrix.py` classifies **every** route (104 method-routes over 95 paths: 90 project-scoped = 41 `READ` + 49 `WRITE`, 2 approval-gated; 14 others = 5 public, 1 public-signed webhook, 3 user, 5 org-member billing). `test_route_authorization.py` fails when a route is added or removed without updating it, and audits all 90 project routes as owner, editor, viewer and outsider with bodies generated from each route's own schema (`route_audit.py`; the hook `project_access.AUDIT_LOG` records which capability decisions a request consulted).

Proof strength for the 49 write routes: **all 49 proven by behaviour** (a viewer's request reached the central check and was denied). The six routes that need schema-valid bodies (`graph-digitizations`, `xrd-digitizations`, `experimental/imports`, `structure-candidates/{id}/representations`, `…/representations/imports`, `structures/versions`) now receive valid fixtures built from the shapes the existing tests use, plus one real structure version. `SOURCE_EVIDENCE_ONLY` is empty, and a route may only be added to it with a reason. The 41 read routes were verified to admit all three roles.

Open / ambiguous: billing and BYOK routes (`ORG_MEMBER`) have no owner-only distinction (harmless while every organization is one person's personal organization; revisit with shared organizations). The malformed-input crashes found by the audit are fixed (below) and `KNOWN_UNHANDLED` is empty.

### Malformed uploads (fixed in PF-2.1, error boundary only)

| Input | Before | After |
|---|---|---|
| `POST /experimental/imports`, invalid form value (e.g. unknown modality) | uncaught pydantic `ValidationError` → 500 | `422` in the standard request-validation shape, nothing stored |
| `POST /structures/imports`, malformed CIF | uncaught `ValueError` from pymatgen → 500 | `422 "CIF could not be parsed as a crystal structure."` (no parser detail echoed), nothing stored |
| `POST /structures/imports`, out-of-range `file_format` / `idempotency_key` | raw file and artifact stored, **then** uncaught `ValidationError` → 500 | `422` before anything is stored |

Valid inputs are unchanged, and malformed scientific data is neither repaired nor interpreted.

## 8. Frozen acceptance project protection

`ACCEPTANCE_FROZEN` projects: never claimable and never re-homed (CLI and service refuse before any write), never gain a human member (the authorization query ignores an inserted row), remain in the legacy organization, are not listed to any real account, and are not offered as examples. Humans cannot rename/delete them (no such routes exist), change membership (no route; CLI refuses) or mutate their records (no access). The legacy local identity keeps today's access, so existing regression tests and internal workflows are unchanged.

## 9. Temporary example behaviour

The empty-projects screen's Water and Chromium demos open frozen acceptance projects. For a real (jwt) user they are replaced by an "examples are not available yet" notice; local dev mode is unchanged. PF-5 replaces them with sealed `EXAMPLE_TEMPLATE` copies.

## 10. Migration and rehearsal process (and what was done)

1. Inspect the chain (linear: …`0020` → `0021` → `0022` → `0023`, one head). 2. Back up (`sqlite3 .backup`). 3. Record counts and content hashes. 4. Rehearse upgrade, downgrade and re-upgrade on a **copy**. 5. Rehearse the claim, repeats, refusals, rollback and access on a copy. 6. Only then migrate the real database (schema only).

* **`0023_legacy_ownership`** (kind column + `ownership_events`): rehearsed upgrade, downgrade and re-upgrade on a copy (identical invariants), then applied to the real database (backup `.chemdft/chemdft.db.pre-0023-pf2.bak`).
* **PF-2.1 needed no new migration**: re-homing uses existing columns (`projects.organization_id`, `projects.kind`) and the existing `ownership_events` table (the removed-membership event reuses `subject_user_id`, `previous_role`, `new_role`).
* **Claim rehearsal on a fresh copy of the real database** (6 claimable and 6 frozen projects, two test accounts): rollback injected at the event insert, the membership insert, the membership delete and the project update left the database identical each time; one claim re-homed the project (`LEGACY_LOCAL` → `NORMAL`, organization = the admin's personal organization, `created_by` unchanged, event source = the legacy organization); a repeat with the same key and one with a new key changed nothing; re-claiming to another organization, a non-administrator and an unknown actor were refused; all 6 frozen projects were refused and their rows unchanged; the claimed project's `project_members` then held only the admin as owner, the removal and claim events were both recorded (source = legacy organization, previous role `owner`), the legacy user and its 11 memberships on other projects remained, the admin reaches the project while the legacy identity and another human get 404, and the legacy identity still reaches the other legacy projects; only `projects`, `project_members` and `ownership_events` changed.
* **The real database** was never claimed against: 12 projects, 12 members (the legacy owner only), 0 ownership events, all counts and content hashes identical.
