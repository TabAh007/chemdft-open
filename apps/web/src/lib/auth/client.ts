"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser-side Better Auth client. Same-origin (no baseURL), cookie-based: the browser only ever holds
 * the HttpOnly session cookie. It never requests, receives or stores an API token.
 */
export const authClient = createAuthClient();
