"use client";

import { createContext, createElement, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { EngineCapabilityView } from "@chemdft/schemas";
import { listCalculationCapabilities } from "./structure-workspace-api";

export const CAPABILITY_CACHE_TTL_MS = 60_000;
const empty = { capabilities: [] as EngineCapabilityView[], loading: false, error: null as string | null, timestamp: null as number | null };
const expired = { ...empty, error: "Engine capabilities expired. Refresh availability before submitting." };

/** Each mounted workspace owns this resource; nothing survives a workspace/session remount. */
export function createCapabilitiesResource() {
  const entries = new Map<string, { snapshot: typeof empty; inFlight: Promise<EngineCapabilityView[]> | null }>();
  const listeners = new Set<() => void>();
  function entry(projectId: string) {
    let value = entries.get(projectId);
    if (!value) { value = { snapshot: empty, inFlight: null }; entries.set(projectId, value); }
    return value;
  }
  function publish(projectId: string, snapshot: typeof empty) {
    entry(projectId).snapshot = snapshot;
    listeners.forEach((listener) => listener());
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot(projectId: string) {
      const state = entry(projectId).snapshot;
      return state.timestamp !== null && Date.now() - state.timestamp >= CAPABILITY_CACHE_TTL_MS ? expired : state;
    },
    async get(projectId: string, options?: { force?: boolean }): Promise<EngineCapabilityView[]> {
      const value = entry(projectId);
      if (value.inFlight) return value.inFlight;
      const previous = value.snapshot;
      if (!options?.force) {
        // Errors fail closed until an explicit retry, including after the positive TTL.
        if (previous.error) throw new Error(previous.error);
        if (previous.timestamp !== null && Date.now() - previous.timestamp < CAPABILITY_CACHE_TTL_MS) return previous.capabilities;
      }
      publish(projectId, { ...empty, loading: true });
      value.inFlight = listCalculationCapabilities(projectId).then((capabilities) => {
        publish(projectId, { capabilities, timestamp: Date.now(), loading: false, error: null });
        return capabilities;
      }).catch((cause: unknown) => {
        publish(projectId, { ...empty, error: cause instanceof Error ? cause.message : "Engine capabilities unavailable." });
        throw cause;
      }).finally(() => { value.inFlight = null; });
      return value.inFlight;
    },
  };
}

const CapabilityContext = createContext<ReturnType<typeof createCapabilitiesResource> | null>(null);
export function CalculationCapabilitiesProvider({ children }: { children: ReactNode }) {
  const [resource] = useState(createCapabilitiesResource);
  return createElement(CapabilityContext.Provider, { value: resource }, children);
}

export function useCalculationCapabilities(projectId: string) {
  const owned = useContext(CapabilityContext);
  const [fallback] = useState(createCapabilitiesResource);
  const resource = owned ?? fallback;
  const state = useSyncExternalStore(resource.subscribe, () => resource.snapshot(projectId), () => empty);
  useEffect(() => {
    if (projectId) void resource.get(projectId).catch(() => {});
  }, [resource, projectId]);
  // F-012: an expired cache refreshes by itself, shortly before and right after the TTL, so the
  // researcher never sees "refresh required" or loses a Run click to it.
  const isExpired = Boolean(state.error?.includes("expired"));
  useEffect(() => {
    if (!projectId) return;
    if (isExpired) { void resource.get(projectId, { force: true }).catch(() => {}); return; }
    if (state.timestamp === null || state.error) return;
    const wait = Math.max(1_000, state.timestamp + CAPABILITY_CACHE_TTL_MS - Date.now() - 5_000);
    const timer = setTimeout(() => void resource.get(projectId, { force: true }).catch(() => {}), wait);
    return () => clearTimeout(timer);
  }, [resource, projectId, isExpired, state.timestamp, state.error]);
  const capabilities = state.error || state.loading || state.timestamp === null ? [] : state.capabilities;
  return {
    capabilities, loading: state.loading || state.timestamp === null && !state.error, error: state.error,
    refresh: () => resource.get(projectId, { force: true }),
    pyscfCapability: capabilities.find((c) => c.engine === "pyscf"),
    xtbCapability: capabilities.find((c) => c.engine === "xtb"),
    psi4Capability: capabilities.find((c) => c.engine === "psi4"),
  };
}
