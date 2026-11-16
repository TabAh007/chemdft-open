"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Mounted tabs retain local controls/camera; each panel owns its scroll position. */
export function WorkbenchPanel({ active, panelKey, children }: { active: boolean; panelKey: string; children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState(active);
  useEffect(() => {
    if (active && !opened) queueMicrotask(() => setOpened(true));
  }, [active, opened]);
  useLayoutEffect(() => {
    if (!active || !opened || !host.current) return;
    const panel = host.current;
    const saved = Number(sessionStorage.getItem(`chemdft:tab-scroll:${panelKey}`) ?? 0);
    panel.scrollTop = Number.isFinite(saved) && saved >= 0 ? saved : 0;
    const focus = () => { panel.focus({ preventScroll: true }); };
    window.addEventListener("chemdft:workbench-activated", focus);
    return () => window.removeEventListener("chemdft:workbench-activated", focus);
  }, [active, panelKey, opened]);
  return <div ref={host} className="workbench-panel" hidden={!active} role="tabpanel" tabIndex={-1}
    aria-label={panelKey.endsWith(":project") ? "Project workbench" : "Active record workbench"}
    onScroll={event => { if (active) sessionStorage.setItem(`chemdft:tab-scroll:${panelKey}`, String(event.currentTarget.scrollTop)); }}>
    {opened ? children : null}
  </div>;
}
