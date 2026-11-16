"use client";

import { useRef, useState } from "react";
import { AppIcon } from "@chemdft/ui";
import type { CalculationComparisonOutput } from "@chemdft/schemas";
import {
  aggregateRules, conditionsText, failedRules, MAX_SELECTION, positionLetter, remedyFor, selectionLetters, shortLabel, STATUS,
  type CompareItem, type Outcome,
} from "@/lib/compare-model";
import styles from "./compare.module.css";

const OUTCOME_ICON: Record<Outcome, "tick-circle" | "warning-sign" | "cross-circle"> = { PASS: "tick-circle", LIMITATION: "warning-sign", FAIL: "cross-circle" };
const OUTCOME_WORD: Record<Outcome, string> = { PASS: "Pass", LIMITATION: "Limitation", FAIL: "Blocks comparison" };

export function StatusBadge({ label, short = false, ...rest }: { label: keyof typeof STATUS; short?: boolean } & React.HTMLAttributes<HTMLSpanElement>) {
  const status = STATUS[label];
  return <span className={styles.statusBadge} data-intent={status.intent} {...rest}><AppIcon icon={status.icon} />{short ? status.short : status.text}</span>;
}

/**
 * Selection navigator and the selected results' compact cards.
 *
 * - The navigator shows all eight slots (A–H): a filled slot is a selected result, A is the reference, empty slots show
 *   what is left. Each filled letter is a real button that brings that result's card into view (wide screens) or shows
 *   it beside the reference (narrow screens), so nothing depends on invisible scrolling.
 * - Two results share the width; three to eight sit in one horizontally scrolling row with visible previous / next buttons.
 * - Every value is the stored one; thermochemical conditions are the stored conditions, shown only when recorded.
 */
export function SelectionOverview({ items, canEdit = true, onRemove, onMakeReference }: {
  items: readonly CompareItem[];
  canEdit?: boolean;
  onRemove: (resultId: string) => void;
  onMakeReference: (resultId: string) => void;
}) {
  const [activeRaw, setActiveRaw] = useState<string | null>(null);
  const strip = useRef<HTMLUListElement | null>(null);
  // The result shown next to the reference on a narrow screen (and highlighted on a wide one).
  const active = items.some((item) => item.resultId === activeRaw) ? activeRaw : (items[1] ?? items[0])?.resultId ?? null;
  const many = items.length > 2;

  const reveal = (resultId: string) => {
    setActiveRaw(resultId);
    const card = strip.current?.querySelector<HTMLElement>(`[data-result-id="${resultId}"]`);
    // `scrollIntoView` on the card would also scroll the page; move only the strip.
    if (card && strip.current && strip.current.scrollWidth > strip.current.clientWidth) {
      strip.current.scrollTo({ left: card.offsetLeft - strip.current.offsetLeft - 4, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  };
  const page = (direction: -1 | 1) => {
    const node = strip.current;
    if (node) node.scrollBy({ left: direction * Math.max(220, node.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <div className={styles.selectionOverview} data-testid="compare-selection-overview" data-count={items.length}>
      <div className={styles.navigator} role="group" aria-label={`Selected results: ${items.length} of ${MAX_SELECTION}`} data-testid="compare-navigator">
        <span className={styles.navCount} data-testid="compare-nav-count"><strong>{items.length}</strong> of {MAX_SELECTION} selected</span>
        <span className={styles.navSlots}>
          {selectionLetters(MAX_SELECTION).map((letter, index) => {
            const item = items[index];
            if (!item) return <span key={letter} className={styles.navSlot} data-empty="true" aria-hidden="true">{letter}</span>;
            const reference = index === 0;
            return (
              <button
                key={item.resultId} type="button" className={styles.navSlot} data-reference={reference} data-active={item.resultId === active} aria-current={item.resultId === active ? "true" : undefined}
                aria-label={`${letter}${reference ? ", reference" : ""}: ${shortLabel(item)}. Show this result.`} title={`${letter}${reference ? " · reference" : ""} · ${shortLabel(item)}`}
                onClick={() => reveal(item.resultId)} data-testid="compare-nav-slot"
              >{letter}</button>
            );
          })}
        </span>
        {many ? (
          <span className={styles.navPager}>
            <button type="button" className={styles.iconButton} onClick={() => page(-1)} aria-label="Show earlier selected results" data-testid="compare-strip-prev"><AppIcon icon="chevron-left" /></button>
            <button type="button" className={styles.iconButton} onClick={() => page(1)} aria-label="Show later selected results" data-testid="compare-strip-next"><AppIcon icon="chevron-right" /></button>
          </span>
        ) : null}
      </div>

      <ul className={styles.strip} ref={strip} aria-label="Selected results" data-testid="compare-selection" data-many={many}>
        {items.map((item, index) => {
          const reference = index === 0;
          const name = `${item.taskText}, ${item.level}`;
          const conditions = conditionsText(item.conditions);
          return (
            <li key={item.resultId} className={styles.card} data-reference={reference} data-active={item.resultId === active} data-testid="compare-selected-card" data-result-id={item.resultId}>
              <div className={styles.cardTop}>
                <span className={styles.letter} data-reference={reference} aria-hidden="true">{positionLetter(index)}</span>
                <span className={styles.grow}>{reference ? "Reference" : "Result"}</span>
                {!reference && canEdit ? (
                  <button type="button" className={styles.link} onClick={() => onMakeReference(item.resultId)} data-testid="compare-make-reference" aria-label={`Make ${name} the reference`}>Make reference</button>
                ) : null}
                <button type="button" className={styles.iconButton} onClick={() => onRemove(item.resultId)} data-testid="compare-remove" aria-label={`Remove ${name} from the comparison`} title="Remove from the comparison"><AppIcon icon="cross" /></button>
              </div>
              <h3 className={styles.cardTitle}>
                {item.taskText}{item.structureRevision ? <span className={styles.version}>{item.structureRevision}</span> : null}
              </h3>
              <p className={styles.cardLine} title={`${item.structureName ?? "structure not recorded"}${item.formula ? ` · ${item.formula}` : ""}`}>
                {item.structureName ?? "structure not recorded"}{item.formula ? ` · ${item.formula}` : ""}
              </p>
              <p className={styles.cardLine}><span className={styles.nowrapPiece}>{item.level}</span> · <span className={styles.nowrapPiece}>{item.engine}</span> · <span className={styles.nowrapPiece}>q {item.charge ?? "?"}</span> · <span className={styles.nowrapPiece}>2S+1 {item.multiplicity ?? "?"}</span></p>
              {item.resultType === "chemdft.thermochemistry" ? (
                <p className={styles.conditionsLine} data-testid="compare-conditions">{conditions ?? <span className={styles.muted}>conditions not recorded</span>}</p>
              ) : null}
              {item.primary ? (
                <p className={styles.cardValue} title={item.primary.label}>
                  <strong>{item.primary.text}{item.primary.unit ? <span>{item.primary.unit}</span> : null}</strong>
                  <span className={styles.cardValueLabel}>{item.primary.label}</span>
                </p>
              ) : <p className={styles.cardLine}><span className={styles.muted}>No scalar quantity stored for this result type.</span></p>}
              <div className={styles.cardFoot}>
                {item.standing === "current"
                  ? <span className={styles.tag} data-intent="success" title={item.verification}><AppIcon icon="tick" /> Current</span>
                  : <span className={styles.tag} data-intent="warning" title={item.verification}><AppIcon icon="history" /> {item.standingText}</span>}
                <span className={styles.caption}>{item.verification}</span>
                <span className={`${styles.caption} ${styles.mono}`} title={`Result ${item.resultId}`}>#{item.shortId}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * What the existing scientific rules say, briefly: the verdict in words and an icon, the rules that limit or block the
 * comparison (at most two lines here), and what to change when it is blocked. Every rule, each pairing and the
 * server's notice are one disclosure away, and the Rules tab has the full text.
 */
export function CompatibilityPanel({ output, items, loading, error, onRetry, onShowRules }: {
  output: CalculationComparisonOutput | null;
  items: readonly CompareItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onShowRules: () => void;
}) {
  if (error) {
    return (
      <section className={styles.compat} aria-label="Compatibility summary" data-testid="compare-compat" role="alert">
        <div className={styles.notice} data-intent="danger" data-testid="compare-error">
          <strong>The comparison could not be made</strong><span>{error}</span>
          <span><button type="button" className={styles.secondaryAction} onClick={onRetry}>Retry</button></span>
        </div>
      </section>
    );
  }
  if (loading || !output) {
    return (
      <section className={styles.compat} aria-label="Compatibility summary" aria-busy="true" data-testid="compare-compat">
        <p className={styles.muted} role="status" data-testid="compare-checking">Checking scientific comparability against the stored specifications…</p>
      </section>
    );
  }
  const rules = aggregateRules(output);
  const failed = failedRules(rules);
  const attention = rules.filter((rule) => rule.outcome !== "PASS");
  const passes = rules.filter((rule) => rule.outcome === "PASS");
  const shown = attention.slice(0, 2);
  const letter = (resultId: string): string => positionLetter(Math.max(0, items.findIndex((item) => item.resultId === resultId)));
  const pairCount = output.pairs.length;
  return (
    <section className={styles.compat} aria-label="Compatibility summary" data-testid="compare-compat" data-overall={output.overall}>
      <div className={styles.compatTop}>
        <StatusBadge label={output.overall} data-testid="compare-overall" />
        {attention.length === 0 ? <span className={styles.caption}>{STATUS[output.overall].blurb}</span> : null}
      </div>
      {shown.length > 0 ? (
        <ul className={styles.ruleList} aria-label="Rules that need attention">
          {shown.map((rule) => {
            const first = rule.details.find((detail) => detail.outcome === rule.outcome) ?? rule.details[0];
            const affected = rule.details.filter((detail) => detail.outcome === rule.outcome).length;
            return (
              <li key={rule.ruleId} data-outcome={rule.outcome} data-rule={rule.ruleId}>
                <span className={styles.ruleIcon}><AppIcon icon={OUTCOME_ICON[rule.outcome]} /></span>
                <span title={first?.detail}>
                  <span className="screen-reader-only">{OUTCOME_WORD[rule.outcome]}: </span>
                  <strong>{rule.label}.</strong> <span className={styles.clamp}>{first?.detail}</span>
                  {pairCount > 1 ? <small>{affected} of {pairCount} comparisons with the reference</small> : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {attention.length > shown.length ? <p className={styles.caption}>+{attention.length - shown.length} more in the rule details.</p> : null}
      {failed.length > 0 ? (
        <p className={styles.remedy} data-testid="compare-remedy">
          <strong>No numerical difference is shown.</strong> To compare: {failed.map((rule) => remedyFor(rule.ruleId).replace(/\.$/, "").toLowerCase()).join("; ")}.
        </p>
      ) : null}
      <details className={styles.ruleDetails} data-testid="compare-rule-details">
        <summary data-testid="compare-pass-count">
          {passes.length === rules.length ? `All ${rules.length} rules pass` : `${passes.length} of ${rules.length} rules pass`} · rule details
        </summary>
        <div className={styles.ruleDetailsBody}>
          <ul className={styles.ruleList} aria-label="Every rule">
            {rules.map((rule) => (
              <li key={rule.ruleId} data-outcome={rule.outcome} data-rule={rule.ruleId}>
                <span className={styles.ruleIcon}><AppIcon icon={OUTCOME_ICON[rule.outcome]} /></span>
                <span>
                  <span className="screen-reader-only">{OUTCOME_WORD[rule.outcome]}: </span>
                  <strong>{rule.label}.</strong> {(rule.details.find((detail) => detail.outcome === rule.outcome) ?? rule.details[0])?.detail}
                </span>
              </li>
            ))}
          </ul>
          {pairCount > 1 ? (
            <ul className={styles.pairList} aria-label="Each result against the reference">
              {output.pairs.map((pair) => (
                <li key={pair.other_result_id}>
                  <span className={styles.letter} aria-hidden="true">{letter(pair.other_result_id)}</span>
                  <span className={styles.statusInline} data-intent={STATUS[pair.label].intent}><AppIcon icon={STATUS[pair.label].icon} />{STATUS[pair.label].short}</span>
                  <span className="screen-reader-only">against the reference</span>
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" className={styles.link} onClick={onShowRules} style={{ justifySelf: "start" }} data-testid="compare-show-rules">Open the Rules tab</button>
          <p className={styles.caption} data-testid="compare-notice">{output.notice}</p>
        </div>
      </details>
    </section>
  );
}
