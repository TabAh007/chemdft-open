"use client";

import type { ReactNode } from "react";

import { SessionProvider, type AuthMode } from "./header-actions";
import { StageProvider } from "./stage";

/** Client-side state the public page shares: the session (for the primary action) and the 3D stage. */
export function HomeShell({ authMode, children }: { authMode: AuthMode; children: ReactNode }) {
  return (
    <SessionProvider authMode={authMode}>
      <StageProvider>{children}</StageProvider>
    </SessionProvider>
  );
}
