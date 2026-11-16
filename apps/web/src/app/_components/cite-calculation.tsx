"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { CalculationDetail } from "@chemdft/schemas";

import {
  NO_DOI_NOTE, calculationApa, calculationBibTeX, calculationPlain, calculationRis, citationAuthor, citationFacts, engineAttribution, figureCaption, methodsParagraph,
  referencesBibTeX, referencesPlain, referencesRis, reproducibilityRecord,
} from "@/lib/calculation-citation";
import { saveBlob } from "@/lib/download";
import { CITE_FORMAT_STORAGE_KEY, DEFAULT_CITE_FORMAT, SOFTWARE_CITATION_FORMATS, softwareCitation, versionPrecisionNote } from "@/lib/citation";
import { readStored, writeStored } from "@/lib/safe-storage";
import { getOrcidStatus, type OrcidStatus } from "@/lib/orcid";
import { getCalculation } from "@/lib/structure-workspace-api";
import styles from "./scientific-state.module.css";

// Order: the formats people paste most often first; the Methods paragraph is the second one for "cite in a paper".
const FORMATS = [
  { key: "apa", label: "APA", extension: "txt" },
  { key: "methods", label: "Methods paragraph", extension: "txt" },
  { key: "caption", label: "Figure caption", extension: "txt" },
  { key: "bibtex", label: "BibTeX", extension: "bib" },
  { key: "ris", label: "RIS", extension: "ris" },
  { key: "plain", label: "Plain text", extension: "txt" },
  { key: "references", label: "Engine references", extension: "txt" },
  { key: "json", label: "Reproducibility JSON", extension: "json" },
] as const;
type FormatKey = (typeof FORMATS)[number]["key"];

/** "Cite this calculation": deterministic formats built from the stored record only (see lib/calculation-citation.ts). */
export function CiteCalculation({ projectId, calculationId, detail: known, inline = false }: { projectId: string; calculationId: string; detail?: CalculationDetail; /** Release 0.0.25: render as the "Cite" button of the result action row (same output, no extra heading). */ inline?: boolean }) {
  const [open, setOpen] = useState(false);
  const [fetched, setFetched] = useState<CalculationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orcid, setOrcid] = useState<OrcidStatus | null>(null);
  const [includeOrcid, setIncludeOrcid] = useState(false);
  const [format, setFormatState] = useState<FormatKey>(DEFAULT_CITE_FORMAT);
  const [softwareNotice, setSoftwareNotice] = useState<string | null>(null);
  const setFormat = (next: FormatKey) => { setFormatState(next); writeStored(CITE_FORMAT_STORAGE_KEY, next); };
  const [notice, setNotice] = useState<string | null>(null);
  const heading = useId();
  const detail = known ?? fetched;

  useEffect(() => {
    if (!open) return;
    // Open on the last-used format (the page renders fine without storage).
    const remembered = readStored(CITE_FORMAT_STORAGE_KEY);
    if (remembered && FORMATS.some((entry) => entry.key === remembered)) queueMicrotask(() => setFormatState(remembered as FormatKey));
    let alive = true;
    if (!known) getCalculation({ projectId, calculationId }).then((value) => { if (alive) setFetched(value); }).catch(() => { if (alive) setError("The calculation record could not be loaded, so nothing can be cited."); });
    getOrcidStatus().then((value) => { if (alive) setOrcid(value); }).catch(() => { /* no ORCID status: the citation simply has no personal author */ });
    return () => { alive = false; };
  }, [open, known, projectId, calculationId]);

  const output = useMemo(() => {
    if (!detail) return null;
    const facts = citationFacts(detail);
    const author = citationAuthor(orcid, includeOrcid);
    const attribution = engineAttribution(facts);
    switch (format) {
      case "bibtex": return [calculationBibTeX(facts, author), referencesBibTeX(attribution)].filter(Boolean).join("\n\n");
      case "ris": return [calculationRis(facts, author), referencesRis(attribution)].filter(Boolean).join("\n");
      case "apa": return calculationApa(facts, author);
      case "plain": return [calculationPlain(facts, author), "", "Engine references:", referencesPlain(attribution)].join("\n");
      case "methods": return methodsParagraph(facts);
      case "caption": return figureCaption(facts);
      case "references": return referencesPlain(attribution) || "No engine references are recorded for this calculation.";
      case "json": return JSON.stringify(reproducibilityRecord(detail, facts), null, 2);
    }
  }, [detail, orcid, includeOrcid, format]);

  const chosen = FORMATS.find((entry) => entry.key === format) ?? FORMATS[0];
  async function copy() {
    if (!output) return;
    try { await navigator.clipboard.writeText(output); setNotice("Copied."); } catch { setNotice("Copy was blocked by the browser; use Download."); }
  }
  function download() {
    if (!output) return;
    saveBlob(new Blob([output], { type: "text/plain;charset=utf-8" }), `chemdft-calculation-${calculationId.slice(0, 8)}-${chosen.key}.${chosen.extension}`);
    setNotice("Saved.");
  }
  const orcidOffer = orcid?.linked && orcid.orcid_id;
  const software = softwareCitation(format);
  async function copySoftware() {
    try { await navigator.clipboard.writeText(software.text); setSoftwareNotice("Copied."); } catch { setSoftwareNotice("Copy was blocked by the browser; select the text and copy it."); }
  }

  return (
    <div
      className={inline ? undefined : styles.inspector}
      data-testid="cite-calculation"
      aria-labelledby={inline ? undefined : heading}
      data-open={inline && open ? "true" : undefined}
      style={inline ? { display: "contents" } : undefined}
    >
      {inline ? null : <h4 id={heading}>Cite this calculation</h4>}
      <button
        type="button"
        className={styles.secondaryAction}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        data-testid="cite-toggle"
      >
        {inline ? (open ? "Hide citation" : "Cite") : open ? "Hide citation" : "Cite this calculation"}
      </button>
      {open ? (
        <div data-testid="cite-panel" style={inline ? { flex: "1 1 100%", width: "100%", order: 10 } : undefined}>
          {error ? <p role="alert">{error}</p> : !detail ? <p role="status">Loading the calculation record…</p> : (
            <>
              <section aria-label="Cite this calculation" data-testid="cite-section-calculation">
                <h5 style={{ margin: "8px 0 4px", fontSize: 13 }}>Cite this calculation</h5>
                <pre tabIndex={0} aria-label={`${chosen.label} text`} data-testid="cite-output" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 220, overflow: "auto", margin: "0 0 8px", padding: 10, border: "1px solid var(--cdf-line)", background: "var(--cdf-panel, #f1f4f7)", font: "12px/1.5 var(--cdf-font-data, monospace)" }}>{output}</pre>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "0 0 8px" }}>
                  <button type="button" className="bp6-button bp6-intent-primary" onClick={() => void copy()} data-testid="cite-copy">Copy citation</button>
                  <button type="button" className={styles.secondaryAction} onClick={download} data-testid="cite-download">Download</button>
                  <span role="status" aria-live="polite" className={styles.muted}>{notice ?? ""}</span>
                </div>
                <div role="tablist" aria-label="Citation format" style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "0 0 8px" }}>
                  {FORMATS.map((entry) => (
                    <button key={entry.key} type="button" role="tab" aria-selected={format === entry.key} className={styles.secondaryAction} data-testid={`cite-format-${entry.key}`}
                      style={format === entry.key ? { fontWeight: 700, outline: "2px solid #2d7fc1", outlineOffset: -2 } : undefined} onClick={() => setFormat(entry.key)}>{entry.label}</button>
                  ))}
                </div>
                {orcidOffer ? (
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="checkbox" style={{ width: 18, height: 18 }} checked={includeOrcid} disabled={orcid?.environment !== "production"} onChange={(event) => setIncludeOrcid(event.currentTarget.checked)} />
                    Add my ORCID iD{orcid?.display_name ? " and name" : ""} as author
                  </label>
                ) : null}
                {orcidOffer && orcid?.environment !== "production" ? <p className={styles.muted}>Your linked iD is an ORCID sandbox test record, so it is never added to a citation.</p> : null}
                <p className={styles.muted} data-testid="cite-no-doi-note">{NO_DOI_NOTE}</p>
              </section>
              <section aria-label="Cite ChemDFT" data-testid="cite-section-software" style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid var(--cdf-line)" }}>
                <h5 style={{ margin: "0 0 4px", fontSize: 13 }}>Cite ChemDFT</h5>
                <p className={styles.muted} style={{ margin: "0 0 6px" }}>The software itself (from the repository&apos;s citation file). Cite it together with the calculation and the engines.</p>
                <pre tabIndex={0} aria-label={`ChemDFT software citation, ${software.format}`} data-testid="cite-software-output" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 160, overflow: "auto", margin: "0 0 8px", padding: 10, border: "1px solid var(--cdf-line)", background: "var(--cdf-panel, #f1f4f7)", font: "12px/1.5 var(--cdf-font-data, monospace)" }}>{software.text}</pre>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <button type="button" className={styles.secondaryAction} onClick={() => void copySoftware()} data-testid="cite-software-copy">Copy ChemDFT citation</button>
                  <span role="group" aria-label="ChemDFT citation format" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {SOFTWARE_CITATION_FORMATS.map((entry) => (
                      <button key={entry.key} type="button" aria-pressed={software.format === entry.key} className={styles.secondaryAction} data-testid={`cite-software-format-${entry.key}`}
                        style={software.format === entry.key ? { fontWeight: 700, outline: "2px solid #2d7fc1", outlineOffset: -2 } : undefined} onClick={() => setFormat(entry.key)}>{entry.label}</button>
                    ))}
                  </span>
                  <span role="status" aria-live="polite" className={styles.muted}>{softwareNotice ?? ""}</span>
                </div>
                <p className={styles.muted} style={{ margin: "6px 0 0" }}>The Zenodo record (DOI 10.5281/zenodo.24082321) is an archival snapshot of open-core parts only; proprietary components are not included.</p>
                {versionPrecisionNote() ? (
                  <p className={styles.muted} style={{ margin: "4px 0 0" }} data-testid="cite-software-version-precision">
                    {versionPrecisionNote()}
                  </p>
                ) : null}
              </section>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
