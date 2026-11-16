"use client";

import { AppIcon } from "@chemdft/ui";
import Link from "next/link";
import { useEffect, useState } from "react";

import { initialsOf } from "../../../lib/settings-model";

type Me = { display_name: string; email: string; organization: { name: string } };
type State = { status: "loading" } | { status: "failed" } | { status: "ready"; me: Me };

/**
 * The signed-in person's initials from `/v1/me`, always a link to the Account page. Nothing is drawn
 * while the server has not answered, and never a placeholder name; if the identity cannot be read (or has
 * no usable name) a neutral person icon titled "Account" keeps the way to the account reachable.
 */
export function HeaderIdentity({ locale, current = false }: { locale: string; current?: boolean }) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/chemdft/v1/me", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<Me>) : null))
      .then((value) => { if (!cancelled) setState(value ? { status: "ready", me: value } : { status: "failed" }); })
      .catch(() => { if (!cancelled) setState({ status: "failed" }); });
    return () => { cancelled = true; };
  }, []);
  if (state.status === "loading") return null;
  const href = `/${locale}/account`;
  const initials = state.status === "ready" ? initialsOf(state.me.display_name) : null;
  if (state.status === "ready" && initials) {
    const { me } = state;
    return <Link href={href} className="avatar header-identity" aria-label={`Signed in as ${me.display_name}`} title={`${me.display_name} · ${me.email} · ${me.organization.name}`} data-testid="header-identity" aria-current={current ? "page" : undefined}>{initials}</Link>;
  }
  return <Link href={href} className="avatar header-identity header-identity-fallback" aria-label="Account" title="Account" data-testid="header-identity" aria-current={current ? "page" : undefined}><AppIcon icon="user" /></Link>;
}
