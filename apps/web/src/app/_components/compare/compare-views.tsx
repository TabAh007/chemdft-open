"use client";

import Link from "next/link";
import { Fragment } from "react";
import { AppIcon } from "@chemdft/ui";
import type { Locale } from "@chemdft/i18n";
import type { CalculationComparisonOutput, CalculationPairComparison } from "@chemdft/schemas";
import {
  buildDifferenceTable, positionLetter, qs, quantityStatus, ruleLabel, signed, STATUS, summaryById,
  type CompareItem, type DifferenceCell, type Outcome, type QuantityStatus, type ThermoConditions,
} from "@/lib/compare-model";
import { evidenceStandingText, formatNumber } from "@/lib/comparison-view";
import { resultDetailHref, unitLabel } from "@/lib/results-model";
import { formatPressure, formatTemperature } from "@/lib/thermochemistry";
import { CopyValue, Tag } from "../results/results-parts";
import { ScientificTimestamp } from "../scientific-timestamp";
import styles from "./compare.module.css";

const OUTCOME_ICON: Record<Outcome, "tick-circle" | "warning-sign" | "cross-circle"> = { PASS: "tick-circle", LIMITATION: "warning-sign", FAIL: "cross-circle" };
const OUTCOME_CLASS: Record<Outcome, string> = { PASS: styles.outcomePass!, LIMITATION: styles.outcomeLimit!, FAIL: styles.outcomeFail! };
const OUTCOME_WORD: Record<Outcome, string> = { PASS: "Pass", LIMITATION: "Limitation", FAIL: "Blocks comparison" };

/** The value as stored: full numeric precision is in the Data tab; here 10 decimals for hartree, 10 significant figures otherwise. */
function storedText(value: number, unit: string): string {
  const hartree = ["Eh", "HARTREE", "hartree"].includes(unit);
  return hartree ? value.toFixed(10) : formatNumber(value, 10);
}

function ValueCell({ cell }: { cell: DifferenceCell }) {
  if (cell.state === "unavailable") return <span className={styles.muted}>Unavailable</span>;
  return <>{storedText(cell.value, cell.unit)}</>;
}

function StatusChip({ status, ...rest }: { status: QuantityStatus } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={styles.qStatus} data-intent={status.intent} data-status={status.key} title={status.explanation} {...rest}>
      <AppIcon icon={status.icon} />
      <span>{status.label}{status.reason ? <span className={styles.qReason}>{status.reason}</span> : null}</span>
      <span className="screen-reader-only">. {status.explanation}</span>
    </span>
  );
}

function DeltaCell({ cell, pair }: { cell: DifferenceCell; pair: CalculationPairComparison | undefined }) {
  const status = quantityStatus(cell, pair);
  if (cell.state === "reference") return <span className={styles.muted}>Reference</span>;
  if (cell.state === "delta") {
    return (
      <span className={styles.deltaCell} data-testid="compare-delta" data-limited={cell.limited}>
        <span>{signed(cell.delta)}</span>
        {cell.kcal != null ? <span className={styles.sub}>{signed(cell.kcal, 6)} kcal/mol · {signed(cell.kj ?? 0, 6)} kJ/mol</span> : null}
        <StatusChip status={status} />
      </span>
    );
  }
  const testId = cell.state === "blocked" ? "compare-delta-blocked" : cell.state === "withheld" ? "compare-delta-withheld" : undefined;
  return <span className={styles.noDelta}><StatusChip status={status} {...(testId ? { "data-testid": testId } : {})} /></span>;
}

/**
 * The key numerical comparison. One row per stored quantity that at least two selected results share; each other
 * result gets its value and, only where the server formed one, the difference (other minus reference). Incompatible
 * pairings show the stored value and say why no difference exists; nothing is subtracted in the browser.
 */
export function DifferenceView({ output, items }: { output: CalculationComparisonOutput; items: readonly CompareItem[] }) {
  const table = buildDifferenceTable(output);
  const ordered = output.results;
  const historical = output.pairs.some((pair) => pair.evidence_standing !== "CURRENT");
  return (
    <div className={styles.tabPanel} data-testid="compare-key">
      {historical ? <p className={styles.notice} data-intent="warning" role="note" data-testid="compare-historical"><strong>Historical context only.</strong> {evidenceStandingText({ evidence_standing: "HISTORICAL_CONTEXT" })} Stored values are shown, never as current evidence.</p> : null}
      {table.rows.length === 0 ? (
        <p className={styles.notice} data-intent="info" data-testid="compare-no-deltas">These results share no stored quantity of the same definition, so there is nothing to subtract. See the Data tab for each result&apos;s own stored values.</p>
      ) : (
        <div className={styles.scroll} tabIndex={0} role="region" aria-label="Differences against the reference (scrollable)">
          <table className={`${styles.data} ${styles.keyTable}`} data-others={ordered.length - 1} style={{ "--others": ordered.length - 1 } as React.CSSProperties} data-testid="compare-deltas">
            <caption className="screen-reader-only">Stored quantities and their differences against the reference. Difference is other minus reference.</caption>
            <thead>
              <tr>
                <th scope="col">Quantity</th>
                {ordered.map((result, index) => {
                  const pair = index === 0 ? null : output.pairs.find((p) => p.other_result_id === result.result_id);
                  const item = items.find((i) => i.resultId === result.result_id);
                  return (
                    <Fragment key={result.result_id}>
                      <th scope="col" className={styles.numHead} data-reference={index === 0}>
                        <span className={styles.colHead} style={{ justifyItems: "end" }}>
                          <span className={styles.colTitle} title={item ? `${item.taskText} · ${item.level}` : undefined}><span className={styles.letter} data-reference={index === 0}>{positionLetter(index)}</span>{index === 0 ? "Reference" : "Result"}</span>
                          {pair ? <span className={styles.statusInline} data-intent={STATUS[pair.label].intent}><AppIcon icon={STATUS[pair.label].icon} />{STATUS[pair.label].short}</span> : null}
                        </span>
                      </th>
                      {index > 0 ? <th scope="col" className={styles.numHead}>Δ {positionLetter(index)} − A</th> : null}
                    </Fragment>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.kind} data-kind={row.kind}>
                  <th scope="row">{row.label}{unitLabel(row.unit) ? <span className={styles.unit}> ({unitLabel(row.unit)})</span> : null}</th>
                  {ordered.map((result, index) => {
                    const cell = row.cells.get(result.result_id) ?? { state: "unavailable" as const };
                    return (
                      <Fragment key={result.result_id}>
                        <td className={styles.valueCell}><ValueCell cell={cell} /></td>
                        {index > 0 ? <td className={styles.valueCell}><DeltaCell cell={cell} pair={output.pairs.find((p) => p.other_result_id === result.result_id)} /></td> : null}
                      </Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.caption} data-testid="compare-key-legend">
        Δ = other − reference, formed by the platform and shown only where its rules permit. <strong>Authorized</strong>: all rules passed. <strong>With limitations</strong>: formed, but qualified (see Rules). <strong>Incompatible</strong> or <strong>Not formed</strong>: no difference exists; the stored value is shown unchanged. <strong>Unavailable</strong>: not stored.
        {table.onlyInOne.length ? ` Stored in only one result and not compared: ${table.onlyInOne.join("; ")}.` : ""}
      </p>
    </div>
  );
}

/** Every stored quantity of every selected result at its full stored precision, with its unit: nothing rounded, converted or subtracted. */
export function StoredDataView({ output, items }: { output: CalculationComparisonOutput; items: readonly CompareItem[] }) {
  const kinds: { kind: string; label: string }[] = [];
  for (const result of output.results) for (const q of qs(result)) if (!kinds.some((k) => k.kind === q.kind)) kinds.push({ kind: q.kind, label: q.label });
  return (
    <div className={styles.tabPanel} data-testid="compare-data">
      <p className={styles.caption}>The stored values exactly as published, at full numeric precision and in their stored unit.</p>
      {kinds.length === 0 ? <p className={styles.notice} data-intent="info">None of the selected results stores a scalar quantity.</p> : (
        <div className={styles.scroll} tabIndex={0} role="region" aria-label="Stored quantities at full precision (scrollable)">
          <table className={styles.data}>
            <caption className="screen-reader-only">Stored quantities of each selected result</caption>
            <thead>
              <tr>
                <th scope="col">Quantity</th>
                {output.results.map((result, index) => (
                  <th key={result.result_id} scope="col" className={styles.numHead} data-reference={index === 0}>
                    <span className={styles.colHead} style={{ justifyItems: "end" }}><span className={styles.colTitle}><span className={styles.letter} data-reference={index === 0}>{positionLetter(index)}</span>{items.find((i) => i.resultId === result.result_id)?.taskText ?? ""}</span></span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kinds.map(({ kind, label }) => (
                <tr key={kind}>
                  <th scope="row">{label}</th>
                  {output.results.map((result) => {
                    const q = qs(result).find((candidate) => candidate.kind === kind);
                    return <td key={result.result_id} className={styles.valueCell}>{q ? <>{String(q.value)} <span className={styles.unit}>{unitLabel(q.unit)}</span></> : <span className={styles.muted}>Unavailable</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const METHOD_ROWS: { key: string; label: string; pick: (item: CompareItem) => string }[] = [
  { key: "type", label: "Result type", pick: (i) => i.taskText },
  { key: "structure", label: "Structure and version", pick: (i) => i.structureText },
  { key: "formula", label: "Molecular formula", pick: (i) => i.formula ?? "not recorded" },
  { key: "level", label: "Method / basis", pick: (i) => i.level },
  { key: "engine", label: "Engine and version", pick: (i) => i.engine },
  { key: "charge", label: "Charge", pick: (i) => (i.charge === null ? "not recorded" : String(i.charge)) },
  { key: "mult", label: "Multiplicity", pick: (i) => (i.multiplicity === null ? "not recorded" : String(i.multiplicity)) },
];

/** The existing rules, rule by rule and pairing by pairing, in the server's own words, plus the recorded method facts side by side. */
export function RulesView({ output, items, conditions }: { output: CalculationComparisonOutput; items: readonly CompareItem[]; conditions: ReadonlyMap<string, ThermoConditions> }) {
  const letter = (resultId: string) => positionLetter(Math.max(0, items.findIndex((item) => item.resultId === resultId)));
  return (
    <div className={styles.tabPanel} data-testid="compare-rules-view">
      <h3>Recorded method details</h3>
      <div className={styles.scroll} tabIndex={0} role="region" aria-label="Recorded method details (scrollable)">
        <table className={styles.data}>
          <caption className="screen-reader-only">Recorded method facts of each selected result; a highlighted row differs between results</caption>
          <thead>
            <tr>
              <th scope="col">Recorded fact</th>
              {items.map((item, index) => <th key={item.resultId} scope="col" data-reference={index === 0}><span className={styles.colHead}><span className={styles.colTitle}><span className={styles.letter} data-reference={index === 0}>{positionLetter(index)}</span>{index === 0 ? "Reference" : "Result"}</span></span></th>)}
            </tr>
          </thead>
          <tbody>
            {[...METHOD_ROWS, ...(items.some((item) => conditions.has(item.resultId)) ? [{
              key: "conditions", label: "Thermochemical conditions",
              pick: (item: CompareItem) => { const c = conditions.get(item.resultId); return c ? `${formatTemperature(c.temperatureK)} · ${formatPressure(c.pressurePa)}` : "not applicable"; },
            }] : [])].map((row) => {
              const values = items.map(row.pick);
              const differs = new Set(values).size > 1;
              return (
                <tr key={row.key} data-differs={differs}>
                  <th scope="row">{row.label}{differs ? <span className="screen-reader-only"> (differs between results)</span> : null}</th>
                  {values.map((value, index) => <td key={items[index]!.resultId}>{value}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h3>Comparability rules</h3>
      {output.pairs.map((pair) => (
        <article key={pair.other_result_id} className={styles.rulePair} data-testid="compare-pair" data-label={pair.label} data-standing={pair.evidence_standing}>
          <div className={styles.rulePairHead}>
            <span className={styles.letter} aria-hidden="true">{letter(pair.other_result_id)}</span>
            <strong>{letter(pair.other_result_id)} against the reference A</strong>
            <span className={styles.statusInline} data-intent={STATUS[pair.label].intent}><AppIcon icon={STATUS[pair.label].icon} />{STATUS[pair.label].text}</span>
          </div>
          {pair.evidence_standing !== "CURRENT" ? <p className={styles.caption} data-testid="compare-historical-pair">{evidenceStandingText(pair)}</p> : null}
          <ul className={styles.rules} aria-label="Comparability rules">
            {pair.rules.map((rule) => (
              <li key={rule.rule_id} data-testid="compare-rule" data-outcome={rule.outcome}>
                <span><span className={styles.ruleId}>{rule.rule_id}</span> {ruleLabel(rule.rule_id)}</span>
                <span className={OUTCOME_CLASS[rule.outcome]}><AppIcon icon={OUTCOME_ICON[rule.outcome]} /> {OUTCOME_WORD[rule.outcome]}</span>
                <span>{rule.detail}</span>
              </li>
            ))}
          </ul>
          {pair.geometry.relation !== "IDENTICAL_STRUCTURE_VERSION" ? (
            <p className={styles.caption}>
              Geometry: {pair.geometry.relation.toLowerCase().replaceAll("_", " ")}
              {pair.geometry.rmsd_angstrom != null ? ` · RMSD ${formatNumber(pair.geometry.rmsd_angstrom, 4)} Å` : ""}
              {pair.geometry.note ? ` — ${pair.geometry.note}` : ""}
            </p>
          ) : <p className={styles.caption}>Geometry: the identical structure version.</p>}
        </article>
      ))}
      <p className={styles.caption}>{output.notice}</p>
    </div>
  );
}

/** Where each result came from: identifiers, producer, and the four separate scientific facts; the Result Inspector has the evidence itself. */
export function ProvenanceView({ output, items, projectId, locale }: { output: CalculationComparisonOutput; items: readonly CompareItem[]; projectId: string; locale: Locale }) {
  return (
    <div className={styles.tabPanel} data-testid="compare-provenance">
      <p className={styles.caption}>Standing, authority and verification are separate stored facts. Platform validation is not independent scientific verification, and agreement between results never changes either.</p>
      <div className={styles.scroll} tabIndex={0} role="region" aria-label="Provenance of each result (scrollable)">
        <table className={styles.data}>
          <caption className="screen-reader-only">Provenance of each selected result</caption>
          <thead>
            <tr><th scope="col">Result</th><th scope="col">Identifiers</th><th scope="col">Engine</th><th scope="col">Authority · validation</th><th scope="col">Verification</th><th scope="col">Standing</th><th scope="col">Stored</th></tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const summary = summaryById(output, item.resultId);
              return (
                <tr key={item.resultId} data-testid="compare-state">
                  <th scope="row">
                    <span className={styles.colTitle} style={{ display: "flex", alignItems: "center", gap: 6 }}><span className={styles.letter} data-reference={index === 0}>{positionLetter(index)}</span>{item.taskText}</span>
                    <Link className={styles.link} href={resultDetailHref(locale, projectId, item.resultId, "provenance")} data-testid="compare-provenance-link">Open provenance</Link>
                  </th>
                  <td>
                    <div className={styles.cellSub}>Result</div><CopyValue value={item.resultId} label="result id" short />
                    <div className={styles.cellSub}>Calculation</div><CopyValue value={item.calculationId} label="calculation id" short />
                  </td>
                  <td>{item.engine}<div className={styles.cellSub}>{item.level}</div></td>
                  <td>{(summary?.effective_state?.authority ?? item.authority ?? "—").toString().toLowerCase().replaceAll("_", " ")} · {(summary?.effective_state?.validation_state ?? item.validation ?? "—").toString().toLowerCase().replaceAll("_", " ")}</td>
                  <td>{item.verification}</td>
                  <td>{item.standing === "current" ? <Tag intent="success">Current</Tag> : <Tag intent="warning">{item.standingText}</Tag>}</td>
                  <td className={styles.cellSub}><ScientificTimestamp value={item.updatedAt} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
