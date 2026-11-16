"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { defaultLocale, isLocale } from "@chemdft/i18n";
import { AppIcon, AppPopover, PopupKind } from "@chemdft/ui";
import { helpHref, helpTopic, type HelpTopicId } from "@/lib/help-topics";
import { helpUi } from "@/lib/help-messages";
import styles from "./help.module.css";

export function HelpTip({ topic }: { topic: HelpTopicId }) {
  const candidate = useLocale();
  const locale = isLocale(candidate) ? candidate : defaultLocale;
  const [open, setOpen] = useState(false);
  const [returnTo, setReturnTo] = useState<string>();
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const copy = helpTopic(locale, topic);
  useEffect(() => {
    if (!open) return;
    // Escape also works after tabbing out: help never traps keyboard focus.
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  return (
    <AppPopover
      interactionKind="click"
      popupKind={PopupKind.DIALOG}
      placement="bottom-start"
      isOpen={open}
      onInteraction={(next) => {
        if (next)
          setReturnTo(`${window.location.pathname}${window.location.search}`);
        setOpen(next);
      }}
      autoFocus
      enforceFocus={false}
      canEscapeKeyClose
      shouldReturnFocusOnClose
      arrow={false}
      transitionDuration={0}
      popoverClassName={styles.popover ?? ""}
      onOpened={(node) =>
        node
          .querySelector<HTMLElement>("[data-help-panel]")
          ?.focus({ preventScroll: true })
      }
      content={
        <section
          className={styles.panel}
          role="dialog"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-body`}
          tabIndex={-1}
          data-help-panel
          data-help-topic={topic}
        >
          <div className={styles.heading}>
            <h2 id={`${id}-title`}>{copy.title}</h2>
            <button
              type="button"
              className={`bp6-button bp6-minimal ${styles.close}`}
              aria-label={helpUi(locale, "close")}
              onClick={() => setOpen(false)}
            >
              <AppIcon icon="cross" />
            </button>
          </div>
          <p id={`${id}-body`}>{copy.summary}</p>
          <Link href={helpHref(locale, topic, returnTo)}>
            {helpUi(locale, "more")}
          </Link>
        </section>
      }
    >
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label={`${helpUi(locale, "help")}: ${copy.title}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-help-trigger={topic}
      >
        <AppIcon icon="help" />
      </button>
    </AppPopover>
  );
}
