"use client";

import type { Locale } from "@chemdft/i18n";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { BrandMark } from "../brand-mark";
import { HeaderActions, useSession } from "./header-actions";
import { LocaleSwitcher } from "../locale-switcher";

/** Visible in the bar from the collapse breakpoint up. Hash links stay on the home page; `path` links go to a page. */
const PRIMARY = [
  { kind: "hash", href: "#how-it-works", label: "How it works" },
  { kind: "hash", href: "#engines", label: "Engines" },
  { kind: "hash", href: "#workstation", label: "Workstation" },
  /** The formal name, "Scientific Result Firewall", stays in the page content; the bar uses a plain label. */
  { kind: "hash", href: "#result-firewall", label: "Result checks" },
  { kind: "path", href: "learn", label: "Learn" },
  { kind: "path", href: "releases", label: "Releases" },
] as const;
const MORE = [
  { kind: "hash", href: "#reproducibility", label: "Reproducibility" },
  { kind: "path", href: "contact", label: "Contact" },
] as const;

type Item = (typeof PRIMARY)[number] | (typeof MORE)[number];

function NavLink({ item, locale, onClick }: { item: Item; locale: Locale; onClick?: () => void }) {
  const handlers = onClick ? { onClick } : {};
  if (item.kind === "hash") {
    return (
      <a href={item.href} {...handlers}>
        {item.label}
      </a>
    );
  }
  return (
    <Link href={`/${locale}/${item.href}`} {...handlers}>
      {item.label}
    </Link>
  );
}

/** "More" disclosure: button + list of links; closes on Escape (focus returns to the button), outside click and after a choice. */
export function MoreMenu({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: MouseEvent | TouchEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [open]);

  return (
    <div className="home-more" ref={root} onBlur={(event) => { if (open && !root.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
      <button ref={button} type="button" className="home-more-button" aria-expanded={open} aria-haspopup="true" aria-controls={id} onClick={() => setOpen((value) => !value)}>
        More
        <span aria-hidden="true" className="home-more-caret" />
      </button>
      {open ? (
        <ul id={id} className="home-more-list" aria-label="More pages">
          {MORE.map((item) => (
            <li key={item.href}>
              <NavLink item={item} locale={locale} onClick={() => setOpen(false)} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function HomeHeader({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const session = useSession();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="home-header">
      <Link href={`/${locale}`} className="header-brand" aria-label="ChemDFT home">
        <BrandMark />
      </Link>
      {/* The links, the More menu and the actions are ONE flex row: nothing is positioned separately, so items cannot paint over each other. */}
      <nav className="home-nav" aria-label="Primary">
        {PRIMARY.map((item) => (
          <NavLink key={item.href} item={item} locale={locale} />
        ))}
        <MoreMenu locale={locale} />
      </nav>
      <div className="home-header-end">
        <HeaderActions locale={locale} />
        <LocaleSwitcher locale={locale} />
        <button ref={toggle} type="button" className="home-menu-button" aria-expanded={open} aria-controls="home-mobile-menu" onClick={() => setOpen((value) => !value)}>
          {open ? "Close" : "Menu"}
        </button>
      </div>
      {open ? (
        <nav id="home-mobile-menu" className="home-mobile-menu" aria-label="Primary (mobile)">
          {[...PRIMARY, ...MORE].map((item) => (
            <NavLink key={item.href} item={item} locale={locale} onClick={() => setOpen(false)} />
          ))}
          {session === "signed-in" ? <Link href={`/${locale}/account`} onClick={() => setOpen(false)}>Account</Link> : null}
        </nav>
      ) : null}
    </header>
  );
}
