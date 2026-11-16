import type { Locale } from "@chemdft/i18n";
import Link from "next/link";

import { OPEN_CORE_STATEMENT, THIRD_PARTY } from "../../../content/license";

/** The compact Licences section: ChemDFT's own licence, the third-party count and a link to the full table. */
export function Licences({ locale }: { locale: Locale }) {
  return (
    <section className="licences" id="licences" aria-labelledby="licences-title">
      <p className="eyebrow">Licence</p>
      <h2 id="licences-title">Licences</h2>
      <p className="licences-statement" data-testid="open-core-statement">{OPEN_CORE_STATEMENT}</p>
      <p className="licences-count">
        ChemDFT calls {THIRD_PARTY.length} third-party engines and libraries and does not reimplement them; each stays under its own licence, and some licences are not
        yet recorded.{" "}
        <Link href={`/${locale}/license#third-party`}>See the full licence table</Link>
      </p>
    </section>
  );
}
