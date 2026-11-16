# Legal Text Verification & Fact Mapping — Release 0.0.32

**Plain-language beta text, not legal advice; lawyer review before 0.1.0 or any investment.**

This document records the exact factual statements contained in the beta Terms of Use, Privacy Policy, and Beta Notice published in ChemDFT Release 0.0.32 (`apps/web/src/app/_components/public-doc/legal-views.tsx`), maps each statement to repository evidence, and itemizes open legal questions for the owner and legal counsel.

---

## 1. Terms of Use: Factual Statements & Repo Evidence

| Statement in Terms | Repo Evidence & File Reference | Status |
|---|---|---|
| **Operator Identity:** Operated by Tabriz Ahmadli, an individual (not a company) in Azerbaijan. Contact: `tab@chemdft.com`, website: `chemdft.com`. | `apps/web/src/content/legal.ts` (line 2: `SUPPORT_EMAIL = "tab@chemdft.com"`), `.zenodo.json` (line 9: `"name": "Ahmadli, Tabriz"`), `CITATION.cff` (line 17: `family-names: Ahmadli`). | VERIFIED |
| **Beta Service & Single Operator:** Free beta for research and education, operated by one person. Access may be limited by a beta cap, changed, suspended or ended. | `apps/web/src/lib/auth/config.ts` (beta user cap `CHEMDFT_BETA_USER_CAP=20`), `NEXT.md` (Google signup Option B), `apps/web/src/lib/auth/server.ts` (deterministic post-create user pruning for cap enforcement). | VERIFIED |
| **Eligibility & Age (13+):** Minimum age 13; under 18 with parent/teacher/guardian permission; classroom use welcome. | `apps/web/src/app/[locale]/signup/signup-form.tsx` (line 51: "I am at least 13 and accept..."). | VERIFIED in code |
| **Acceptable Use:** Lawful research; no uploading unauthorized or third-party personal data; no bypassing quotas/caps; no disposable emails; no compute resale. | `apps/web/src/lib/auth/signup-policy.ts` (lines 14–25: disposable email blocklist, rate limiting); `services/api/src/chemdft_api/account_policy.py` (quota enforcement). | VERIFIED |
| **Content Ownership:** Users keep ownership and copyright of molecules, uploaded files, projects, and calculation results. ChemDFT uses them solely to run the service (store, compute, display, export). No data sales, no advertising, no training AI on user projects. | `docs/02_SCIENTIFIC_INTEGRITY.md` (lines 84–99: researchers retain ownership; ChemDFT receives software attribution, never automatic authorship); `services/api/src/chemdft_api/account_service.py` (project export & isolation). | VERIFIED |
| **Open Source Licensing:** Engines and schemas licensed separately under open-core terms (Apache-2.0 for schemas/contracts/wrappers). | `REUSE.toml`, `apps/web/src/app/_components/public-doc/license-view.tsx`, `docs/implementation/RELEASES_AND_LICENSE.md`. | VERIFIED |
| **Scientific Results as Research Aid:** Results produced by third-party computational engines (PySCF, xTB); user must independently check before relying/publishing; provided "as is" without warranty; limited liability. | `docs/02_SCIENTIFIC_INTEGRITY.md` (Result Firewall rules; REAL SCIENCE ONLY); `apps/web/src/content/releases.ts` (scientific status honest reporting). | VERIFIED |
| **Account Deletion:** Users can delete their accounts anytime in Settings → General. | `apps/web/src/app/api/account/delete/route.ts` (line 14), `services/api/src/chemdft_api/account_service.py` (line 156: `delete_account`). | VERIFIED |
| **Governing Law:** Governed by the laws of the Republic of Azerbaijan. | Proposed text in UI; marked below as an open item for formal lawyer/owner confirmation. | OPEN ITEM (Owner/Lawyer to confirm) |

---

## 2. Privacy Policy: Factual Statements & Repo Evidence

| Statement in Privacy Policy | Repo Evidence & File Reference | Status |
|---|---|---|
| **Account Data Stored:** Account ID, email, display name, profile image (if Google provides), signup source (`"self"` for beta users), terms version (`"2026-11-10"`), and acceptance timestamp. | `apps/web/src/lib/auth/server.ts` (lines 95–102: `additionalFields` `signupSource`, `termsVersion`, `termsAcceptedAt`, `termsAccepted`), `apps/web/src/lib/auth/signup-policy.ts` (`TERMS_VERSION = "2026-11-10"`). | VERIFIED |
| **Scientific Data Stored:** Projects, molecular structures, uploaded files (XYZ, CIF, PDB, etc.), calculation jobs, results, provenance records. | `services/api/src/chemdft_api/scientific_models.py`, `services/api/src/chemdft_api/models.py` (Project, Calculation, StructureVersion, StoredFile). | VERIFIED |
| **Feedback Reports:** Account ID, email, type, title, details, attachment count and byte size, page path, app version, language, user agent. Text and report metadata stored in auth DB until account deletion. Attached files NOT stored on ChemDFT servers or databases; emailed directly to team mailbox via Resend. | `apps/web/src/lib/feedback/db.ts` (lines 75–94: `feedback_report` table schema), `apps/web/src/lib/feedback/service.ts` (memory streaming, zero file bytes in DB), `apps/web/src/lib/feedback/mailer.ts` (Resend HTTPS transport). | VERIFIED |
| **Operational & Security Records:** Session records, IP address and user-agent headers for rate-limiting. Hashed email reference in signup attempt logs. Internal account IDs on audit events. | `apps/web/src/lib/auth/signup-policy.ts` (line 42: `hashRef(email)` via SHA-256), `services/api/src/chemdft_api/audit.py` (internal user IDs only). | VERIFIED |
| **ORCID Data:** Authenticated ORCID iD and optional name if linked; zero ORCID access tokens stored. | `apps/web/src/lib/auth/orcid-plugin.ts` (stores only iD and authenticated name; does not persist OAuth access token), `services/api/src/chemdft_api/orcid_models.py`. | VERIFIED |
| **No Advertising or Trackers:** Zero third-party analytics or advertising trackers; no data broker sales. | Confirmed across `apps/web`: zero Google Analytics, Meta Pixel, PostHog, or tracking SDKs installed in `apps/web/package.json`. | VERIFIED |
| **Hosting Locations:** Web frontend on Vercel; auth database on Neon PostgreSQL in AWS us-east-1; backend API, Postgres DB, S3 storage, and EC2 worker on AWS us-east-1. | `docs/implementation/AUTH_ARCHITECTURE.md` (sections 4 & 5), `infra/aws/backend/` (AL2023 EC2, RDS/PostgreSQL, S3 bucket in us-east-1). | VERIFIED |
| **Sub-Processors:** Google (OAuth), Vercel (web host), Neon (auth DB), AWS (backend host/storage/compute), Resend (feedback email), ORCID (optional authentication). | `AUTH_ARCHITECTURE.md` (sections 5, 10, 13), `docs/adr/ADR-047-feedback-email-delivery-resend.md`. | VERIFIED |
| **AI Model Providers:** Only active if AI Scientist is enabled for that account. Disabled by default for new accounts (`CHEMDFT_AI_FOR_NEW_USERS=false`). Providers: NVIDIA (hosted models) or Moonshot AI (Kimi). | `services/api/src/chemdft_api/config.py` (line `ai_for_new_users: bool = False`), `services/api/src/chemdft_api/ai/model_gateway.py`. | VERIFIED |
| **Cookies:** Essential HttpOnly session cookie (`better-auth.session_token` / `__Secure-`), terms cookie (`chemdft_terms_accepted=true`, max-age 600s), ORCID binding cookies (`chemdft_orcid_binding`, `chemdft_orcid_next`). No analytics/ad cookies. | `apps/web/src/lib/auth/config.ts` (line 57), `apps/web/src/app/[locale]/login/login-form.tsx` (line 90), `apps/web/src/lib/auth/orcid-plugin.ts` (lines 60–62). | VERIFIED |
| **Data Export:** Settings → General → Download yields ZIP archive of JSON files of own data. | `services/api/src/chemdft_api/account_service.py` (line 35: `export_account_data`). | VERIFIED |
| **Account Deletion Flow:** Cancels running jobs in owned projects; purges owned unshared project content; renames project to "Deleted project" with slug `deleted-<id>`; deletes S3 objects; deletes project memberships; deletes AI preferences, BYOK credentials, and ORCID links; renames personal org to "Deleted workspace"; anonymises user row (`deleted-<id>@deleted.invalid`); deletes auth database feedback rows; deletes Better Auth user, sessions, and accounts. | `services/api/src/chemdft_api/account_service.py` (lines 156–227: `delete_account`), `apps/web/src/app/api/account/delete/route.ts` (lines 14–35). | VERIFIED |
| **Backup Retention:** Daily PostgreSQL dumps in AWS S3 expire after 30 days. | `infra/aws/backend/RUNBOOK.md` (lines 110, 301, 529: "Deployed dump retention is 30 days... PostgreSQL dumps expire after 30 days in the template"). | VERIFIED |
| **Mailbox Feedback Deletion:** Feedback delivered to `tab@chemdft.com` is outside the application DB; users contact `tab@chemdft.com` for manual mailbox removal. | Verified: Resend transmits emails to external mailbox; no DB delete can touch delivered emails in a standard email client. | VERIFIED |
| **User Access/Correction/Deletion Rights:** Users can contact `tab@chemdft.com` to access, rectify, or erase personal data. | Contact channel `tab@chemdft.com` monitored by operator Tabriz Ahmadli. | VERIFIED |

---

## 3. Terms Versioning & Non-Disruption for Existing Users

- **Version Bump:** `TERMS_VERSION` in `apps/web/src/lib/auth/signup-policy.ts` and `LEGAL_VERSION` in `apps/web/src/content/legal.ts` were bumped from `"2026-11-03-draft"` to `"2026-11-10"`.
- **Sign-up Usage:** The constant is read exclusively upon new user creation (`user.create.before` and `user.create.after` in `apps/web/src/lib/auth/server.ts`). Newly registered users will have `termsVersion: "2026-11-10"` saved in `public."user"`.
- **Existing User Impact:**
  - Neither Better Auth nor the FastAPI backend enforces a runtime check comparing existing session `termsVersion` against the current constant.
  - Existing users (owner `contact@example.org`, test user `owner@gmail.com`) maintain valid sessions and will NOT be forced to re-accept terms on subsequent logins.
  - No existing database row is mutated; no schema migrations are required.
  - Nothing breaks for existing accounts.

---

## 4. Open Items for Owner and Legal Counsel Review

Prior to public launch (Release 0.1.0) or commercialization/investment, the following open policy items must be reviewed and resolved by a qualified legal professional:

1. **Governing Law and Dispute Venue:**
   - *Current Proposal:* "These Terms are governed by the laws of the Republic of Azerbaijan."
   - *Action for Lawyer:* Confirm jurisdiction and dispute resolution forum (arbitration vs courts of Baku).
2. **Sub-Processor Agreements (DPAs):**
   - *Current Reality:* Data Processing Addenda (DPAs) are available from Vercel, AWS, Google, and Resend.
   - *Action for Owner:* Ensure standard DPAs are formally countersigned or acknowledged in respective vendor accounts.
3. **Age Requirement Phrasing (13+ vs COPPA/GDPR-K):**
   - *Current Proposal:* Minimum age 13; parental/guardian consent requested under 18; school/classroom usage welcomed.
   - *Action for Lawyer:* Verify that 13+ standard complies with international child safety standards given that no date of birth or age verification gates exist.
4. **Data Retention Specifications:**
   - *Current Reality:* DB backups persist for 30 days; account data deleted upon request; operational audit logs persist indefinitely without personal names/emails.
   - *Action for Lawyer:* Confirm audit event pseudonymization satisfies legal retention and erasure compliance.
