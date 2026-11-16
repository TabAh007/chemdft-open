import { isLocalEnvironment, type Environment } from "./environment.ts";

export type AuthMode = "dev" | "jwt";
export type SignupMode = "closed" | "invite" | "open" | "google_only";
/** Product state. ChemDFT is `prelaunch` until the owner explicitly flips it; nothing infers it from the host. */
export type LaunchState = "prelaunch" | "public";

export type AuthConfig = {
  authMode: AuthMode;
  signupMode: SignupMode;
  launchState: LaunchState;
  /** Whether the browser may create accounts through the public sign-up endpoint. Only `open` + local. */
  publicSignupEnabled: boolean;
  googleEnabled: boolean;
  /** Whether Google accounts may create new ChemDFT accounts (Option B beta signup). */
  googleSignupAllowed: boolean;
  /** Maximum number of non-owner accounts allowed in the beta (null when no cap). */
  betaUserCap: number | null;
  /** Configured owner email addresses allowed to manage beta accounts. */
  ownerEmails: string[];
  /** Sign in with ORCID (linked accounts only, ADR-044). The credentials live on the API, so this is only a switch. */
  orcidEnabled: boolean;
  baseURL: string;
  issuer: string;
  audience: string;
  /** Lifetime of the identity token handed to the API (the Better Auth JWT plugin default is 15 minutes). */
  tokenLifetime: string;
  secureCookies: boolean;
  databaseUrl: string | null;
  emailProvider: "none" | "dev" | "ses";
  local: boolean;
  /** CHEMDFT_SIGNUP_OPEN=true: the owner's switch for self-service signup (ADR-045). Not enough on its own, see `signupBlockedReason`. */
  signupSwitch: boolean;
  /** Why the switch is ignored while it is on (no working email transport). Null when signup is open or the switch is off. */
  signupBlockedReason: string | null;
};

export class AuthConfigError extends Error {}

const AUTH_MODES: readonly string[] = ["dev", "jwt"];
const SIGNUP_MODES: readonly string[] = ["closed", "invite", "open", "google_only"];
const LAUNCH_STATES: readonly string[] = ["prelaunch", "public"];
const POSTGRES_URL = /^postgres(ql)?:\/\/\S+$/;
const DEFAULT_AUDIENCE = "chemdft-api";
const LOW_ENTROPY = /^(.)\1*$|change-?me|password|secret|example|placeholder|your[-_]?(key|secret)|test1234/i;

/**
 * Read and validate the authentication configuration from the environment. Pure: no I/O.
 * Unsafe combinations throw, so a misconfigured deployment fails at first use instead of serving.
 */
export function readAuthConfig(environment: Environment): AuthConfig {
  const local = isLocalEnvironment(environment);
  const authMode = (environment.CHEMDFT_AUTH_MODE ?? "dev").trim().toLowerCase();
  if (!AUTH_MODES.includes(authMode)) throw new AuthConfigError("CHEMDFT_AUTH_MODE must be dev or jwt.");
  const signupMode = (environment.CHEMDFT_SIGNUP_MODE ?? "closed").trim().toLowerCase();
  if (!SIGNUP_MODES.includes(signupMode)) throw new AuthConfigError("CHEMDFT_SIGNUP_MODE must be closed, invite or open.");

  const launchState = (environment.CHEMDFT_LAUNCH_STATE ?? "prelaunch").trim().toLowerCase();
  if (!LAUNCH_STATES.includes(launchState)) throw new AuthConfigError("CHEMDFT_LAUNCH_STATE must be prelaunch or public.");

  const baseURL = (environment.BETTER_AUTH_URL ?? (local ? "http://127.0.0.1:3000" : "")).replace(/\/+$/, "");
  const loopback = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseURL);
  // Hosted deployments are always served over HTTPS; only a loopback http origin may use plain cookies.
  const secureCookies = !(local && loopback);
  const emailProvider = (environment.CHEMDFT_EMAIL_PROVIDER ?? "none").trim().toLowerCase();
  if (emailProvider !== "none" && emailProvider !== "dev" && emailProvider !== "ses") {
    throw new AuthConfigError("CHEMDFT_EMAIL_PROVIDER supports only none or dev, or ses once its adapter is installed.");
  }
  const signupSwitch = (environment.CHEMDFT_SIGNUP_OPEN ?? "").trim().toLowerCase() === "true";

  const googleEnabled = Boolean(environment.GOOGLE_CLIENT_ID && environment.GOOGLE_CLIENT_SECRET);
  const rawCap = environment.CHEMDFT_BETA_USER_CAP ?? environment.CHEMDFT_SIGNUP_CAP;
  let betaUserCap: number | null = null;
  if (rawCap !== undefined && rawCap !== null) {
    const trimmed = rawCap.trim().toLowerCase();
    if (trimmed !== "" && trimmed !== "0" && trimmed !== "unlimited") {
      const parsed = parseInt(trimmed, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        betaUserCap = parsed;
      }
    }
  }
  const ownerEmails = (environment.CHEMDFT_OWNER_EMAIL ?? environment.CHEMDFT_BOOTSTRAP_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const googleSignupAllowed = (signupMode === "google_only" || (signupMode === "open" && launchState === "public")) && googleEnabled;

  const config: AuthConfig = {
    authMode: authMode as AuthMode,
    signupMode: signupMode as SignupMode,
    launchState: launchState as LaunchState,
    publicSignupEnabled: signupMode === "open" && launchState === "public",
    googleEnabled,
    googleSignupAllowed,
    betaUserCap,
    ownerEmails,
    orcidEnabled: (environment.CHEMDFT_ORCID_ENABLED ?? "").trim().toLowerCase() === "true",
    baseURL,
    issuer: (environment.CHEMDFT_AUTH_ISSUER ?? baseURL).replace(/\/+$/, ""),
    audience: environment.CHEMDFT_AUTH_AUDIENCE ?? DEFAULT_AUDIENCE,
    tokenLifetime: "15m",
    secureCookies,
    databaseUrl: environment.CHEMDFT_AUTH_DATABASE_URL ?? (local ? "file:./.chemdft/auth.db" : null),
    emailProvider: emailProvider as "none" | "dev" | "ses",
    local,
    signupSwitch,
    signupBlockedReason: null,
  };
  // The owner's switch fails CLOSED: it opens signup only when a transport that can really deliver the
  // verification email exists. A flipped switch with no provider never breaks sign-in; it just stays closed.
  if (signupSwitch) {
    if (emailProvider === "dev" && local) config.publicSignupEnabled = true;
    else if (emailProvider === "ses") config.signupBlockedReason = "The ses email adapter is not installed in this build.";
    else config.signupBlockedReason = "No production email provider is configured, so verification mail cannot be sent.";
  }

  // Signup is launch-aware, not host-aware: before launch no account can be created publicly; once the
  // owner sets the state to `public`, open signup is possible but only with working verification email.
  if (signupMode === "open" && launchState !== "public") {
    throw new AuthConfigError("CHEMDFT_SIGNUP_MODE=open is refused while CHEMDFT_LAUNCH_STATE=prelaunch (the default).");
  }
  if (signupMode === "open" && emailProvider === "none") {
    throw new AuthConfigError("Open signup needs an email provider for verification; none is configured.");
  }
  if (signupMode === "open" && !local) {
    throw new AuthConfigError("Open signup on a hosted deployment needs a production email provider, which is not available yet.");
  }
  if (emailProvider === "dev" && !local) {
    throw new AuthConfigError("The development email sink is refused outside an explicitly local environment.");
  }
  if (config.authMode === "dev") {
    if (!local) throw new AuthConfigError("CHEMDFT_AUTH_MODE=dev (the fixed development identity) only operates locally.");
    return config;
  }
  // jwt mode
  const secret = environment.BETTER_AUTH_SECRET ?? "";
  if (secret.length < 32 || LOW_ENTROPY.test(secret) || new Set(secret).size < 8) {
    throw new AuthConfigError("BETTER_AUTH_SECRET must be a random secret of at least 32 characters.");
  }
  if (!baseURL) throw new AuthConfigError("BETTER_AUTH_URL is required in jwt mode.");
  if (!local) {
    // A hosted deployment must never rely on a file, in-memory or other ephemeral database: serverless
    // filesystems disappear between executions and accounts would silently vanish.
    if (!config.databaseUrl) throw new AuthConfigError("CHEMDFT_AUTH_DATABASE_URL is required outside a local environment.");
    if (!POSTGRES_URL.test(config.databaseUrl)) {
      throw new AuthConfigError("Hosted authentication requires CHEMDFT_AUTH_DATABASE_URL to be an explicitly configured persistent PostgreSQL database; SQLite, file and in-memory databases are refused.");
    }
  }
  if (!config.databaseUrl) throw new AuthConfigError("CHEMDFT_AUTH_DATABASE_URL is required.");
  if (!local && !baseURL.startsWith("https://")) throw new AuthConfigError("BETTER_AUTH_URL must be https outside a local environment.");
  return config;
}

/** Features that need outbound email stay off until a transport exists. */
export function emailFeaturesEnabled(config: AuthConfig): boolean {
  return config.emailProvider === "dev";
}

/** Self-service signup (verification mandatory, quotas, terms). Only ever true when signup is open AND mail can be sent. */
export function selfServiceSignupEnabled(config: AuthConfig): boolean {
  return config.publicSignupEnabled && emailFeaturesEnabled(config);
}
