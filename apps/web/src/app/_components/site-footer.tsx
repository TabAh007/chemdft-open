import Link from "next/link";
import type { ReactNode } from "react";

import { LATEST_VERSION } from "../../content/releases";
import { GITHUB_URL } from "../../content/license";
import "./site-footer.css";

/**
 * The footer of the landing page and every public page: "ChemDFT v<latest> · Release notes · How to cite · License", plus a
 * GitHub link only when the repository is public (`GITHUB_URL`, content/license.ts, is null while it is private).
 * `lead` carries a page's own links (the landing page keeps Sign in, What works today, Explore examples).
 */
export function SiteFooter({ locale, lead, note, className = "" }: { locale: string; lead?: ReactNode; note?: ReactNode; className?: string }) {
  return (
    <footer className={`${className.includes("home-footer") ? "" : "site-footer"} ${className}`.trim()} data-testid="site-footer">
      <p className="site-footer-version">
        <span>ChemDFT</span> <a href={`/${locale}/releases#${LATEST_VERSION}`} data-testid="footer-version">v{LATEST_VERSION}</a>
      </p>
      {note ? <p className="site-footer-note">{note}</p> : null}
      <nav aria-label="Calculation Guides" className="site-footer-guides">
        <Link href={`/${locale}/dft-calculations`}>DFT calculations</Link>
        <Link href={`/${locale}/gaussian-alternative`}>Gaussian alternative</Link>
        <Link href={`/${locale}/homo-lumo-calculator`}>HOMO-LUMO calculator</Link>
        <Link href={`/${locale}/pyscf-online`}>PySCF online</Link>
        <Link href={`/${locale}/quantum-espresso-online`}>Quantum ESPRESSO online</Link>
        <Link href={`/${locale}/webmo-alternative`}>WebMO alternative</Link>
        <Link href={`/${locale}/xtb-online`}>xTB online</Link>
        <Link href={`/${locale}/crest-conformer-search-online`}>CREST conformer search online</Link>
      </nav>
      <nav aria-label="Footer">
        {lead}
        <Link href={`/${locale}/releases`}>Release notes</Link>
        <Link href={`/${locale}/learn/cite`}>How to cite</Link>
        <Link href={`/${locale}/principles`}>Principles</Link>
        <Link href={`/${locale}/validation`}>Validation</Link>
        <Link href={`/${locale}/cost-and-support`}>Cost and support</Link>
        <Link href={`/${locale}/license`}>License</Link>
        <Link href={`/${locale}/terms`}>Terms</Link>
        <Link href={`/${locale}/privacy`}>Privacy</Link>
        <Link href={`/${locale}/beta`}>Beta notice</Link>
        <Link href={`/${locale}/contact`}>Contact</Link>
        {GITHUB_URL ? <a href={GITHUB_URL} rel="noopener noreferrer">GitHub</a> : null}
      </nav>
    </footer>
  );
}
