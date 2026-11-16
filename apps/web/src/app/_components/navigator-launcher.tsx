"use client";

import { useEffect, useRef, useState } from "react";
import type { NavigatorTarget } from "@chemdft/schemas";
import { useLocale } from "next-intl";
import { defaultLocale, isLocale } from "@chemdft/i18n";
import { navigatorMessage } from "@/lib/navigator-messages";
import { getNavigator, isAbortError, type NavigatorGoalId } from "@/lib/navigator-api";

/** Re-read authoritative guidance before adapting a durable link to existing UI. */
export function NavigatorLauncher({ projectId, onLaunch }: {
  projectId: string; onLaunch: (target: NavigatorTarget) => void | Promise<void>;
}) {
  const currentLocale = useLocale();
  const locale = isLocale(currentLocale) ? currentLocale : defaultLocale;
  const [unavailable, setUnavailable] = useState(false);
  const callbacks = useRef({ onLaunch });
  useEffect(() => { callbacks.current = { onLaunch }; }, [onLaunch]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const actionId = params.get("navigator_action");
    if (!actionId) return;
    const controller = new AbortController();
    let active = true;
    void getNavigator(projectId, {
      goal: (params.get("navigator_goal") || undefined) as NavigatorGoalId | undefined,
      structureVersionId: params.get("navigator_version") || undefined,
      signal: controller.signal,
    }).then(async state => {
      if (!active) return;
      const action = state.next.find(item => item.action_id === actionId);
      if (!action?.target) { setUnavailable(true); return; }
      await callbacks.current.onLaunch(action.target);
    }).catch((cause: unknown) => {
      if (isAbortError(cause)) return;
      if (active) setUnavailable(true);
    });
    return () => { active = false; controller.abort(); };
  }, [projectId]);
  return unavailable ? <p className="foundation-strip" role="status">{navigatorMessage(locale, "launchUnavailable")}</p> : null;
}
