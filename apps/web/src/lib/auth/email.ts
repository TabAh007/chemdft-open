import { isLocalEnvironment, type Environment } from "./environment.ts";
import type { AuthConfig } from "./config.ts";

export type OutboundEmail = { to: string; kind: "password-reset" | "email-verification"; subject: string; text: string };

export interface EmailTransport {
  send(message: OutboundEmail): Promise<void>;
}

/**
 * Local/test sink. Messages are kept in memory only (never written to disk or logs, because they carry
 * reset/verification links); the log line deliberately omits the body.
 */
export const devOutbox: OutboundEmail[] = [];

export const devEmailTransport: EmailTransport = {
  async send(message) {
    devOutbox.push(message);
    console.info(`[chemdft-auth] dev email sink: queued ${message.kind} for ${message.to}`);
  },
};

/**
 * The boundary a production provider (Resend, SES, …) attaches to later. Until one exists and the
 * provider is not "dev", no transport is returned and email-dependent features stay disabled.
 */
export function getEmailTransport(config: AuthConfig, environment: Environment): EmailTransport | null {
  if (config.emailProvider === "dev" && isLocalEnvironment(environment)) return devEmailTransport;
  return null;
}
