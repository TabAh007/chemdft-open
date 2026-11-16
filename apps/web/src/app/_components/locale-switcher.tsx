import { localeNames, locales, type Locale } from "@chemdft/i18n";
import Link from "next/link";

/** Only these languages have content that is ready; the others are shown but cannot be opened. */
const ACTIVE_LOCALES: readonly Locale[] = ["en"];
/** The single "coming soon" string for every language that is not active yet; shown as visible text. */
export const COMING_SOON = "Coming soon";

export function LocaleSwitcher({ locale }: { locale: Locale }) {
  const active = locales.filter((candidate) => ACTIVE_LOCALES.includes(candidate));
  const soon = locales.filter((candidate) => !ACTIVE_LOCALES.includes(candidate));
  return (
    <nav className="locale-switcher" aria-label="Language">
      {active.map((candidate) => (
        <Link key={candidate} href={`/${candidate}`} aria-current={candidate === locale ? "page" : undefined} title={localeNames[candidate]}>
          {candidate.toUpperCase()}
        </Link>
      ))}
      <span className="locale-soon-group">
        {soon.map((candidate) => (
          <span
            key={candidate}
            role="link"
            aria-disabled="true"
            aria-current={candidate === locale ? "page" : undefined}
            aria-label={`${localeNames[candidate]}, ${COMING_SOON.toLowerCase()}`}
            className="locale-soon"
            data-soon={COMING_SOON}
            title={COMING_SOON}
            tabIndex={0}
            data-testid={`locale-${candidate}`}
          >
            {candidate.toUpperCase()}
          </span>
        ))}
        <span className="locale-soon-note" data-testid="locale-soon-note">{COMING_SOON}: TR, RU, DE</span>
      </span>
    </nav>
  );
}
