"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Locale } from "@chemdft/i18n";
import { useSession } from "../home/header-actions";
import { copyExample } from "@/lib/examples-api";
import { exampleMessage } from "@/lib/example-messages";
import styles from "./examples.module.css";

export function ExampleCopyAction({
  slug,
  locale,
}: {
  slug: string;
  locale: Locale;
}) {
  const session = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = (key: string) => exampleMessage(locale, key);
  async function copy() {
    setBusy(true);
    setError(null);
    try {
      const result = await copyExample(slug);
      router.push(`/${locale}/projects/${result.project_id}/overview`);
    } catch (error) {
      setError(error instanceof Error ? error.message : t("unavailable"));
      setBusy(false);
    }
  }
  return (
    <div className={styles.copy}>
      {session === "signed-out" ? (
        <Link
          className="bp6-button bp6-intent-primary"
          href={`/${locale}/login?next=${encodeURIComponent(`/${locale}/examples/${slug}`)}`}
        >
          {t("signIn")}
        </Link>
      ) : (
        <button
          className="bp6-button bp6-intent-primary"
          type="button"
          onClick={() => void copy()}
          disabled={busy}
          aria-busy={busy}
        >
          {t(busy ? "copying" : "copy")}
        </button>
      )}
      <p>{t("copyNote")}</p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
