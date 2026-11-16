import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { LATEST_VERSION } from "../src/content/releases";

import {
  initContactTableForTest,
  setContactDatabaseOverride,
  queryRows,
} from "../src/lib/contact/db";
import {
  hashClientIp,
  stripCrLf,
} from "../src/lib/contact/crypto";
import {
  submitContactMessage,
  validateContactInput,
  ContactValidationError,
  ContactRateLimitedError,
  ContactUnavailableError,
} from "../src/lib/contact/service";
import { FakeFeedbackMailer } from "../src/lib/feedback/mailer";
import { DatabaseSync } from "node:sqlite";
import nextConfig from "../next.config";

type MockFetchFn = typeof fetch;
type DbConnection = Parameters<typeof setContactDatabaseOverride>[0];
interface NextHeaderRule {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

describe("Contact Form Anti-Abuse and Delivery", () => {
  let sqliteDb: DatabaseSync;
  let fakeMailer: FakeFeedbackMailer;
  const secretKey = "test-hash-" + "secret-xyz";
  const turnstileSecret = "1x0000000000000000000000000000000AA"; // Cloudflare always-pass dummy secret

  beforeEach(async () => {
    sqliteDb = new DatabaseSync(":memory:");
    setContactDatabaseOverride(sqliteDb as unknown as DbConnection);
    await initContactTableForTest(sqliteDb as unknown as DbConnection);
    fakeMailer = new FakeFeedbackMailer();
  });

  afterEach(() => {
    setContactDatabaseOverride(undefined);
  });

  const validPayload = {
    name: "Dr. Marie Curie",
    email: "marie.curie@radium-lab.org",
    organisation: "Sorbonne University",
    topic: "Work with us" as const,
    message: "We would like to explore integrating quantum DFT calculations with experimental crystallography.",
    consent: true,
    turnstileToken: "dummy-valid-turnstile-token",
    website: "",
    renderedAt: Date.now() - 5000, // 5 seconds elapsed
    locale: "en",
    ip: "198.51.100.42",
  };

  const defaultEnv = {
    CHEMDFT_CONTACT_HASH_SECRET: secretKey,
    TURNSTILE_SECRET_KEY: turnstileSecret,
    CHEMDFT_CONTACT_TO: "tab@chemdft.com",
    CHEMDFT_CONTACT_FROM: "ChemDFT Contact <feedback@chemdft.com>",
    CHEMDFT_CONTACT_DAILY_CAP: "50",
  };

  const mockPassingFetch = async () =>
    new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });

  // 1. Validation per field
  describe("Field validation", () => {
    it("requires a name with max 100 characters", () => {
      expect(() => validateContactInput({ ...validPayload, name: "" })).toThrowError("provide your name");
      expect(() => validateContactInput({ ...validPayload, name: " " })).toThrowError("provide your name");
      expect(() => validateContactInput({ ...validPayload, name: "a".repeat(101) })).toThrowError("100 characters");
      expect(() => validateContactInput({ ...validPayload, name: "Valid Name" })).not.toThrow();
    });

    it("requires a valid email with max 254 characters and rejects disposable emails", () => {
      expect(() => validateContactInput({ ...validPayload, email: "" })).toThrowError("provide your email");
      expect(() => validateContactInput({ ...validPayload, email: "notanemail" })).toThrowError("valid email");
      expect(() => validateContactInput({ ...validPayload, email: "test@" })).toThrowError("valid email");
      expect(() => validateContactInput({ ...validPayload, email: `a@${"b".repeat(250)}.com` })).toThrowError("valid email");

      // Disposable email domain refusal
      expect(() => validateContactInput({ ...validPayload, email: "spammer@mailinator.com" })).toThrowError("disposable domains");
      expect(() => validateContactInput({ ...validPayload, email: "bot@tempmail.com" })).toThrowError("disposable domains");
      expect(() => validateContactInput({ ...validPayload, email: "user@guerrillamail.org" })).toThrowError("disposable domains");
    });

    it("validates optional organisation up to 120 chars", () => {
      expect(() => validateContactInput({ ...validPayload, organisation: "" })).not.toThrow();
      expect(() => validateContactInput({ ...validPayload, organisation: undefined })).not.toThrow();
      expect(() => validateContactInput({ ...validPayload, organisation: "a".repeat(121) })).toThrowError("120 characters");
      expect(() => validateContactInput({ ...validPayload, organisation: "Max Planck Institute" })).not.toThrow();
    });

    it("requires a valid topic from the approved list", () => {
      expect(() => validateContactInput({ ...validPayload, topic: "Invalid topic" as unknown as typeof validPayload.topic })).toThrowError("valid topic");
      expect(() => validateContactInput({ ...validPayload, topic: "Work with us" })).not.toThrow();
      expect(() => validateContactInput({ ...validPayload, topic: "Question or more information" })).not.toThrow();
      expect(() => validateContactInput({ ...validPayload, topic: "Press or partnership" })).not.toThrow();
    });

    it("requires message between 10 and 4000 characters", () => {
      expect(() => validateContactInput({ ...validPayload, message: "" })).toThrowError("write a message");
      expect(() => validateContactInput({ ...validPayload, message: "Too short" })).toThrowError("at least 10 characters");
      expect(() => validateContactInput({ ...validPayload, message: "a".repeat(4001) })).toThrowError("4000 characters or fewer");
      expect(() => validateContactInput({ ...validPayload, message: "Valid 10+ character message here." })).not.toThrow();
    });

    it("requires consent to be true", () => {
      expect(() => validateContactInput({ ...validPayload, consent: false })).toThrowError("Consent");
    });

    it("rejects messages with more than 3 links or mostly link spam", () => {
      const fourLinks = "Hello https://link1.com and https://link2.com and https://link3.com and https://link4.com";
      expect(() => validateContactInput({ ...validPayload, message: fourLinks })).toThrowError("more than 3 links");

      const mostlyLinks = "Check https://example.com/a/very/long/url/that/takes/over/half/the/entire/message/length";
      expect(() => validateContactInput({ ...validPayload, message: mostlyLinks })).toThrowError("link spam");
    });
  });

  // 2. Honeypot check
  describe("Honeypot protection", () => {
    it("returns generic success without sending or persisting when honeypot is filled", async () => {
      const res = await submitContactMessage(
        { ...validPayload, website: "https://spammer.bot" },
        defaultEnv,
        mockPassingFetch as unknown as MockFetchFn,
        fakeMailer,
      );

      expect(res.ok).toBe(true);
      expect(fakeMailer.outbox.length).toBe(0); // Nothing sent
      const rows = await queryRows("SELECT * FROM contact_message");
      expect(rows.length).toBe(0); // Nothing inserted
    });
  });

  // 3. Minimum fill time check (3 seconds)
  describe("Minimum fill time", () => {
    it("returns generic success without sending or persisting when submitted too quickly (< 3s)", async () => {
      const res = await submitContactMessage(
        { ...validPayload, renderedAt: Date.now() - 1000 }, // 1s elapsed
        defaultEnv,
        mockPassingFetch as unknown as MockFetchFn,
        fakeMailer,
      );

      expect(res.ok).toBe(true);
      expect(fakeMailer.outbox.length).toBe(0);
      const rows = await queryRows("SELECT * FROM contact_message");
      expect(rows.length).toBe(0);
    });

    it("returns generic success when renderedAt timestamp is in the future", async () => {
      const res = await submitContactMessage(
        { ...validPayload, renderedAt: Date.now() + 10000 },
        defaultEnv,
        mockPassingFetch as unknown as MockFetchFn,
        fakeMailer,
      );

      expect(res.ok).toBe(true);
      expect(fakeMailer.outbox.length).toBe(0);
      const rows = await queryRows("SELECT * FROM contact_message");
      expect(rows.length).toBe(0);
    });
  });

  // 4. Rate limits by hashed IP
  describe("Rate limiting", () => {
    it("allows up to 3 submissions per 10 minutes from the same hashed IP, then rate-limits", async () => {
      for (let i = 0; i < 3; i++) {
        const res = await submitContactMessage(
          { ...validPayload, renderedAt: Date.now() - 5000 },
          defaultEnv,
          mockPassingFetch as unknown as MockFetchFn,
          fakeMailer,
        );
        expect(res.ok).toBe(true);
      }

      // 4th submission within 10 minutes should throw ContactRateLimitedError
      await expect(
        submitContactMessage(
          { ...validPayload, renderedAt: Date.now() - 5000 },
          defaultEnv,
          mockPassingFetch as unknown as MockFetchFn,
          fakeMailer,
        ),
      ).rejects.toThrowError(ContactRateLimitedError);
    });

    it("enforces daily limit of 5 per IP and global cap", async () => {
      const customEnv = { ...defaultEnv, CHEMDFT_CONTACT_DAILY_CAP: "4" };
      // Insert 4 messages from different IPs
      for (let i = 0; i < 4; i++) {
        await submitContactMessage(
          { ...validPayload, ip: `198.51.100.${i + 1}`, renderedAt: Date.now() - 5000 },
          customEnv,
          mockPassingFetch as unknown as MockFetchFn,
          fakeMailer,
        );
      }

      // 5th message exceeds global daily cap of 4
      await expect(
        submitContactMessage(
          { ...validPayload, ip: "198.51.100.99", renderedAt: Date.now() - 5000 },
          customEnv,
          mockPassingFetch as unknown as MockFetchFn,
          fakeMailer,
        ),
      ).rejects.toThrowError("daily limit");
    });
  });

  // 5. Fail-closed: missing keys, secrets, or unavailable services
  describe("Fail-closed behavior", () => {
    it("fails closed with 503 CONTACT_UNAVAILABLE when TURNSTILE_SECRET_KEY is missing", async () => {
      const envWithoutTurnstile = { ...defaultEnv, TURNSTILE_SECRET_KEY: "" };
      await expect(
        submitContactMessage(validPayload, envWithoutTurnstile, mockPassingFetch as unknown as MockFetchFn, fakeMailer),
      ).rejects.toThrowError(ContactUnavailableError);
    });

    it("fails closed with 503 CONTACT_UNAVAILABLE when CHEMDFT_CONTACT_HASH_SECRET is missing", async () => {
      const envWithoutSecret = { ...defaultEnv, CHEMDFT_CONTACT_HASH_SECRET: "" };
      await expect(
        submitContactMessage(validPayload, envWithoutSecret, mockPassingFetch as unknown as MockFetchFn, fakeMailer),
      ).rejects.toThrowError(ContactUnavailableError);
    });

    it("fails closed with 503 when Turnstile verification service is unreachable", async () => {
      const failingFetch = async () => {
        throw new Error("DNS resolution failed");
      };
      await expect(
        submitContactMessage(validPayload, defaultEnv, failingFetch as unknown as MockFetchFn, fakeMailer),
      ).rejects.toThrowError(ContactUnavailableError);
    });

    it("rejects with ContactValidationError when Turnstile response is invalid (bot failed)", async () => {
      const botFailedFetch = async () =>
        new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });

      await expect(
        submitContactMessage(validPayload, defaultEnv, botFailedFetch as unknown as MockFetchFn, fakeMailer),
      ).rejects.toThrowError(ContactValidationError);
    });

    it("fails closed with 503 CONTACT_UNAVAILABLE when contact_message table is missing", async () => {
      const emptyDb = new DatabaseSync(":memory:");
      setContactDatabaseOverride(emptyDb as unknown as DbConnection); // Table NOT initialized

      try {
        await expect(
          submitContactMessage(validPayload, defaultEnv, mockPassingFetch as unknown as MockFetchFn, fakeMailer),
        ).rejects.toThrowError(ContactUnavailableError);
      } finally {
        setContactDatabaseOverride(sqliteDb as unknown as DbConnection);
      }
    });
  });

  // 6. Database security & Zero PII
  describe("Database security and zero PII", () => {
    it("stores zero PII in the contact_message table (no name, no email, no message)", async () => {
      await submitContactMessage(validPayload, defaultEnv, mockPassingFetch as unknown as MockFetchFn, fakeMailer);

      const rows = await queryRows<Record<string, unknown>>("SELECT * FROM contact_message");
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row).toBeDefined();

      // Verify allowed columns
      expect(row?.id).toBeDefined();
      expect(row?.topic).toBe(validPayload.topic);
      expect(row?.status).toBe("sent");
      expect(row?.locale).toBe("en");
      expect(row?.appVersion).toBe(LATEST_VERSION);
      expect(row?.providerMessageId).toBeDefined();
      expect(row?.createdAt).toBeDefined();
      expect(row?.sentAt).toBeDefined();

      // Explicitly assert PII is absent
      expect(row?.name).toBeUndefined();
      expect(row?.email).toBeUndefined();
      expect(row?.message).toBeUndefined();
      expect(row?.organisation).toBeUndefined();

      // Assert IP is NOT stored raw
      expect(row?.ip).toBeUndefined();
      expect(row?.ipHash).not.toBe(validPayload.ip);
      expect(row?.ipHash).toBe(hashClientIp(validPayload.ip, secretKey));
    });
  });

  // 7. Mailer resolution before insert and failure recording
  describe("Delivery and error handling", () => {
    it("resolves mailer BEFORE database insert (no stale pending rows if unconfigured)", async () => {
      const envWithoutResend = { ...defaultEnv, RESEND_API_KEY: "", CHEMDFT_FEEDBACK_MAILER: "resend", NODE_ENV: "production" };
      await expect(
        submitContactMessage(validPayload, envWithoutResend, mockPassingFetch as unknown as MockFetchFn, undefined),
      ).rejects.toThrowError(ContactUnavailableError);

      const rows = await queryRows("SELECT * FROM contact_message");
      expect(rows.length).toBe(0); // Zero pending rows inserted
    });

    it("marks record failed in database when mailer delivery throws", async () => {
      fakeMailer.shouldFail = true;
      fakeMailer.failErrorCode = "PROVIDER_DOWN";

      await expect(
        submitContactMessage(validPayload, defaultEnv, mockPassingFetch as unknown as MockFetchFn, fakeMailer),
      ).rejects.toThrowError("We could not send your message");

      const rows = await queryRows<Record<string, unknown>>("SELECT * FROM contact_message");
      expect(rows.length).toBe(1);
      expect(rows[0]?.status).toBe("failed");
      expect(rows[0]?.errorCode).toBe("FeedbackDeliveryError");
    });

    it("sets Reply-To to the sender's email and does NOT send an auto-reply to the sender", async () => {
      await submitContactMessage(validPayload, defaultEnv, mockPassingFetch as unknown as MockFetchFn, fakeMailer);

      expect(fakeMailer.outbox.length).toBe(1);
      const email = fakeMailer.outbox[0];
      expect(email).toBeDefined();
      expect(email?.to).toBe("tab@chemdft.com");
      expect(email?.replyTo).toBe("marie.curie@radium-lab.org");
      expect(email?.from).toBe("ChemDFT Contact <feedback@chemdft.com>");
      expect(email?.subject).toBe("[ChemDFT contact] Work with us — Dr. Marie Curie");

      // Verify no auto-reply was sent to sender
      const autoReplyToSender = fakeMailer.outbox.find((m) => m.to === validPayload.email);
      expect(autoReplyToSender).toBeUndefined();
    });

    it("neutralizes header injection attempts in name and email", () => {
      const injectedName = "Attacker\r\nBcc: evil@victim.com";
      const stripped = stripCrLf(injectedName);
      expect(stripped).not.toContain("\r");
      expect(stripped).not.toContain("\n");
      expect(stripped).toBe("Attacker  Bcc: evil@victim.com");
    });

    it("escapes HTML in rendered email body", async () => {
      const xssPayload = {
        ...validPayload,
        name: "Test <script>alert(1)</script>",
        message: "Hello <b>world</b> & 'test' \"quotes\"",
      };

      await submitContactMessage(xssPayload, defaultEnv, mockPassingFetch as unknown as MockFetchFn, fakeMailer);
      expect(fakeMailer.outbox.length).toBe(1);
      const html = fakeMailer.outbox[0]?.html ?? "";

      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html).toContain("&lt;b&gt;world&lt;/b&gt; &amp; &#039;test&#039; &quot;quotes&quot;");
    });
  });

  // 8. Content-Security-Policy scoping
  describe("Content Security Policy configuration", () => {
    it("allows Turnstile script and iframe ONLY on /contact and /:locale/contact", async () => {
      const headersFn = (nextConfig as { headers?: () => Promise<NextHeaderRule[]> }).headers;
      expect(headersFn).toBeDefined();
      const headersConfig = (await headersFn?.()) ?? [];
      expect(headersConfig.length).toBeGreaterThan(0);

      const contactRules = headersConfig.filter((rule) =>
        rule.source.includes("contact"),
      );
      expect(contactRules.length).toBeGreaterThanOrEqual(2);

      for (const rule of contactRules) {
        const cspHeader = rule.headers.find((h) => h.key === "Content-Security-Policy");
        expect(cspHeader).toBeDefined();
        const value = cspHeader?.value ?? "";
        expect(value).toContain("https://challenges.cloudflare.com");
        expect(value).toContain("script-src");
        expect(value).toContain("frame-src");
        expect(value).toContain("connect-src");
      }

      // Assert non-contact paths do not have this CSP
      const nonContactRules = headersConfig.filter((rule) =>
        !rule.source.includes("contact"),
      );
      for (const rule of nonContactRules) {
        const csp = rule.headers.find((h) => h.key === "Content-Security-Policy");
        if (csp) {
          expect(csp.value).not.toContain("challenges.cloudflare.com");
        }
      }
    });
  });
});
