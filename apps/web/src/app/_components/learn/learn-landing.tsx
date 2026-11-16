"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppIcon } from "@chemdft/ui";

import type { Locale } from "@chemdft/i18n";
import { helpHref, type HelpTopicId } from "@/lib/help-topics";
import {
  highlightSegments,
  queryTokens,
  searchLearn,
  type Guide,
  type LearnCategory,
  type LearnCategoryId,
  type SearchEntry,
  type SearchHit,
} from "@/lib/learn-content";
import styles from "./learn-page.module.css";

export type LandingTopic = { id: HelpTopicId; title: string };
export type LandingCategory = LearnCategory & { topicRows: LandingTopic[]; thumb: ReactNode; schematic: boolean };
export type LandingGuide = Pick<Guide, "id" | "accent" | "title" | "summary"> & { number: string; art: ReactNode };
export type LandingResource = { href: string; title: string; description: string; icon: "cube" | "compass" | "folder-open" | "shield" };

const SUGGESTIONS = ["basis sets", "HOMO", "infrared", "charge", "provenance", "unit cell"];

function Marked({ text, tokens }: { text: string; tokens: readonly string[] }) {
  return (
    <>
      {highlightSegments(text, tokens).map((part, i) => (part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>))}
    </>
  );
}

function hrefFor(locale: Locale, entry: SearchEntry): string {
  return entry.kind === "topic" ? helpHref(locale, entry.id as HelpTopicId) : `/${locale}/learn/${entry.path}`;
}

export function LearnLanding({
  locale,
  initialQuery,
  index,
  categories,
  guides,
  resources,
  figure,
}: {
  locale: Locale;
  initialQuery: string;
  index: SearchEntry[];
  categories: LandingCategory[];
  guides: LandingGuide[];
  resources: LandingResource[];
  figure: ReactNode;
}) {
  // The address is the source of truth after navigation: coming Back from an article restores the same search.
  const fromAddress = useSearchParams().get("q");
  const [query, setQuery] = useState(() => (fromAddress ?? initialQuery).slice(0, 80));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trimmed = query.trim();
  const hits = useMemo(() => searchLearn(index, query), [index, query]);
  const tokens = useMemo(() => queryTokens(query), [query]);

  function update(next: string) {
    setQuery(next);
    // Keep the address in step so Back from an article returns to the same results (no navigation, no history entry).
    const url = new URL(window.location.href);
    if (next.trim()) url.searchParams.set("q", next);
    else url.searchParams.delete("q");
    window.history.replaceState(window.history.state, "", url);
  }

  const groups = useMemo(() => {
    const order: Array<LearnCategoryId | "getting-started"> = ["structure", "calculation", "spectra", "integrity", "getting-started"];
    return order
      .map((id) => ({ id, hits: hits.filter((hit) => hit.entry.categoryId === id) }))
      .filter((group) => group.hits.length > 0);
  }, [hits]);

  return (
    <main id="main-content" className={styles.main} data-searching={trimmed ? "true" : "false"}>
      <section className={styles.hero} aria-labelledby="learn-title">
        <div className={styles.heroText}>
          <h1 id="learn-title">Learn ChemDFT</h1>
          <p className={styles.lead}>
            Understand computational chemistry, prepare calculations, interpret scientific results, and learn how to use ChemDFT.
          </p>
          <form className={styles.search} role="search" onSubmit={(event) => event.preventDefault()}>
            <label htmlFor="learn-search">
              <span className={styles.visuallyHidden}>Search the Learn library</span>
            </label>
            <AppIcon icon="search" />
            <input
              ref={inputRef}
              id="learn-search"
              type="search"
              className="bp6-input"
              placeholder="Search concepts, methods, basis sets, spectra, workflows…"
              value={query}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => update(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  update("");
                }
              }}
            />
            {query ? (
              <button
                type="button"
                className={styles.clear}
                aria-label="Clear search"
                onClick={() => {
                  update("");
                  inputRef.current?.focus();
                }}
              >
                <AppIcon icon="cross" />
              </button>
            ) : null}
          </form>
          <p className={styles.visuallyHidden} role="status" aria-live="polite">
            {trimmed ? `${hits.length} result${hits.length === 1 ? "" : "s"} for ${trimmed}` : ""}
          </p>
        </div>
        <div className={styles.figure}>{figure}</div>
      </section>

      {trimmed ? (
        <section className={styles.results} aria-label="Search results">
          {groups.length === 0 ? (
            <div className={styles.empty}>
              <h2>No topics match “{trimmed}”</h2>
              <p>Search covers the Learn titles, categories, keywords and article text. Try a broader word, or one of these:</p>
              <ul className={styles.chips}>
                {SUGGESTIONS.map((suggestion) => (
                  <li key={suggestion}>
                    <button type="button" onClick={() => update(suggestion)}>
                      {suggestion}
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="bp6-button" onClick={() => update("")}>
                Clear search and browse all topics
              </button>
            </div>
          ) : (
            groups.map((group) => {
              const label = group.id === "getting-started" ? "Getting started" : categories.find((category) => category.id === group.id)!.title;
              const accent = group.id === "getting-started" ? "blue" : categories.find((category) => category.id === group.id)!.accent;
              return (
                <div key={group.id} className={styles.resultGroup} data-accent={accent}>
                  <h2>
                    {label} <span>{group.hits.length}</span>
                  </h2>
                  <ul>
                    {group.hits.map((hit: SearchHit) => (
                      <li key={hit.entry.id}>
                        <Link href={hrefFor(locale, hit.entry)} data-learn-result={hit.entry.id}>
                          <span className={styles.resultTitle}>
                            <Marked text={hit.entry.title} tokens={tokens} />
                          </span>
                          <span className={styles.resultSummary}>
                            <Marked text={hit.excerpt ?? hit.entry.summary} tokens={tokens} />
                            {hit.via ? <em>Related term: {hit.via}</em> : null}
                          </span>
                          <AppIcon icon="arrow-right" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </section>
      ) : (
        <>
          <section className={styles.section} aria-labelledby="getting-started-title">
            <h2 id="getting-started-title">Getting started</h2>
            <p className={styles.sectionLead}>Follow these tutorials to learn the basic workflow in ChemDFT.</p>
            <ol className={styles.tutorials}>
              {guides.map((guide) => (
                <li key={guide.id}>
                  <Link className={styles.tutorial} href={`/${locale}/learn/guides/${guide.id}`} data-accent={guide.accent} data-learn-guide={guide.id}>
                    <span className={styles.tutorialArt} aria-hidden="true">
                      {guide.art}
                    </span>
                    <span className={styles.tutorialBody}>
                      <span className={styles.tutorialTitle}>
                        <span className={styles.number}>{guide.number}</span>
                        <strong>{guide.title}</strong>
                      </span>
                      <span className={styles.tutorialText}>{guide.summary}</span>
                      <span className={styles.tutorialGo}>
                        Start tutorial <AppIcon icon="arrow-right" />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>

          <section className={styles.section} aria-labelledby="library-title">
            <h2 id="library-title">Explore the knowledge library</h2>
            <p className={styles.sectionLead}>In-depth explanations of concepts, methods, and workflows in computational chemistry.</p>
            <div className={styles.library}>
              {categories.map((category) => {
                const rows = category.topicRows.length <= 2 ? category.topicRows.length : Math.ceil(category.topicRows.length / 2);
                return (
                  <section key={category.id} className={styles.category} data-accent={category.accent} aria-labelledby={`cat-${category.id}`}>
                    <header className={styles.categoryHead}>
                      <span className={styles.categoryIcon} aria-hidden="true">
                        <AppIcon icon={category.icon} />
                      </span>
                      <div className={styles.categoryText}>
                        <h3 id={`cat-${category.id}`}>{category.title}</h3>
                        <p>{category.description}</p>
                      </div>
                      <span className={styles.thumb} data-schematic={category.schematic || undefined} aria-hidden="true">
                        {category.thumb}
                      </span>
                    </header>
                    <ul className={styles.topics} style={{ ["--rows" as string]: rows }}>
                      {category.topicRows.map((topic) => (
                        <li key={topic.id}>
                          <Link href={helpHref(locale, topic.id)} data-learn-topic={topic.id}>
                            <span>{topic.title}</span>
                            <AppIcon icon="arrow-right" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </section>

          <section className={styles.section} aria-labelledby="resources-title">
            <h2 id="resources-title">Practical resources</h2>
            <ul className={styles.resources}>
              {resources.map((resource) => (
                <li key={resource.href}>
                  <Link href={resource.href}>
                    <span className={styles.resourceIcon} aria-hidden="true">
                      <AppIcon icon={resource.icon} />
                    </span>
                    <span>
                      <strong>{resource.title}</strong>
                      <small>{resource.description}</small>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

