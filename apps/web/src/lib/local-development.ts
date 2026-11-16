/**
 * Whether this web server runs the explicitly local development stack. Server-side only: it reads process.env, and the same rule
 * decides the "Development identity" chip on the Projects page (`_components/product-header.tsx`). The API applies its own gate
 * (`dev_identity_permitted`) before it ever offers a local test provider; this is the UI's second check, not a replacement.
 */
export function authModeFromEnv(env: Record<string, string | undefined> = process.env): "jwt" | "dev" {
  return env.CHEMDFT_AUTH_MODE?.trim().toLowerCase() === "jwt" ? "jwt" : "dev";
}

export function isLocalDevelopment(env: Record<string, string | undefined> = process.env): boolean {
  return authModeFromEnv(env) === "dev" && env.CHEMDFT_DEV_IDENTITY_ENABLED === "true" && env.NODE_ENV !== "production";
}
