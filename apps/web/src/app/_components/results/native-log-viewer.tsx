"use client";

import { useMemo, useRef, useState } from "react";
import type { JobLogOutput } from "@chemdft/schemas";
import { scientificLog } from "@/lib/scientific-log";
import { findMatches, highlightRuns, logSections } from "@/lib/native-log-view";
import { CopyValue } from "./results-parts";
import styles from "./results-ui.module.css";

/**
 * Readable view of the sanitized display excerpt of the native log, with search, copy and section navigation.
 * Search and copy act on the excerpt shown here, not on the original log: the original artifact (its bytes and
 * SHA-256) is never changed and stays downloadable through the authorized artifact route.
 */
export function NativeLogViewer({ log, onDownload, downloadNotice }: { log: JobLogOutput; onDownload: () => void; downloadNotice: string | null }) {
  const excerpt = useMemo(() => scientificLog(log.text).excerpt, [log.text]);
  const lines = useMemo(() => (excerpt ? excerpt.split("\n") : []), [excerpt]);
  const sections = useMemo(() => logSections(lines), [lines]);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const box = useRef<HTMLPreElement | null>(null);
  const matches = useMemo(() => findMatches(lines, query), [lines, query]);
  const active = matches.length > 0 ? matches[Math.min(current, matches.length - 1)]! : null;

  function reveal(line: number) {
    const target = box.current?.querySelector<HTMLElement>(`[data-line="${line}"]`);
    if (!target || !box.current) return;
    box.current.scrollTop = Math.max(0, target.offsetTop - box.current.offsetTop - 8);
  }
  function step(direction: 1 | -1) {
    if (matches.length === 0) return;
    const next = (Math.min(current, matches.length - 1) + direction + matches.length) % matches.length;
    setCurrent(next);
    reveal(matches[next]!.line);
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(excerpt);
      setCopied(`Copied ${lines.length} displayed lines (not the original log).`);
    } catch { setCopied("Copy was blocked by the browser."); }
    window.setTimeout(() => setCopied(null), 3000);
  }

  return (
    <section aria-label="Scientific log excerpt" data-testid="scientific-log-excerpt" className={styles.logViewer}>
      <div className={styles.notice} data-intent="info" data-testid="log-scope-note">
        <strong>Display excerpt, not the original</strong>
        <span>
          Allow-listed scientific lines from the original native log, SCF output first. Python source, paths and machine details are omitted.
          Search and copy apply to this excerpt only; the original artifact is unchanged.
        </span>
      </div>
      {log.truncated ? <p role="note" className={styles.caption}>The server returned a log tail. Earlier scientific output may be unavailable here; download the original for complete evidence.</p> : null}
      {lines.length === 0 ? <p className={styles.muted} data-testid="log-empty">No supported scientific output is available in this excerpt.</p> : (
        <>
          <div className={styles.logToolbar}>
            <label className={styles.logSearch}>
              <span className={styles.visuallyHidden}>Search the displayed excerpt</span>
              <input type="search" value={query} placeholder="Search displayed lines…" data-testid="log-search"
                onChange={(e) => { setQuery(e.currentTarget.value); setCurrent(0); const first = findMatches(lines, e.currentTarget.value)[0]; if (first) window.setTimeout(() => reveal(first.line), 0); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); } }} />
            </label>
            <span role="status" aria-live="polite" className={styles.caption} data-testid="log-match-count">
              {query.trim() ? (matches.length === 0 ? "No matches" : `${Math.min(current, matches.length - 1) + 1} of ${matches.length}`) : `${lines.length} lines`}
            </span>
            <button type="button" className={styles.secondaryAction} onClick={() => step(-1)} disabled={matches.length === 0} aria-label="Previous match">↑</button>
            <button type="button" className={styles.secondaryAction} onClick={() => step(1)} disabled={matches.length === 0} aria-label="Next match">↓</button>
            <span className={styles.spacer} />
            <button type="button" className={styles.secondaryAction} onClick={() => void copy()} data-testid="log-copy">Copy displayed text</button>
          </div>
          {sections.length > 0 ? (
            <nav className={styles.logSections} aria-label="Jump to a section of the displayed excerpt" data-testid="log-sections">
              <span className={styles.caption}>Jump to</span>
              {sections.map((section) => (
                <button key={section.id} type="button" className={styles.link} data-section={section.id} onClick={() => reveal(section.line)}>{section.label}</button>
              ))}
            </nav>
          ) : null}
          <pre className={styles.log} ref={box} tabIndex={0} aria-label="Native log display excerpt, scrollable" data-testid="log-text">
            {lines.map((line, index) => (
              <span key={index} data-line={index} className={styles.logLine}>
                <span className={styles.logNumber} aria-hidden="true">{index + 1}</span>
                <span>{highlightRuns(line, matches, index, active && active.line === index ? active.start : null).map((run, i) =>
                  run.match ? <mark key={i} data-active={run.active || undefined}>{run.text}</mark> : <span key={i}>{run.text}</span>)}{"\n"}</span>
              </span>
            ))}
          </pre>
          <p role="status" aria-live="polite" className={styles.caption} data-testid="log-copy-status">{copied ?? ""}</p>
        </>
      )}
      <div className={styles.logOriginal} data-testid="log-original">
        <button type="button" className={styles.secondaryAction} onClick={onDownload}>Download original native log</button>
        <span className={styles.caption}>Original artifact SHA-256: <CopyValue value={log.sha256} label="original log SHA-256" /></span>
      </div>
      <p className={styles.caption}>The original may include Python source, local paths and machine identifiers. Download requires authorized project access.</p>
      {downloadNotice ? <p role="status" className={styles.caption}>{downloadNotice}</p> : null}
    </section>
  );
}
