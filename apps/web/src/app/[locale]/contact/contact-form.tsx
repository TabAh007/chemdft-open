"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";

import { ActionButton, AppIcon } from "@chemdft/ui";
import {
  CONTACT_TOPICS,
  MAX_EMAIL_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  MAX_ORGANISATION_LENGTH,
  MIN_MESSAGE_LENGTH,
  type ContactTopic,
} from "../../../lib/contact/types.ts";
import { TurnstileWidget } from "./turnstile-widget";
import styles from "./contact.module.css";

interface FormErrors {
  name?: string;
  email?: string;
  organisation?: string;
  topic?: string;
  message?: string;
  consent?: string;
  turnstile?: string;
  general?: string;
}

export function ContactForm({ locale }: { locale: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [topic, setTopic] = useState<ContactTopic>("Work with us");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(""); // Honeypot
  const [turnstileToken, setTurnstileToken] = useState("");
  const [renderedAt] = useState(() => Date.now());

  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [unavailable, setUnavailable] = useState(
    () => !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  );

  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const orgRef = useRef<HTMLInputElement>(null);
  const topicRef = useRef<HTMLSelectElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);

  function validate(): FormErrors {
    const nextErrors: FormErrors = {};

    if (!name.trim()) {
      nextErrors.name = "Please provide your name.";
    } else if (name.trim().length > MAX_NAME_LENGTH) {
      nextErrors.name = `Name must be ${MAX_NAME_LENGTH} characters or fewer.`;
    }

    if (!email.trim()) {
      nextErrors.email = "Please provide your email address.";
    } else if (email.trim().length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      nextErrors.email = "Please provide a valid email address.";
    }

    if (organisation.trim().length > MAX_ORGANISATION_LENGTH) {
      nextErrors.organisation = `Organisation must be ${MAX_ORGANISATION_LENGTH} characters or fewer.`;
    }

    if (!topic || !CONTACT_TOPICS.includes(topic)) {
      nextErrors.topic = "Please select a valid topic.";
    }

    if (!message.trim()) {
      nextErrors.message = "Please write a message.";
    } else if (message.trim().length < MIN_MESSAGE_LENGTH) {
      nextErrors.message = `Message must be at least ${MIN_MESSAGE_LENGTH} characters.`;
    } else if (message.trim().length > MAX_MESSAGE_LENGTH) {
      nextErrors.message = `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`;
    }

    if (!consent) {
      nextErrors.consent = "Consent to receive a reply is required.";
    }

    if (!turnstileToken && !unavailable) {
      nextErrors.turnstile = "Please complete the security check.";
    }

    return nextErrors;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});

    const fieldErrors = validate();
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);

      // Focus first erroneous input
      requestAnimationFrame(() => {
        if (fieldErrors.name) nameRef.current?.focus();
        else if (fieldErrors.email) emailRef.current?.focus();
        else if (fieldErrors.organisation) orgRef.current?.focus();
        else if (fieldErrors.topic) topicRef.current?.focus();
        else if (fieldErrors.message) messageRef.current?.focus();
        else if (fieldErrors.consent) consentRef.current?.focus();
        else errorSummaryRef.current?.focus();
      });
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          organisation: organisation.trim() || undefined,
          topic,
          message: message.trim(),
          consent,
          turnstileToken,
          website,
          renderedAt,
          locale,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 503) {
          setUnavailable(true);
          setErrors({
            general: "The form is temporarily unavailable. Please email tab@chemdft.com.",
          });
        } else if (res.status === 429) {
          setErrors({
            general: data.message || "You have submitted too many messages recently. Please try again later.",
          });
        } else {
          setErrors({
            general: data.message || "We could not send your message. Please email tab@chemdft.com.",
          });
        }
        return;
      }

      setSuccess(true);
    } catch {
      setErrors({
        general: "We could not send your message due to a network error. Please email tab@chemdft.com.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className={styles.successCard} role="status" data-testid="contact-success-state">
        <div className={styles.successIcon}>
          <AppIcon icon="tick-circle" />
        </div>
        <h2 className={styles.successTitle}>Thank you. Your message has been sent.</h2>
        <p className={styles.successLead}>
          If you asked for a reply, we usually answer within a few working days.
        </p>
        <Link href={`/${locale}`} className={styles.backHomeLink}>
          Back to ChemDFT home
        </Link>
      </div>
    );
  }

  const errorKeys = Object.keys(errors) as (keyof FormErrors)[];
  const hasErrors = errorKeys.length > 0;

  return (
    <div className={styles.formContainer}>
      {unavailable ? (
        <div className={styles.unavailableBanner} role="alert" data-testid="contact-unavailable-fallback">
          <AppIcon icon="info-sign" />
          <span>
            The form is temporarily unavailable. Please email{" "}
            <a href="mailto:tab@chemdft.com" className={styles.mailLink}>
              tab@chemdft.com
            </a>
            .
          </span>
        </div>
      ) : null}

      {hasErrors ? (
        <div
          ref={errorSummaryRef}
          className={styles.errorSummary}
          role="alert"
          aria-live="polite"
          tabIndex={-1}
          data-testid="contact-error-summary"
        >
          <div className={styles.errorSummaryHeader}>
            <AppIcon icon="error" />
            <strong>Please correct the following:</strong>
          </div>
          <ul className={styles.errorList}>
            {errorKeys.map((key) => (
              <li key={key} data-testid={`contact-error-${key}`}>
                {errors[key]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className={styles.form} data-testid="contact-form">
        {/* Honeypot field (hidden from users and screen readers) */}
        <input
          type="text"
          name="website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className={styles.honeypot}
          data-testid="contact-honeypot"
        />

        {/* Name */}
        <div className={styles.fieldGroup}>
          <label htmlFor="contact-name" className={styles.label}>
            <span>Your name</span>
            <span className={styles.required}>*</span>
          </label>
          <input
            ref={nameRef}
            id="contact-name"
            name="name"
            type="text"
            required
            maxLength={MAX_NAME_LENGTH}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${styles.input} ${errors.name ? styles.inputError : ""}`}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "contact-name-error" : undefined}
            data-testid="contact-input-name"
          />
          {errors.name ? (
            <span id="contact-name-error" className={styles.fieldError}>
              {errors.name}
            </span>
          ) : null}
        </div>

        {/* Email */}
        <div className={styles.fieldGroup}>
          <label htmlFor="contact-email" className={styles.label}>
            <span>Email address</span>
            <span className={styles.required}>*</span>
          </label>
          <input
            ref={emailRef}
            id="contact-email"
            name="email"
            type="email"
            required
            maxLength={MAX_EMAIL_LENGTH}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${styles.input} ${errors.email ? styles.inputError : ""}`}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "contact-email-error" : undefined}
            data-testid="contact-input-email"
          />
          {errors.email ? (
            <span id="contact-email-error" className={styles.fieldError}>
              {errors.email}
            </span>
          ) : null}
        </div>

        {/* Organisation */}
        <div className={styles.fieldGroup}>
          <label htmlFor="contact-org" className={styles.label}>
            <span>Organisation or institution</span>
            <span className={styles.optional}>(optional)</span>
          </label>
          <input
            ref={orgRef}
            id="contact-org"
            name="organisation"
            type="text"
            maxLength={MAX_ORGANISATION_LENGTH}
            value={organisation}
            onChange={(e) => setOrganisation(e.target.value)}
            className={`${styles.input} ${errors.organisation ? styles.inputError : ""}`}
            aria-invalid={Boolean(errors.organisation)}
            aria-describedby={errors.organisation ? "contact-org-error" : undefined}
            data-testid="contact-input-organisation"
          />
          {errors.organisation ? (
            <span id="contact-org-error" className={styles.fieldError}>
              {errors.organisation}
            </span>
          ) : null}
        </div>

        {/* Topic */}
        <div className={styles.fieldGroup}>
          <label htmlFor="contact-topic" className={styles.label}>
            <span>Topic</span>
            <span className={styles.required}>*</span>
          </label>
          <select
            ref={topicRef}
            id="contact-topic"
            name="topic"
            required
            value={topic}
            onChange={(e) => setTopic(e.target.value as ContactTopic)}
            className={`${styles.select} ${errors.topic ? styles.inputError : ""}`}
            aria-invalid={Boolean(errors.topic)}
            aria-describedby={errors.topic ? "contact-topic-error" : undefined}
            data-testid="contact-select-topic"
          >
            {CONTACT_TOPICS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {errors.topic ? (
            <span id="contact-topic-error" className={styles.fieldError}>
              {errors.topic}
            </span>
          ) : null}
        </div>

        {/* Message */}
        <div className={styles.fieldGroup}>
          <div className={styles.labelRow}>
            <label htmlFor="contact-message" className={styles.label}>
              <span>Message</span>
              <span className={styles.required}>*</span>
            </label>
            <span className={styles.charCount}>
              {message.length} / {MAX_MESSAGE_LENGTH}
            </span>
          </div>
          <textarea
            ref={messageRef}
            id="contact-message"
            name="message"
            required
            rows={6}
            minLength={MIN_MESSAGE_LENGTH}
            maxLength={MAX_MESSAGE_LENGTH}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className={`${styles.textarea} ${errors.message ? styles.inputError : ""}`}
            aria-invalid={Boolean(errors.message)}
            aria-describedby={errors.message ? "contact-message-error" : undefined}
            placeholder="How can we help? Tell us about your research or proposal..."
            data-testid="contact-textarea-message"
          />
          {errors.message ? (
            <span id="contact-message-error" className={styles.fieldError}>
              {errors.message}
            </span>
          ) : null}
        </div>

        {/* Consent checkbox */}
        <div className={styles.consentGroup}>
          <label htmlFor="contact-consent" className={styles.checkboxLabel}>
            <input
              ref={consentRef}
              id="contact-consent"
              name="consent"
              type="checkbox"
              required
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className={styles.checkbox}
              data-testid="contact-checkbox-consent"
            />
            <span>
              You may reply to this email address about my message. (See our{" "}
              <Link href={`/${locale}/privacy`} target="_blank" className={styles.link}>
                Privacy Policy
              </Link>
              ).
            </span>
          </label>
          {errors.consent ? (
            <span className={styles.fieldError} style={{ display: "block", marginTop: "4px" }}>
              {errors.consent}
            </span>
          ) : null}
        </div>

        {/* Cloudflare Turnstile */}
        {!unavailable ? (
          <TurnstileWidget
            onVerify={(token) => {
              setTurnstileToken(token);
              setErrors((prev) => {
                const next = { ...prev };
                delete next.turnstile;
                return next;
              });
            }}
            onError={() => {
              setErrors((prev) => ({ ...prev, turnstile: "Security verification failed." }));
            }}
            onExpire={() => {
              setTurnstileToken("");
            }}
          />
        ) : null}
        {errors.turnstile ? (
          <span className={styles.fieldError} style={{ display: "block", marginBottom: "12px" }}>
            {errors.turnstile}
          </span>
        ) : null}

        {/* Submit button */}
        <div className={styles.actions}>
          <ActionButton
            intent="primary"
            text={submitting ? "Sending..." : "Send message"}
            icon="envelope"
            type="submit"
            disabled={submitting || unavailable}
            data-testid="contact-submit-btn"
          />
        </div>
      </form>
    </div>
  );
}
