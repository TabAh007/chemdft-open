"use client";

import { createContext, useContext, type ReactNode } from "react";

const LocalDevelopmentContext = createContext(false);

/** Carries the server's `isLocalDevelopment()` answer to client components. Absent provider means: not local development. */
export function LocalDevelopmentProvider({ value, children }: { value: boolean; children?: ReactNode }) {
  return <LocalDevelopmentContext.Provider value={value}>{children}</LocalDevelopmentContext.Provider>;
}

export function useLocalDevelopment(): boolean {
  return useContext(LocalDevelopmentContext);
}
