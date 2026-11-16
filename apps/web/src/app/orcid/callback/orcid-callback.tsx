"use client";

import { useEffect, useRef, useState } from "react";

import { completeOrcidLink, orcidFlowOf, plainOrcidError, OrcidApiError } from "../../../lib/orcid";

const LOCALE = "en";

/** The server already validated `next` (same-origin application paths only); repeated here so the browser never follows anything else. */
function safeNext(candidate: string | undefined): string {
  const fallback = `/${LOCALE}/projects`;
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return fallback;
  return /^\/(en|tr|ru|de)\/(?!login)/.test(candidate) ? candidate : fallback;
}

export function OrcidCallback() {
  const started = useRef(false);
  const [state, setState] = useState<{ kind: "working" } | { kind: "failed"; text: string; back: string }>({ kind: "working" });

  useEffect(() => {
    if (started.current) return; // React strict mode runs effects twice; a code is single use
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const stateValue = params.get("state");
    const denied = params.get("error");
    window.history.replaceState(null, "", window.location.pathname); // the code and state never stay in the address bar
    const flow = orcidFlowOf(stateValue);
    const back = flow === "signin" ? `/${LOCALE}/login` : `/${LOCALE}/settings/general`;
    const fail = (text: string) => setState({ kind: "failed", text, back });
    if (denied) return fail(plainOrcidError(denied === "access_denied" ? "access_denied" : "orcid_failed"));
    if (!flow || !code || !stateValue) return fail(plainOrcidError("state_invalid"));
    if (flow === "link") {
      completeOrcidLink(code, stateValue)
        .then(() => window.location.replace(`/${LOCALE}/settings/general?orcid=linked`))
        .catch((cause) => fail(plainOrcidError(cause instanceof OrcidApiError ? cause.code : "orcid_failed")));
      return;
    }
    fetch("/api/auth/orcid/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, state: stateValue }) })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as { ok?: boolean; code?: string; next?: string };
        if (response.ok && body.ok) window.location.replace(safeNext(body.next));
        else fail(plainOrcidError(body.code ?? "orcid_failed"));
      })
      .catch(() => fail(plainOrcidError("orcid_unavailable")));
  }, []);

  if (state.kind === "working") return <p role="status" data-testid="orcid-working">Confirming your ORCID iD… You will be sent back automatically.</p>;
  return (
    <>
      <p role="alert" className="auth-error" data-testid="orcid-callback-error">{state.text}</p>
      <p><a href={state.back}>Back to ChemDFT</a></p>
    </>
  );
}
