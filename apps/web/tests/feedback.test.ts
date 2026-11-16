import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";

import {
  stripHeaderInjection,
  sanitizeFilename,
  validateAttachmentType,
  submitFeedback,
  FeedbackValidationError,
  FeedbackRateLimitedError,
  APP_VERSION,
  formatAttachmentSize,
} from "../src/lib/feedback/service";
import * as sessionModule from "../src/lib/auth/session";
import * as ownerModule from "../src/lib/auth/owner";
import { POST as feedbackRoutePost } from "../src/app/api/feedback/route";
import {
  getFakeFeedbackMailer,
  setGlobalFakeFeedbackMailer,
  FakeFeedbackMailer,
  FeedbackMailerNotConfiguredError,
  FeedbackDeliveryError,
  getFeedbackMailer,
} from "../src/lib/feedback/mailer";
import {
  initFeedbackTableForTest,
  getFeedbackDatabase,
  queryRows,
  deleteFeedbackReportsForUser,
  countUserReportsInWindow,
  countFailedReportsInWindow,
  listRecentFeedbackReports,
  FeedbackTableMissingError,
} from "../src/lib/feedback/db";
import {
  ALLOWED_EXTENSIONS,
  REJECTED_EXTENSIONS,
  MAX_TITLE_LENGTH,
  MAX_TOTAL_ATTACHMENT_BYTES,
  type FeedbackReportRecord,
} from "../src/lib/feedback/types";
import { FeedbackForm } from "../src/app/[locale]/feedback/feedback-form";
import { ROADMAP_ITEMS, ROADMAP_SECTIONS } from "../src/content/roadmap";

describe("feedback filename sanitization and type validation", () => {
  it("sanitizes filenames stripping directory traversals, drive letters, and control characters", () => {
    expect(sanitizeFilename("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(sanitizeFilename("..\\..\\windows\\system32\\calc.exe")).toBe("calc.exe");
    expect(sanitizeFilename("C:\\Users\\researcher\\molecule.xyz")).toBe("molecule.xyz");
    expect(sanitizeFilename("file\x00with\x1fcontrol.pdf")).toBe("filewithcontrol.pdf");
    expect(sanitizeFilename("")).toBe("attachment_0.dat");
    expect(sanitizeFilename("   ")).toBe("attachment_0.dat");
  });

  it("caps filename length to 100 characters while preserving extension", () => {
    const longName = "a".repeat(120) + ".json";
    const sanitized = sanitizeFilename(longName);
    expect(sanitized.length).toBeLessThanOrEqual(100);
    expect(sanitized.endsWith(".json")).toBe(true);
  });

  it("allows common safe scientific and image extensions", () => {
    expect(ALLOWED_EXTENSIONS.has("xyz")).toBe(true);
    expect(ALLOWED_EXTENSIONS.has("cif")).toBe(true);
    expect(ALLOWED_EXTENSIONS.has("pdb")).toBe(true);
    expect(ALLOWED_EXTENSIONS.has("mol")).toBe(true);
    expect(ALLOWED_EXTENSIONS.has("sdf")).toBe(true);
    expect(ALLOWED_EXTENSIONS.has("inp")).toBe(true);
    expect(ALLOWED_EXTENSIONS.has("com")).toBe(true);
    expect(ALLOWED_EXTENSIONS.has("gjf")).toBe(true);
    expect(ALLOWED_EXTENSIONS.has("out")).toBe(true);
    expect(ALLOWED_EXTENSIONS.has("zip")).toBe(true);
    expect(ALLOWED_EXTENSIONS.has("pdf")).toBe(true);
    expect(ALLOWED_EXTENSIONS.has("csv")).toBe(true);
    expect(ALLOWED_EXTENSIONS.has("png")).toBe(true);
    expect(ALLOWED_EXTENSIONS.has("json")).toBe(true);
    const safeList = ["molecule.xyz", "structure.cif", "protein.pdb", "data.mol", "sample.sdf", "input.inp", "calc.gjf", "result.out", "archive.zip", "report.pdf", "data.csv", "plot.png", "spectrum.json"];
    for (const name of safeList) {
      expect(() => validateAttachmentType(name, "text/plain", "dGVzdA==")).not.toThrow();
    }
  });

  it("strictly rejects executable and script extensions", () => {
    for (const ext of REJECTED_EXTENSIONS) {
      expect(() => validateAttachmentType(`dangerous.${ext}`, "application/octet-stream", "dGVzdA==")).toThrow(FeedbackValidationError);
    }
  });

  it("rejects unknown extensions not on the allowlist", () => {
    expect(() => validateAttachmentType("unknown.weirdext", "application/octet-stream", "dGVzdA==")).toThrow(FeedbackValidationError);
  });

  it("distinguishes Gaussian input .com from DOS executable .com", () => {
    // Gaussian ASCII text input: should pass
    const gaussianContent = Buffer.from("# B3LYP/6-31G* opt\n\nWater molecule\n\n0 1\nO 0.0 0.0 0.0\nH 0.0 0.0 1.0\n").toString("base64");
    expect(() => validateAttachmentType("water.com", "text/plain", gaussianContent)).not.toThrow();

    // DOS executable with MZ header and non-ASCII binary bytes: should reject
    const binaryBytes = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00]);
    const dosContent = binaryBytes.toString("base64");
    expect(() => validateAttachmentType("malware.com", "application/x-msdownload", dosContent)).toThrow(FeedbackValidationError);
  });

  it("strips CRLF and tab characters from header fields to prevent email header injection", () => {
    const injected = "subject: test\r\nBcc: victim@example.com\n\tAnother-Header: 1";
    const cleaned = stripHeaderInjection(injected);
    expect(cleaned).not.toContain("\r");
    expect(cleaned).not.toContain("\n");
    expect(cleaned).not.toContain("\t");
  });
});

describe("feedback mailer", () => {
  beforeEach(() => {
    setGlobalFakeFeedbackMailer(new FakeFeedbackMailer());
  });

  it("fake mailer collects outbox messages and records sent metadata", async () => {
    const mailer = getFakeFeedbackMailer();
    const result = await mailer.send({
      to: "owner@chemdft.com",
      from: "feedback@chemdft.com",
      replyTo: "researcher@university.edu",
      subject: "[ChemDFT feedback] Bug: Test",
      text: "Details text",
      html: "<p>Details HTML</p>",
      attachments: [{ filename: "test.txt", content: "dGVzdA==", contentType: "text/plain", sizeBytes: 4 }],
    });

    expect(result.messageId).toMatch(/^fake_msg_/);
    expect(mailer.outbox).toHaveLength(1);
    expect(mailer.outbox[0]?.to).toBe("owner@chemdft.com");
    expect(mailer.outbox[0]?.replyTo).toBe("researcher@university.edu");
    expect(mailer.outbox[0]?.attachments).toHaveLength(1);
  });

  it("fake mailer simulates delivery errors when configured", async () => {
    const mailer = getFakeFeedbackMailer();
    mailer.shouldFail = true;
    mailer.failErrorCode = "PROVIDER_HTTP_502";

    await expect(
      mailer.send({
        to: "owner@chemdft.com",
        from: "feedback@chemdft.com",
        subject: "test",
        text: "test",
        html: "test",
      }),
    ).rejects.toThrow(FeedbackDeliveryError);
  });

  it("throws FeedbackMailerNotConfiguredError when RESEND_API_KEY is missing in non-test mode", () => {
    expect(() => getFeedbackMailer({ NODE_ENV: "production", RESEND_API_KEY: "" })).toThrow(FeedbackMailerNotConfiguredError);
    expect(() => getFeedbackMailer({ NODE_ENV: "production" })).toThrow(FeedbackMailerNotConfiguredError);
  });
});

describe("feedback database persistence, rate limits, and scientific privacy", () => {
  const testUserId = `test-user-${Date.now()}`;
  const testEmail = "researcher@institution.org";

  beforeEach(async () => {
    await initFeedbackTableForTest();
    setGlobalFakeFeedbackMailer(new FakeFeedbackMailer());
  });

  it("stores feedback metadata in database with status sent and NO attachment bytes stored", async () => {
    const fakeMailer = getFakeFeedbackMailer();
    const result = await submitFeedback(
      {
        userId: testUserId,
        userEmail: testEmail,
        type: "not_working",
        title: "PySCF convergence failure",
        details: "SCF calculation did not converge with default DIIS settings on iron complex.",
        replyConsent: true,
        pagePath: "/en/projects/fe-complex",
        locale: "en",
        userAgent: "Vitest/TestAgent",
        attachments: [
          {
            filename: "input.xyz",
            content: "MTIKTmV3IE1vbGVjdWxlCg==",
            contentType: "chemical/x-xyz",
            sizeBytes: 25,
          },
        ],
      },
      { CHEMDFT_FEEDBACK_MAILER: "fake" },
    );

    expect(result.ok).toBe(true);
    expect(result.attachmentCount).toBe(1);
    expect(result.replyConsent).toBe(true);

    // Verify mailer received message with replyTo set to researcher email
    expect(fakeMailer.outbox).toHaveLength(1);
    expect(fakeMailer.outbox[0]?.replyTo).toBe(testEmail);
    expect(fakeMailer.outbox[0]?.subject).toContain("PySCF convergence failure");

    // Check database row
    const rows = await queryRows<FeedbackReportRecord>("SELECT * FROM feedback_report WHERE \"id\" = ?", [result.reportId]);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.userId).toBe(testUserId);
    expect(row.type).toBe("not_working");
    expect(row.title).toBe("PySCF convergence failure");
    expect(row.status).toBe("sent");
    expect(Boolean(row.replyConsent)).toBe(true);
    expect(row.appVersion).toBe(APP_VERSION);
    expect(Number(row.attachmentCount)).toBe(1);
    expect(Number(row.attachmentBytes)).toBe(25);
    expect(row.providerMessageId).toMatch(/^fake_msg_/);
    expect(row.sentAt).not.toBeNull();

    // SCIENTIFIC PRIVACY INVARIANT: Ensure no attachment content or bytes column exists in feedback_report
    const keys = Object.keys(row);
    expect(keys).not.toContain("content");
    expect(keys).not.toContain("fileBytes");
    expect(keys).not.toContain("attachmentData");
  });

  it("omits Reply-To when replyConsent is false", async () => {
    const fakeMailer = getFakeFeedbackMailer();
    const result = await submitFeedback(
      {
        userId: `${testUserId}-noreply`,
        userEmail: testEmail,
        type: "feature_idea",
        title: "Add Raman depolarisation ratio",
        details: "Would like to see depolarization ratio calculation in Raman spectra.",
        replyConsent: false,
        pagePath: "/en/jobs",
        locale: "en",
      },
      { CHEMDFT_FEEDBACK_MAILER: "fake" },
    );

    expect(result.ok).toBe(true);
    expect(fakeMailer.outbox[0]?.replyTo).toBeNull();
  });

  it("updates database record to failed when mail delivery fails", async () => {
    const fakeMailer = getFakeFeedbackMailer();
    fakeMailer.shouldFail = true;
    fakeMailer.failErrorCode = "PROVIDER_HTTP_500";

    await expect(
      submitFeedback(
        {
          userId: `${testUserId}-fail`,
          userEmail: testEmail,
          type: "other",
          title: "Calculation question",
          details: "Question details",
          replyConsent: true,
          pagePath: "/en/projects",
          locale: "en",
        },
        { CHEMDFT_FEEDBACK_MAILER: "fake" },
      ),
    ).rejects.toThrow(FeedbackDeliveryError);

    // Verify row status is failed
    const rows = await queryRows<FeedbackReportRecord>("SELECT * FROM feedback_report WHERE \"userId\" = ?", [`${testUserId}-fail`]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("failed");
    expect(rows[0]?.errorCode).toBe("PROVIDER_HTTP_500");
  });

  it("enforces the 10 reports per 24 hours rolling limit per user", async () => {
    const capUserId = `cap-user-${Date.now()}`;
    for (let i = 0; i < 10; i++) {
      await submitFeedback(
        {
          userId: capUserId,
          userEmail: testEmail,
          type: "feature_idea",
          title: `Report number ${i + 1}`,
          details: `Details for report ${i + 1}`,
          replyConsent: false,
          pagePath: "/en/feedback",
          locale: "en",
        },
        { CHEMDFT_FEEDBACK_MAILER: "fake", CHEMDFT_FEEDBACK_DAILY_CAP: "10", CHEMDFT_FEEDBACK_MINUTE_LIMIT: "20" },
      );
    }

    // 11th report should be rejected with rate limit error
    await expect(
      submitFeedback(
        {
          userId: capUserId,
          userEmail: testEmail,
          type: "feature_idea",
          title: "Report number 11",
          details: "This should exceed cap",
          replyConsent: false,
          pagePath: "/en/feedback",
          locale: "en",
        },
        { CHEMDFT_FEEDBACK_MAILER: "fake", CHEMDFT_FEEDBACK_DAILY_CAP: "10", CHEMDFT_FEEDBACK_MINUTE_LIMIT: "20" },
      ),
    ).rejects.toThrow(FeedbackRateLimitedError);
  });

  it("rejects total attachments exceeding 4 MB", async () => {
    await expect(
      submitFeedback(
        {
          userId: testUserId,
          userEmail: testEmail,
          type: "other",
          title: "Huge file",
          details: "File is too big",
          replyConsent: false,
          pagePath: "/en/feedback",
          locale: "en",
          attachments: [
            {
              filename: "huge.pdf",
              content: "dGVzdA==",
              contentType: "application/pdf",
              sizeBytes: MAX_TOTAL_ATTACHMENT_BYTES + 1024,
            },
          ],
        },
        { CHEMDFT_FEEDBACK_MAILER: "fake" },
      ),
    ).rejects.toThrow(FeedbackValidationError);
  });

  it("validates title length constraints (1 to 120 chars)", async () => {
    await expect(
      submitFeedback(
        {
          userId: testUserId,
          userEmail: testEmail,
          type: "other",
          title: "",
          details: "Valid details",
          replyConsent: false,
          pagePath: "/en/feedback",
          locale: "en",
        },
        { CHEMDFT_FEEDBACK_MAILER: "fake" },
      ),
    ).rejects.toThrow(FeedbackValidationError);

    await expect(
      submitFeedback(
        {
          userId: testUserId,
          userEmail: testEmail,
          type: "other",
          title: "x".repeat(MAX_TITLE_LENGTH + 1),
          details: "Valid details",
          replyConsent: false,
          pagePath: "/en/feedback",
          locale: "en",
        },
        { CHEMDFT_FEEDBACK_MAILER: "fake" },
      ),
    ).rejects.toThrow(FeedbackValidationError);
  });

  it("cleans up user feedback reports on account deletion", async () => {
    const deleteUserId = `delete-user-${Date.now()}`;
    await submitFeedback(
      {
        userId: deleteUserId,
        userEmail: testEmail,
        type: "other",
        title: "Report to be deleted",
        details: "This report will be deleted when account is removed.",
        replyConsent: true,
        pagePath: "/en/feedback",
        locale: "en",
      },
      { CHEMDFT_FEEDBACK_MAILER: "fake" },
    );

    const countBefore = await countUserReportsInWindow(deleteUserId, 24 * 60 * 60 * 1000);
    expect(countBefore).toBe(1);

    const deleted = await deleteFeedbackReportsForUser(deleteUserId);
    expect(deleted).toBeGreaterThanOrEqual(1);

    const countAfter = await countUserReportsInWindow(deleteUserId, 24 * 60 * 60 * 1000);
    expect(countAfter).toBe(0);
  });

  it("throws FeedbackTableMissingError when feedback_report table does not exist", async () => {
    // Drop table temporarily to test lazy-safe behavior
    const db = await getFeedbackDatabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).exec("DROP TABLE IF EXISTS feedback_report");

    await expect(
      submitFeedback(
        {
          userId: "missing-table-user",
          userEmail: testEmail,
          type: "other",
          title: "Table missing test",
          details: "Testing 503 fallback",
          replyConsent: false,
          pagePath: "/en/feedback",
          locale: "en",
        },
        { CHEMDFT_FEEDBACK_MAILER: "fake" },
      ),
    ).rejects.toThrow(FeedbackTableMissingError);

    // Re-create table for subsequent tests
    await initFeedbackTableForTest();
  });

  it("owner feedback queries return latest records and 7-day failure count", async () => {
    const reports = await listRecentFeedbackReports(10);
    expect(Array.isArray(reports)).toBe(true);

    const failed = await countFailedReportsInWindow(7 * 24 * 60 * 60 * 1000);
    expect(typeof failed).toBe("number");
  });

  it("does not insert any database row if mailer is unconfigured (prevents stale pending rows)", async () => {
    const unconfiguredUserId = `unconfigured-user-${Date.now()}`;
    await expect(
      submitFeedback(
        {
          userId: unconfiguredUserId,
          userEmail: testEmail,
          type: "other",
          title: "Missing key test",
          details: "Details should not be inserted",
          replyConsent: false,
          pagePath: "/en/feedback",
          locale: "en",
        },
        { NODE_ENV: "production", RESEND_API_KEY: "" },
      ),
    ).rejects.toThrow(FeedbackMailerNotConfiguredError);

    const rows = await queryRows<FeedbackReportRecord>("SELECT * FROM feedback_report WHERE \"userId\" = ?", [unconfiguredUserId]);
    expect(rows).toHaveLength(0);
  });
});

describe("attachment size formatter boundaries (A1)", () => {
  it("formats bytes under 1024 as N B", () => {
    expect(formatAttachmentSize(0)).toBe("0 B");
    expect(formatAttachmentSize(1)).toBe("1 B");
    expect(formatAttachmentSize(45)).toBe("45 B");
    expect(formatAttachmentSize(1023)).toBe("1023 B");
  });

  it("formats sizes under 1 MB as N KB with one decimal when under 10 KB, else integer", () => {
    expect(formatAttachmentSize(1024)).toBe("1.0 KB");
    expect(formatAttachmentSize(1536)).toBe("1.5 KB");
    expect(formatAttachmentSize(87 * 1024)).toBe("87 KB");
  });

  it("formats sizes 1 MB and above as N MB with one decimal", () => {
    expect(formatAttachmentSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatAttachmentSize(4 * 1024 * 1024)).toBe("4.0 MB");
  });
});

describe("disabled-account check fails closed in feedback API route (A3)", () => {
  it("returns 503 FEEDBACK_UNAVAILABLE when disabled-account lookup throws", async () => {
    const sessionSpy = vi.spyOn(sessionModule, "getSession").mockResolvedValue({
      user: {
        id: "disabled-probe-user",
        email: "probe@example.test",
        name: "Probe",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      session: {
        id: "session-123",
        userId: "disabled-probe-user",
        expiresAt: new Date(Date.now() + 3600000),
        token: "tok",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as unknown as Awaited<ReturnType<typeof sessionModule.getSession>>);

    const isUserDisabledSpy = vi.spyOn(ownerModule, "isUserDisabled").mockRejectedValue(new Error("Database connection dropped"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const formData = new FormData();
      formData.append("type", "not_working");
      formData.append("title", "Test error");
      formData.append("details", "Some details");

      const req = new NextRequest("http://127.0.0.1:3000/api/feedback", {
        method: "POST",
        body: formData,
      });

      const res = await feedbackRoutePost(req);
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json).toEqual({
        error: "service_unavailable",
        code: "FEEDBACK_UNAVAILABLE",
        message: "Feedback is temporarily unavailable.",
      });
      expect(consoleErrorSpy).toHaveBeenCalledWith("[chemdft-feedback] disabled-check-failed");
    } finally {
      sessionSpy.mockRestore();
      isUserDisabledSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });
});

describe("roadmap content", () => {
  it("roadmap has Planned, In progress, and Done sections containing verified items", () => {
    expect(ROADMAP_SECTIONS).toHaveLength(3);
    const statuses = ROADMAP_SECTIONS.map((s) => s.status);
    expect(statuses).toContain("in_progress");
    expect(statuses).toContain("planned");
    expect(statuses).toContain("done");

    for (const item of ROADMAP_ITEMS) {
      expect(item.id.trim()).not.toBe("");
      expect(item.title.trim()).not.toBe("");
      expect(item.shortDescription.trim()).not.toBe("");
      expect(["planned", "in_progress", "done"]).toContain(item.status);
    }
  });
});

describe("feedback form component static rendering", () => {
  it("renders the approved feedback form layout with title, radio options, inputs, caution line, and email", () => {
    const html = renderToStaticMarkup(createElement(FeedbackForm, { locale: "en", userEmail: "chemist@lab.org" }));

    expect(html).toContain("Tell us what ChemDFT should do next");
    expect(html).toContain("Every report goes straight to the team, and we read all of them.");
    expect(html).toContain("Not working");
    expect(html).toContain("Feature idea");
    expect(html).toContain("Method or engine");
    expect(html).toContain("Other");
    expect(html).toContain("Short title");
    expect(html).toContain("Tell us more");
    expect(html).toContain("Attach files");
    expect(html).toContain("Choose files");
    expect(html).toContain("or drop them here");
    expect(html).toContain("Please do not attach unpublished or confidential data");
    expect(html).toContain("The ChemDFT team may email me back about this report");
    expect(html).toContain("chemist@lab.org");
    expect(html).toContain("Agrees to the");
    expect(html).toContain("Privacy Policy");
    expect(html).toContain("Send feedback");
    expect(html).toContain("ChemDFT is an early-stage startup");
    expect(html).toContain("What happens next");
    expect(html).toContain("See the roadmap");
  });

  it("renders localized text for Turkish, Russian, and German", () => {
    const trHtml = renderToStaticMarkup(createElement(FeedbackForm, { locale: "tr", userEmail: "test@tr.org" }));
    expect(trHtml).toContain("ChemDFT&#x27;nin bundan sonra ne yapması gerektiğini bize iletin");
    expect(trHtml).toContain("Geri bildirim gönder");

    const ruHtml = renderToStaticMarkup(createElement(FeedbackForm, { locale: "ru", userEmail: "test@ru.org" }));
    expect(ruHtml).toContain("Расскажите, что ChemDFT должен делать дальше");
    expect(ruHtml).toContain("Отправить отзыв");

    const deHtml = renderToStaticMarkup(createElement(FeedbackForm, { locale: "de", userEmail: "test@de.org" }));
    expect(deHtml).toContain("Sagen Sie uns, was ChemDFT als Nächstes tun soll");
    expect(deHtml).toContain("Feedback senden");
  });
});
