"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "@chemdft/i18n";
import { ReuseDialog } from "../reuse-dialog";
import { useOverviewDock } from "@/lib/overview-dock";
import { useAiPageContext } from "@/lib/ai-context";
import { useWorkspaceState } from "../workspace-state-provider";
import { compareHref, jobsHref } from "@/lib/overview-view";
import { resultWorkspacePath } from "@/lib/job-view";
import { projectPath } from "@/lib/routes";
import { inspectorModel, resultAiLabel, verifiedInputCoordinates } from "@/lib/result-inspector-model";
import { INSPECTOR_SECTIONS, type InspectorSection } from "@/lib/results-model";
import { useResultRecord } from "@/lib/use-result-record";
import { useProjectWriteAccess } from "@/lib/use-project-role";
import { ResultActionRow } from "./result-action-row";
import { ArtifactsSection, CoordinatesSection, EvidenceSection, ExportSection, ProvenanceSection } from "./inspector-sections";
import { InputGeometryCard, ResultViewer } from "./inspector-viewer";
import { AuthorityPanel, PrimaryReadout, Section, Tag } from "./results-parts";
import styles from "./results-ui.module.css";

const FAILURE_COPY = {
  forbidden: { title: "You do not have access to this result", body: "Your project role or sign-in does not allow reading it. Nothing is shown in its place." },
  missing: { title: "This result could not be found", body: "It may belong to another project, or it was never published. Open Results to see what this project has published." },
  mismatch: { title: "This result could not be verified", body: "The result and its calculation record do not match, so nothing is displayed." },
  error: { title: "This result could not be loaded", body: "Reload to try again. Stored evidence is unchanged." },
} as const;

/**
 * The Scientific Result Inspector. One calm hierarchy: the primary stored output (once), the input geometry beside it,
 * the four scientific-authority facts kept apart, then evidence on demand (provenance, native evidence, coordinates,
 * artifacts, export). Every value is the stored one; nothing is generated for presentation.
 */
export function ResultInspector({ projectId, resultId, locale, initialSection }: { projectId: string; resultId: string; locale: Locale; initialSection?: InspectorSection | null | undefined }) {
  const record = useResultRecord(projectId, resultId);
  const access = useProjectWriteAccess(projectId);
  const { workspaceMode } = useWorkspaceState();
  useOverviewDock(projectId, workspaceMode); // the header AI Scientist toggle works on this page too (show/hide only)
  const [open, setOpen] = useState<ReadonlySet<InspectorSection>>(() => new Set(initialSection ? [initialSection] : []));
  const [reuse, setReuse] = useState(false);
  const scrolled = useRef(false);
  const toggle = (section: InspectorSection, next: boolean) => setOpen((current) => { const copy = new Set(current); if (next) copy.add(section); else copy.delete(section); return copy; });

  const ready = record.status === "ready" ? record : null;
  const model = useMemo(() => (ready ? inspectorModel(ready.detail, ready.input) : null), [ready]);

  useEffect(() => {
    if (!ready || !initialSection || scrolled.current) return;
    const timer = window.setTimeout(() => {
      scrolled.current = true;
      document.getElementById(`section-${initialSection}`)?.scrollIntoView({ block: "start" });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [ready, initialSection]);

  // Keep the AI Scientist's context on the result being inspected (same event the workspace emits; read-only context).
  useEffect(() => {
    if (!ready || !model || model.viewer !== "energy" || !model.structure) return;
    window.dispatchEvent(new CustomEvent("chemdft:workspace-selection", { detail: {
      projectId, calculationId: ready.detail.calculation.id, resultId: ready.result.id,
      structureName: model.structure.name, structureVersionRevision: model.structure.revision,
      currentView: `Total Energy · ${ready.detail.specification.method.identifier.toUpperCase()} · ${model.structure.label}`,
    } }));
  }, [ready, model, projectId]);

  // The dock follows the result being inspected (not whatever the Workspace last selected). The label is built from recorded fields only: the
  // energy view names method and structure; every other case uses the page's own title (task, and the structure when its input resolved).
  useAiPageContext(projectId, ready
    ? { page: "result", label: model ? resultAiLabel(model, ready.detail.specification.method.identifier) : "Result",
        selection: { kind: "calculationResult" as const, id: ready.result.id, projectId, sourceId: ready.detail.calculation.id } }
    : { page: "project", section: "results", label: "Result" });

  const resultsHref = projectPath(locale, projectId, "results");
  const crumb = (title?: string) => (
    <nav className={styles.crumb} aria-label="Breadcrumb"><Link className={styles.link} href={resultsHref} data-testid="results-back">Results</Link>{title ? <><span aria-hidden="true">/</span><strong>{title}</strong></> : <><span aria-hidden="true">/</span><span>Result</span></>}</nav>
  );

  if (record.status === "loading") {
    return <div className={styles.page} data-testid="result-inspector" aria-busy="true"><div className={styles.head}>{crumb("Loading result…")}</div><div className={`${styles.panel} ${styles.panelPad}`} role="status" data-testid="result-loading">Reading the stored result, its calculation record and its immutable input…</div></div>;
  }
  if (record.status === "failed") {
    const copy = FAILURE_COPY[record.kind];
    return (
      <div className={styles.page} data-testid="result-inspector">
        <div className={styles.head}>{crumb("Result unavailable")}</div>
        <div className={`${styles.panel} ${styles.empty}`} role="alert" data-testid="result-error" data-kind={record.kind}>
          <h2>{copy.title}</h2><p className={styles.muted}>{copy.body}</p><p className={styles.caption}>{record.message}</p>
          <div className={styles.emptyActions}><Link className={styles.secondaryAction} href={resultsHref}>Back to Results</Link></div>
        </div>
      </div>
    );
  }

  const { detail, result, input, inputError } = record;
  const m = model!;
  const state = m.authority!;
  const coordinates = verifiedInputCoordinates(detail, input);
  const showNative = result.producer_software.name === "pyscf";
  const sectionProps = (id: InspectorSection) => ({ id, open: open.has(id), onToggle: (next: boolean) => toggle(id, next) });

  return (
    <div className={styles.page} data-testid="result-inspector" data-result-id={result.id} data-calculation-id={detail.calculation.id} data-viewer={m.viewer}>
      <div className={styles.head}>
        <div style={{ display: "grid", gap: 4 }}>
          {crumb()}
          <h1 data-testid="inspector-title">{m.task}{m.structure ? <span className={styles.muted} style={{ fontWeight: 400 }}> · {m.structure.label}</span> : null}</h1>
        </div>
        <div className={styles.headActions}>
          <Link className={styles.secondaryAction} href={compareHref(locale, projectId, [result.id])} data-testid="inspector-compare">Compare…</Link>
          {detail.compute_job ? <Link className={styles.secondaryAction} href={jobsHref(locale, projectId)}>Job</Link> : null}
          {access.canWrite === true ? <button type="button" className={styles.secondaryAction} onClick={() => setReuse(true)} data-testid="inspector-reuse">Reuse settings</button> : null}
          <Link className={styles.link} href={resultWorkspacePath(locale, projectId, detail.calculation.id, result.id)} data-testid="inspector-workspace">Open in workspace</Link>
          <ResultActionRow
            projectId={projectId}
            calculationId={detail.calculation.id}
            resultId={result.id}
            structureLabel={m.structure ? m.structure.label : undefined}
            label={m.task}
            exportTestId="inspector-export"
          />
        </div>
      </div>

      <div className={styles.top}>
        <div className={styles.topMain}>
        <section className={`${styles.panel} ${styles.panelPad}`} aria-label="Primary scientific output" style={{ display: "grid", gap: 10, alignContent: "start" }}>
          {m.primary ? (
            <PrimaryReadout label={m.primary.label} valueText={m.primary.valueText} unit={m.primary.unit} note={m.primary.note} derived={m.primary.derived} convergence={m.primary.convergence} exact={m.primary.exact} />
          ) : (
            <div className={styles.readout} data-testid="primary-readout">
              <span className={styles.kicker}>Primary stored result</span>
              <span className={styles.readoutLabel}>{m.task}</span>
              <p className={styles.muted} data-testid="primary-none">{m.note ?? "No scalar quantity is stored for this result type; see the viewer below."}</p>
              <Tag intent={state.currentlyAuthoritative ? "success" : "warning"}>{state.currentlyAuthoritative ? "Current" : "Not current"}</Tag>
            </div>
          )}
          <dl className={styles.facts} data-testid="context-facts">
            <div><dt>Calculation</dt><dd>{m.task}</dd></div>
            <div><dt>Method</dt><dd>{m.method}</dd></div>
            <div><dt>Basis set</dt><dd>{m.basis}</dd></div>
            <div><dt>Engine</dt><dd>{m.engine}</dd></div>
            <div><dt>Charge / 2S+1</dt><dd>{m.electronic.charge} / {m.electronic.multiplicity}</dd></div>
            <div><dt>Input structure</dt><dd>{m.structure ? m.structure.label : "Unavailable"}</dd></div>
          </dl>
        </section>
        <AuthorityPanel view={state} />
        </div>
        <InputGeometryCard input={coordinates ? input : null} inputError={inputError ?? (input && !coordinates ? "The input version's metadata is inconsistent, so nothing is drawn." : null)} />
      </div>

      {m.viewer !== "energy" ? <ResultViewer kind={m.viewer} projectId={projectId} locale={locale} detail={detail} input={input} /> : null}

      <div className={`${styles.panel} ${styles.sections}`} aria-label="Evidence and reproducibility" data-testid="evidence-sections">
        <Section {...sectionProps("provenance")} title="Provenance" summary={`Producer ${result.trusted_producer_id} · input SHA-256 ${detail.calculation_input_hash.slice(0, 12)}…`}>
          <ProvenanceSection projectId={projectId} detail={detail} result={result} />
        </Section>
        {showNative ? (
          <Section {...sectionProps("evidence")} title="Native evidence" summary="Quantities parsed from the bound native log · original log download">
            <EvidenceSection projectId={projectId} detail={detail} />
          </Section>
        ) : null}
        <Section {...sectionProps("coordinates")} title="Coordinates" summary={coordinates ? `${coordinates.atoms.length} atoms · immutable input, hash-verified` : "Input unavailable"}>
          <CoordinatesSection detail={detail} input={input} inputError={inputError} />
        </Section>
        <Section {...sectionProps("artifacts")} title="Artifacts" summary={`${result.raw_artifacts.length} stored artifact${result.raw_artifacts.length === 1 ? "" : "s"} · SHA-256 and authorized download`}>
          <ArtifactsSection projectId={projectId} detail={detail} result={result} />
        </Section>
        <Section {...sectionProps("export")} title="Export & reports" summary="Result data, report and evidence archive, as supported by the stored data">
          <ExportSection projectId={projectId} calculationId={detail.calculation.id} />
        </Section>
      </div>
      <p className={styles.caption}>Values are the stored ones. Unit conversions are derived representations; energies of different levels of theory are not comparable.</p>
      {reuse ? <ReuseDialog projectId={projectId} locale={locale} calculationId={detail.calculation.id} onClose={() => setReuse(false)} /> : null}
    </div>
  );
}

export { INSPECTOR_SECTIONS };
