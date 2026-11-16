import Link from "next/link";

import { LEGAL_STATUS, LEGAL_UPDATED, LEGAL_VERSION, SUPPORT_EMAIL } from "../../../content/legal";
import styles from "./public-doc.module.css";

function LegalHeader({
  title,
  lead,
  summary,
  locale,
}: {
  title: string;
  lead: string;
  summary: string;
  locale: string;
}) {
  return (
    <header className={styles.head}>
      <h1>{title}</h1>
      <p className={styles.lead}>{lead}</p>
      <div className={styles.notice} data-testid="legal-draft-notice">
        <p style={{ margin: "0 0 6px", fontWeight: 600 }}>In short: {summary}</p>
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--cdf-ink-muted)" }}>
          {LEGAL_STATUS}. Last updated {LEGAL_UPDATED} (version {LEGAL_VERSION}). Contact:{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </div>
      {locale !== "en" && (
        <p className={styles.notice} style={{ marginTop: 10, fontSize: "0.875rem" }}>
          <strong>Notice:</strong> This document is provided in English. In the event of any conflict or inconsistency, the English version applies.
        </p>
      )}
    </header>
  );
}

export function BetaNoticeView({ locale }: { locale: string }) {
  return (
    <>
      <LegalHeader
        title="Beta notice"
        lead="What the ChemDFT beta means for you and your results."
        summary="ChemDFT is an early, free scientific beta run by one person. Features may change, quotas apply, and third-party calculation results must always be verified by the researcher."
        locale={locale}
      />
      <section className={styles.section} aria-labelledby="meaning">
        <h2 id="meaning">What “beta” means</h2>
        <ul className={styles.plain}>
          <li>Features change, and calculations, projects, or accounts can be reset or removed while we learn. Export your data from Settings whenever you want a local copy.</li>
          <li>Service can stop or change without notice. There is no uptime promise and no formal support SLA; write to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> for help.</li>
          <li>Each account has server-enforced quotas (calculations per day and month, concurrent jobs, projects, storage, and upload size) shown in Settings.</li>
          <li>The AI Scientist is disabled for new accounts by default during the beta. Molecular structures, 3D visualization, Ketcher 2D/3D drawing, and the calculations your quotas allow are available.</li>
          <li>Billing is not active; all available beta features are provided free of charge.</li>
        </ul>
      </section>
      <section className={styles.section} aria-labelledby="science">
        <h2 id="science">Scientific results</h2>
        <p>
          Numbers shown as calculated come from the named computational engine and version, run on the stated platform, and pass ChemDFT&apos;s Scientific Result Firewall checks. A result from one platform is not evidence for another.
          Always check anything you rely on before publishing, and cite both the underlying engine and ChemDFT. Read the <Link href={`/${locale}/releases`}>release notes</Link> for what has and has not been verified.
        </p>
      </section>
    </>
  );
}

export function TermsView({ locale }: { locale: string }) {
  return (
    <>
      <LegalHeader
        title="Terms of Use"
        lead="The rules for using the ChemDFT beta."
        summary="ChemDFT is a free beta for research and education operated by Tabriz Ahmadli. You own your molecules, files, and results. Computational results are a research aid from third-party engines and must be independently verified. We do not sell data or show ads."
        locale={locale}
      />
      <section className={styles.section} aria-labelledby="operator">
        <h2 id="operator">Operator and service</h2>
        <p>
          ChemDFT (chemdft.com) is operated by Tabriz Ahmadli, an individual (not a company) based in Azerbaijan. Legal and privacy contact: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> or through our <Link href={`/${locale}/contact`}>Contact form</Link>.
        </p>
        <p>
          ChemDFT is a free beta service for computational chemistry research and education, run by one person. Because this is a personal beta project, access may be limited by a beta user cap, changed, suspended, or ended at any time. Accounts may be disabled for misuse.
        </p>
      </section>
      <section className={styles.section} aria-labelledby="eligibility">
        <h2 id="eligibility">Eligibility and age</h2>
        <p>
          You must be at least 13 years old to use ChemDFT. If you are under 18, you should use ChemDFT with the permission and guidance of a parent, teacher, or guardian. School, university, and classroom use is welcome.
        </p>
      </section>
      <section className={styles.section} aria-labelledby="acceptable-use">
        <h2 id="acceptable-use">Acceptable use</h2>
        <ul className={styles.plain}>
          <li>Use ChemDFT for lawful scientific research and educational work.</li>
          <li>Do not upload molecules, files, or documents that you do not have the right to process, or personal data concerning other individuals.</li>
          <li>Do not attempt to access other accounts&apos; data, bypass access controls, circumvent user caps or computational quotas, or overload the infrastructure.</li>
          <li>Do not create accounts using temporary or disposable email addresses, or share an account among multiple individuals.</li>
          <li>Compute capacity is limited and funded privately by the operator: use it for genuine calculations, not benchmarking or resale. We may limit or disable accounts that violate these rules.</li>
        </ul>
      </section>
      <section className={styles.section} aria-labelledby="ownership">
        <h2 id="ownership">Your content and ownership</h2>
        <p>
          You keep full ownership of your molecules, uploaded files, projects, and calculation results. You grant ChemDFT permission to store, process, and display your content solely to run the service for you (including transmitting inputs to calculation engines on our servers, generating visualizations, and producing exports).
        </p>
        <p>
          ChemDFT does not sell your data, does not use your projects to train AI models, and shows no advertising.
          Open-source computational engines and schema libraries used by ChemDFT are licensed separately under their respective open-source licenses, as detailed on our <Link href={`/${locale}/license`}>License</Link> page.
        </p>
      </section>
      <section className={styles.section} aria-labelledby="warranty">
        <h2 id="warranty">No warranty, limited liability</h2>
        <p>
          Computational chemistry results produced by ChemDFT are a research and educational aid generated by third-party computational engines (such as PySCF and xTB). Users must check and validate all results before relying on them or publishing them.
        </p>
        <p>
          The service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; during the beta, without warranty of any kind, express or implied. The operator does not warrant that the service will be uninterrupted or error-free. To the extent permitted by applicable law, the operator is not liable for decisions made on results, lost data, research delays, or any indirect or consequential damages. You can export your data at any time from Settings.
        </p>
      </section>
      <section className={styles.section} aria-labelledby="termination">
        <h2 id="termination">Ending your account and governing law</h2>
        <p>
          You can delete your account at any time in Settings &rarr; General &rarr; Delete account. We may suspend or end accounts, or discontinue the beta service, at any time; where feasible, we will endeavor to give advance notice by email.
        </p>
        <p>
          These Terms are governed by the laws of the Republic of Azerbaijan.
        </p>
      </section>
    </>
  );
}

export function PrivacyView({ locale }: { locale: string }) {
  return (
    <>
      <LegalHeader
        title="Privacy Policy"
        lead="What ChemDFT collects, where your data lives, which sub-processors are used, and how to export or delete your information."
        summary="We collect only what is needed to authenticate you and run your calculations. We do not sell personal data, do not use tracking cookies, and do not show ads. Your scientific files stay yours and you can export or delete your account at any time."
        locale={locale}
      />
      <section className={styles.section} aria-labelledby="collection">
        <h2 id="collection">What we collect</h2>
        <ul className={styles.plain}>
          <li><strong>Account details:</strong> When you sign in with Google, we store your internal account ID, name, email address, profile image (if provided and stored), sign-up source (&ldquo;self&rdquo; for beta users), the terms version accepted, and the timestamp of acceptance.</li>
          <li><strong>Scientific data:</strong> Projects, molecular structures, uploaded files (e.g. XYZ, CIF, PDB, MOL, SDF), calculation requests, job configurations, results, and their provenance records.</li>
          <li><strong>Feedback reports:</strong> If you send feedback from within the app, we collect your account ID and email, category type, title, text details, attachment count and total size, current page path, app version, language, and browser user agent. Feedback text and report metadata are stored in the authentication database until account deletion. Attached files are never stored on ChemDFT servers or databases; they are transmitted directly via transactional email to the team mailbox at <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and remain only inside that mailbox.</li>
          <li><strong>Contact form messages:</strong> If you use our public contact form, we collect your name, email address, organisation (if provided), selected topic, message text, and a technical cryptographic hash of your client IP address (used strictly for rate limiting and abuse prevention). The purpose of collection is to answer your message and prevent spam abuse. Only the operator (Tabriz Ahmadli) sees your message. Emails are delivered via Resend over HTTPS; automated abuse protection is provided by Cloudflare Turnstile. Message emails are kept in the operator mailbox for up to 12 months unless an active conversation continues. The technical rate-limiting database record (which contains zero message text or personal data, storing only the hashed network identifier and status) is deleted after 90 days. You may request deletion or a copy of your contact communications at any time by emailing <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</li>
          <li><strong>Operational and security records:</strong> Session tokens, IP address, and browser user agent used strictly for authentication, abuse prevention, and rate-limiting. Logs of sign-up attempts record only a cryptographically hashed reference to email addresses. Audit events record internal account IDs without personal names or emails.</li>
          <li><strong>ORCID:</strong> Only if you choose to link an ORCID iD in Settings: we store your authenticated ORCID iD and (if ticked) display name. We store no ORCID access tokens.</li>
        </ul>
        <p>We do not sell personal data and we do not display advertising.</p>
      </section>
      <section className={styles.section} aria-labelledby="locations">
        <h2 id="locations">Where data lives and sub-processors</h2>
        <ul className={styles.plain}>
          <li><strong>Website frontend:</strong> Hosted on Vercel serverless platform.</li>
          <li><strong>Authentication database:</strong> Hosted on Neon (managed PostgreSQL) in AWS region us-east-1.</li>
          <li><strong>Scientific backend and storage:</strong> Amazon Web Services (AWS) in us-east-1 (FastAPI backend, primary PostgreSQL database, S3 object storage for calculation artifacts and uploads, and EC2 on-demand compute worker).</li>
          <li><strong>Transactional email:</strong> Resend (an email service operating over HTTPS used exclusively to deliver in-app feedback reports and public contact form messages to the team mailbox).</li>
          <li><strong>Abuse protection:</strong> Cloudflare Turnstile (a privacy-preserving verification service used exclusively on the public contact form to prevent automated spam abuse without tracking cookies).</li>
          <li><strong>Identity providers:</strong> Google OAuth (for authentication) and ORCID (optional authentication and citation attribution).</li>
          <li><strong>AI providers:</strong> Only if the AI Scientist feature is enabled for your account. AI is disabled by default for new accounts during the beta (<code>CHEMDFT_AI_FOR_NEW_USERS=false</code>). No project data, molecules, or conversational text are sent to any AI provider unless AI is explicitly active for your account and you submit a prompt to the AI Scientist (routing to NVIDIA hosted models or Moonshot AI/Kimi).</li>
        </ul>
      </section>
      <section className={styles.section} aria-labelledby="cookies">
        <h2 id="cookies">Cookies</h2>
        <ul className={styles.plain}>
          <li><strong>Session cookie:</strong> An essential, encrypted HttpOnly cookie (<code>better-auth.session_token</code>, with <code>__Secure-</code> prefix on HTTPS) that maintains your signed-in session. SameSite=Lax.</li>
          <li><strong>Terms cookie:</strong> <code>chemdft_terms_accepted=true</code> (SameSite=Lax, temporary 10-minute cookie set before Google OAuth redirect to record consent during sign-up).</li>
          <li><strong>ORCID cookies:</strong> <code>chemdft_orcid_binding</code> and <code>chemdft_orcid_next</code> (HttpOnly, SameSite=Lax, Secure when hosted, temporary 10-minute cookies used solely to prevent login CSRF during ORCID linking).</li>
        </ul>
        <p>ChemDFT sets no advertising cookies, no analytics cookies, and no third-party tracking cookies.</p>
      </section>
      <section className={styles.section} aria-labelledby="rights">
        <h2 id="rights">Your control: export and deletion</h2>
        <ul className={styles.plain}>
          <li><strong>Export:</strong> Settings &rarr; General &rarr; Your data &rarr; Download. You receive a ZIP archive of JSON files containing your account profile, projects, structures, jobs, and calculation results with provenance.</li>
          <li>
            <strong>Delete:</strong> Settings &rarr; General &rarr; Delete account. When confirmed by typing your email:
            <ol style={{ margin: "6px 0 6px 20px", padding: 0 }}>
              <li>Running computational jobs in projects you own are requested to cancel.</li>
              <li>Content of owned, unshared projects is purged; project records are renamed to &ldquo;Deleted project&rdquo; with slug &ldquo;deleted-&lt;id&gt;&rdquo; to preserve foreign keys in immutable audit records.</li>
              <li>Stored input files and calculation artifacts are deleted from AWS S3 object storage.</li>
              <li>Your project memberships, AI user preferences, BYOK credentials, and ORCID links are permanently deleted.</li>
              <li>Your personal organization is renamed to &ldquo;Deleted workspace&rdquo;.</li>
              <li>Your user account is irreversibly anonymised (email set to <code>deleted-&lt;id&gt;@deleted.invalid</code>, name to &ldquo;Deleted user&rdquo;, and account disabled).</li>
              <li>Your stored feedback reports are deleted from the authentication database.</li>
              <li>Your active sessions, linked Google accounts, and credentials are permanently removed from the Better Auth database.</li>
            </ol>
            Backups: automated daily PostgreSQL database dumps in AWS S3 expire after 30 days. Feedback emails already delivered to the team mailbox exist outside the database; write to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> for mailbox deletion requests. Projects shared with other researchers remain with the co-members; only your access ends.
          </li>
          <li><strong>Contact:</strong> To access, correct, or request deletion of your personal data, or for any privacy question, contact Tabriz Ahmadli directly via our <Link href={`/${locale}/contact`}>Contact form</Link> or at <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</li>
        </ul>
        <p>Also read the <Link href={`/${locale}/terms`}>Terms of Use</Link> and the <Link href={`/${locale}/beta`}>Beta notice</Link>.</p>
      </section>
    </>
  );
}
