"use client";
import { useSyncExternalStore } from "react";
import { timestampDisplay } from "@/lib/timestamps";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function ScientificTimestamp({ value }: { value: string | null | undefined }) {
  const local = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const display = timestampDisplay(value, local ? undefined : "UTC");
  if (!display) return <span>Unavailable</span>;
  return <span className="scientific-timestamp"><time dateTime={display.utc} title={`UTC: ${display.utc}`}>
    {display.local} ({local ? "local" : "UTC"} · {display.zone})
  </time><small>UTC: {display.utc}</small></span>;
}
