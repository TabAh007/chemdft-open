import { ActionButton, AppIcon, type IconName } from "@chemdft/ui";
import Link from "next/link";
import type { ReactNode } from "react";

export function StatePage({
  code,
  title,
  description,
  actionHref = "/en",
  actionLabel = "Return home",
  icon = "warning-sign",
  onRetry,
  details,
}: {
  code: string;
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
  icon?: IconName;
  onRetry?: () => void;
  details?: ReactNode;
}) {
  return (
    <main id="main-content" className="state-page">
      <div className="state-code" aria-hidden="true">
        {code}
      </div>
      <div className="state-copy">
        <AppIcon icon={icon} />
        <h1>{title}</h1>
        <p>{description}</p>
        {onRetry ? (
          <ActionButton intent="primary" onClick={onRetry} text={actionLabel} />
        ) : (
          <Link className="bp6-button bp6-intent-primary" href={actionHref}>
            {actionLabel}
          </Link>
        )}
        {details}
      </div>
    </main>
  );
}
