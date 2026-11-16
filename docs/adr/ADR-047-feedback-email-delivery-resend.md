# ADR-047: Feedback Email Delivery via Resend REST API

- **Status:** Selected and implemented (code merged in 0.0.31); NOT yet executed against the live provider; NOT verified end-to-end.
- **Date:** 2026-11-10
- **Scope:** In-app feedback reports (`apps/web`, Release 0.0.31).
- **Consulted:** `docs/TECHNOLOGY_REGISTRY.md` (Index and line 1027), `docs/implementation/EMAIL_DELIVERY_DESIGN.md`, `docs/15_ENGINEERING_RULES.md` (Rule 12, Rule 23).

---

## Context

ChemDFT 0.0.31 introduces an in-app feedback channel allowing signed-in researchers to report bugs, suggest features, and request calculation methods directly to the engineering team. Every submission must be emailed to the owner at `tab@chemdft.com` with file attachments up to 4 MB in total. Uploaded files must never be stored on ChemDFT servers or in databases.

Per permanent engineering rules and owner decisions:
1. **No IAM changes:** The owner decision recorded 2026-10-28 (DECISIONS.md) strictly forbids IAM modifications.
2. **Serverless runtime:** The web application runs on Vercel serverless functions, external to AWS EC2.
3. **No heavy SDKs without justification:** Simple HTTPS REST APIs using native `fetch` are preferred over heavy vendor SDK dependencies.
4. **Honest status reporting:** Evaluated figures must derive from verified official documentation without guessing.

---

## Evaluation of Candidate Providers

Official documentation was evaluated for three candidate transactional email services on 2026-11-10:

### 1. Resend (Selected)
- **Official Docs & URLs:** [https://resend.com/pricing](https://resend.com/pricing), [https://resend.com/docs/api-reference/emails/send-email](https://resend.com/docs/api-reference/emails/send-email)
- **Free Tier:** 3,000 emails per month, 100 emails per day, 1 custom domain. This provides an effective natural brake against spam while comfortably covering beta feedback volume.
- **Attachment Size Limit:** 40 MB total payload ceiling (including Base64-encoded attachment content). Our 4 MB attachment cap fits well within this limit with ample overhead.
- **API Shape & Dependency:** Simple REST API over HTTPS (`POST https://api.resend.com/emails`) with Bearer token authentication in the `Authorization` header. Native Node `fetch` handles the JSON payload directly; **zero npm dependencies added**.
- **Credentials & IAM:** Configured solely via an API key (`RESEND_API_KEY`) in Vercel environment variables. **Zero AWS IAM changes**, perfectly honoring the owner's constraint.
- **Domain Verification:** Standard DNS records (DKIM CNAME/TXT, SPF TXT, DMARC TXT) on `chemdft.com`.
- **Terms & DPA:** Non-commercial and commercial SaaS usage permitted; standard GDPR Data Processing Addendum (DPA) available.

### 2. Postmark
- **Official Docs & URLs:** [https://postmarkapp.com/pricing](https://postmarkapp.com/pricing), [https://postmarkapp.com/developer/user-guide/send-email-with-api](https://postmarkapp.com/developer/user-guide/send-email-with-api)
- **Free Tier:** Developer tier offers only **100 total emails per month** across the entire account (no recurring daily free volume). Once 100 emails are consumed, sending hard-stops until paid upgrade ($15/mo for 10,000 emails).
- **Attachment Size Limit:** Strict 10 MB total message limit (including Base64 expansion ~33-40%).
- **Evaluation:** The 100 emails/month developer tier is insufficient for active beta usage, necessitating immediate paid commitment.

### 3. Amazon SES (Simple Email Service)
- **Official Docs & URLs:** [https://aws.amazon.com/ses/pricing/](https://aws.amazon.com/ses/pricing/), [https://docs.aws.amazon.com/ses/latest/dg/welcome.html](https://docs.aws.amazon.com/ses/latest/dg/welcome.html)
- **Free Tier:** 6,250 emails/month is restricted exclusively to requests originating within Amazon EC2. From Vercel serverless (outside AWS), pricing is $0.10 per 1,000 emails from the very first email.
- **Crucial Blocker (IAM):** Sending from external Vercel serverless functions requires either an IAM user with SES access keys or SES SMTP credentials. Creating or managing IAM users/policies is explicitly forbidden by the owner decision (DECISIONS.md, 2026-10-28). Root access keys are strictly prohibited for application operations.
- **Production Sandbox:** New accounts are locked in SES Sandbox (200 emails/day, 1 email/sec, sending only to pre-verified recipient emails) requiring a formal production access support request with manual review.

---

## Decision

**Resend** is selected as the email delivery provider for ChemDFT feedback reports.

1. **Zero IAM changes required:** Authenticates via `RESEND_API_KEY` stored directly in Vercel project environment variables.
2. **Generous free allowance:** 3,000 emails/month (100 emails/day cap acts as a safety guardrail).
3. **High attachment ceiling:** 40 MB max payload easily supports ChemDFT's 4 MB total attachment limit.
4. **Lightweight integration:** Communicates via standard HTTPS `fetch` in `apps/web/src/lib/feedback/mailer.ts` without introducing third-party client library bloat.
5. **Provider-neutral architecture:** The `FeedbackMailer` interface abstracts the transport so alternative providers can be swapped in future releases without touching business or route logic.

---

## Verification & Status

- **Implemented:** Provider-neutral `FeedbackMailer` interface and `ResendFeedbackMailer` implemented in `apps/web/src/lib/feedback/mailer.ts`.
- **Offline testing:** Unit tests run exclusively against `FakeFeedbackMailer` (in-memory transport). No real emails are sent during automated testing.
- **Not yet executed:** Live execution against `api.resend.com` has NOT been performed.
- **Not verified end-to-end:** Live domain verification of `chemdft.com` and initial live delivery to `tab@chemdft.com` are architect operational steps performed after PR merge.
