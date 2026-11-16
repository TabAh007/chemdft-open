/**
 * Which kind of environment this process runs in. The fixed development identity and open signup
 * are only ever acceptable in an explicitly local one. Keep the marker list in step with
 * `HOSTED_ENVIRONMENT_MARKERS` in services/api/src/chemdft_api/auth.py.
 */
export const LOCAL_ENVIRONMENTS = ["local", "development", "test"] as const;

export const HOSTED_ENVIRONMENT_MARKERS = [
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "AWS_LAMBDA_FUNCTION_NAME",
  "K_SERVICE",
  "FLY_APP_NAME",
  "RENDER",
  "RAILWAY_ENVIRONMENT",
  "DYNO",
] as const;

export type Environment = Readonly<Record<string, string | undefined>>;

export function isHostedEnvironment(environment: Environment): boolean {
  return HOSTED_ENVIRONMENT_MARKERS.some((name) => Boolean(environment[name]));
}

/** True only for an explicitly local environment: a local CHEMDFT_ENV (default "development") and no hosted marker. */
export function isLocalEnvironment(environment: Environment): boolean {
  const declared = (environment.CHEMDFT_ENV ?? "development").trim().toLowerCase();
  return (LOCAL_ENVIRONMENTS as readonly string[]).includes(declared) && !isHostedEnvironment(environment);
}
