# Legal Text Verification & Fact Mapping — Release 0.0.35

**Plain-language beta text, not legal advice; lawyer review before 0.1.0 or any investment.**

This document records the exact factual statements contained in the beta Terms of Use, Privacy Policy, and Contact Form published in ChemDFT Release 0.0.35 (`apps/web/src/app/_components/public-doc/legal-views.tsx`, `apps/web/src/app/[locale]/contact/page.tsx`), maps each statement to repository evidence, and itemizes open legal questions for the owner and legal counsel.

---

## 1. Contact Form: Factual Statements & Repo Evidence

| Statement in Privacy Policy / Contact Form | Repo Evidence & File Reference | Status |
|---|---|---|
| **What is collected:** Name, email address, organisation (if given), selected topic, message text, and technical HMAC-SHA256 hashed network identifier (IP). | `apps/web/src/lib/contact/service.ts` (`submitContactMessage`), `apps/web/src/lib/contact/crypto.ts` (`hashClientIp`). | VERIFIED |
| **Purpose:** To answer incoming communications and prevent automated spam abuse. | `apps/web/src/app/[locale]/contact/page.tsx`, `apps/web/src/lib/contact/service.ts`. | VERIFIED |
| **Who sees it:** The operator (Tabriz Ahmadli, `tab@chemdft.com`). Delivery by Resend HTTPS API. Abuse prevention by Cloudflare Turnstile. | `apps/web/src/lib/contact/service.ts` (`toEmail = env.CHEMDFT_CONTACT_TO || "tab@chemdft.com"`), `apps/web/src/lib/contact/turnstile.ts`. | VERIFIED |
| **Retention:** Message emails kept in operator mailbox up to 12 months unless conversation continues. Technical rate-limiting database record (zero PII, zero message text) purged after 90 days. | `apps/web/src/lib/contact/types.ts` (`RETENTION_DAYS = 90`), `apps/web/src/lib/contact/db.ts` (`purgeOldContactMessages`). | VERIFIED |
| **User Rights:** Users can access, correct, or request deletion of communications by emailing `tab@chemdft.com`. | `apps/web/src/app/_components/public-doc/legal-views.tsx` (PrivacyView: Contact section). | VERIFIED |
| **Sub-Processors:** Added Cloudflare Turnstile (abuse protection) and extended Resend (transactional email for both feedback and contact form). | `apps/web/src/app/_components/public-doc/legal-views.tsx` (Where data lives and sub-processors). | VERIFIED |

---

## 2. Terms Versioning & Non-Disruption for Existing Users

- **Terms Version Constant:** `TERMS_VERSION` in `apps/web/src/lib/auth/signup-policy.ts` and `LEGAL_VERSION` in `apps/web/src/content/legal.ts` remain `"2026-11-10"`.
- **Rationale:** The Terms of Use agreement terms have not changed. Only the Privacy Policy was updated to describe the public contact form and add Cloudflare Turnstile to the sub-processor list.
- **Existing User Impact:**
  - Zero forced re-acceptance: existing users do NOT receive a prompt to re-accept terms upon login.
  - Active sessions remain uninterrupted.
  - No database migration or mutation of existing user rows.

---

## 3. Sub-Processor Registry Summary (0.0.35)

| Sub-Processor | Role / Function | Data Transmitted / Stored | Location |
|---|---|---|---|
| **Google** | OAuth authentication | Account ID, email, name, profile image URL | US |
| **Vercel** | Web frontend hosting & serverless compute | Transient HTTP request data, IP headers | Global / US |
| **Neon** | Managed PostgreSQL (authentication & tracking DB) | Better Auth accounts/sessions, `feedback_report`, `contact_message` (zero message text/PII) | AWS us-east-1 |
| **AWS** | Backend API, PostgreSQL, S3 storage, EC2 worker | Projects, calculation jobs, results, uploaded files, worker artifacts | AWS us-east-1 |
| **Resend** | Transactional email delivery | Feedback emails with attachments, contact emails | US |
| **Cloudflare** | Turnstile anti-abuse verification | Turnstile response token, client IP (for challenge verification) | Global / US |
| **ORCID** | Optional identity linking & citation attribution | Authenticated ORCID iD, display name | US |

