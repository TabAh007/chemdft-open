import Link from "next/link";
import type { Locale } from "@chemdft/i18n";

import { licenceForCard, LICENCE_NOT_RECORDED, ZENODO_CONCEPT_DOI, ZENODO_SNAPSHOT_DOI } from "../../../content/license";
import { ENGINE_SECTIONS, ENGINE_STATUS_LABEL, NOT_YET, PLATFORM_NOW, type EngineCardData } from "./content";


/** A status is always written as text with a symbol, never colour alone. */
function StatusBadge({ status }: { status: EngineCardData["status"] }) {
  return (
    <span className="engine-badge" data-status={status}>
      <span aria-hidden="true">{status === "available" ? "●" : "○"}</span> {ENGINE_STATUS_LABEL[status]}
    </span>
  );
}

function EngineCard({ card }: { card: EngineCardData }) {
  const muted = card.status !== "available";
  return (
    <li className="engine-card" data-status={card.status} data-testid="engine-card">
      <div className="engine-card-head">
        <h4>{card.name}</h4>
        <StatusBadge status={card.status} />
      </div>
      <p className="engine-role">{card.role}</p>
      {card.version ? <p className="engine-version mono">Version {card.version}</p> : null}
      <p className="engine-licence" data-recorded={licenceForCard(card.name) !== LICENCE_NOT_RECORDED}>
        Licence: {licenceForCard(card.name)}
      </p>
      {muted ? (
        <p className="engine-reason">{card.reason}</p>
      ) : (
        <ul className="engine-lines">
          {card.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** The Engines section: always fully visible (no disclosure), one card per engine, grouped by job. */
export function Engines({ locale }: { locale: Locale }) {
  return (
    <section className="engines" id="engines" aria-labelledby="engines-title">
      <header className="engines-head">
        <p className="eyebrow">What runs your calculation</p>
        <h2 id="engines-title">Engines</h2>
        <p className="engines-lede">
          ChemDFT calls these projects; it does not reimplement them, and none of them endorse it. Not every engine supports every workflow, and
          limits below are those of the hosted worker.
        </p>
      </header>
      {ENGINE_SECTIONS.map((section) => (
        <section key={section.id} className="engine-group" data-group={section.id} aria-labelledby={`engines-${section.id}`}>
          <h3 id={`engines-${section.id}`}>{section.title}</h3>
          <ul className="engine-cards">
            {section.cards.map((card) => (
              <EngineCard key={card.name} card={card} />
            ))}
          </ul>
        </section>
      ))}
      <section className="engine-group" aria-labelledby="engines-limits">
        <h3 id="engines-limits">Other limits</h3>
        <ul className="engine-limits">
          {NOT_YET.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section className="engine-group" aria-labelledby="engines-also">
        <h3 id="engines-also">Also available</h3>
        <ul className="engine-also">
          {PLATFORM_NOW.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <p className="engines-proof">
        Each release lists what was and was not verified, and on which platform, in the <Link href={`/${locale}/releases`}>release notes</Link>. A stored
        run record is shown under <a href="#reproducibility">Reproducibility</a>. The one measured agreement check is on the <Link href={`/${locale}/validation`}>Validation</Link> page. The open-core source snapshot for release 0.0.52 is on Zenodo,{" "}
        <a href={`https://doi.org/${ZENODO_SNAPSHOT_DOI}`} rel="noopener noreferrer">DOI {ZENODO_SNAPSHOT_DOI}</a> (all versions:{" "}
        <a href={`https://doi.org/${ZENODO_CONCEPT_DOI}`} rel="noopener noreferrer">DOI {ZENODO_CONCEPT_DOI}</a>); it does not by itself verify any scientific result.
      </p>
    </section>
  );
}
