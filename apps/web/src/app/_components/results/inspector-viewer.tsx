"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { Locale } from "@chemdft/i18n";
import type { CalculationDetail, MolecularOrbitalAnalysis, StructureVersionDetail } from "@chemdft/schemas";
import { buildPreviewModel } from "@/lib/project-structure-preview";
import { viewerStructure, bondBasis } from "@/lib/overview-structure";
import { resultWorkspacePath } from "@/lib/job-view";
import type { ViewerKind } from "@/lib/result-inspector-model";
import { StructureThumb } from "../projects/structure-thumbnail";
import { StructureViewer } from "../overview/overview-viewer";
import styles from "./results-ui.module.css";

const OptimizationTrajectoryPanel = dynamic(() => import("../../[locale]/projects/[projectId]/workspace/visualization/optimization-trajectory-panel").then((m) => m.OptimizationTrajectoryPanel), { ssr: false });
const ConformerEnsembleExplorer = dynamic(() => import("../conformers/conformer-ensemble-explorer").then((m) => m.ConformerEnsembleExplorer), { ssr: false });
const Dftd4ResultView = dynamic(() => import("../dftd4-correction").then((m) => m.Dftd4ResultView), { ssr: false });
const GuidedResultView = dynamic(() => import("../guided/guided-result-view").then((m) => m.GuidedResultView), { ssr: false });

/**
 * The input geometry that produced the result, drawn by the product renderer from the hash-verified immutable input.
 * Only coordinates that exist are drawn; if the input cannot be verified, nothing is drawn in its place.
 */
export function InputGeometryCard({ input, inputError }: { input: StructureVersionDetail | null; inputError: string | null }) {
  const structure = useMemo(() => (input ? viewerStructure(input) : null), [input]);
  const preview = useMemo(() => (input ? buildPreviewModel(input) : ({ status: "unavailable" } as const)), [input]);
  return (
    <section className={`${styles.panel} ${styles.viewerCard}`} aria-label="Input geometry" data-testid="input-geometry">
      <header>
        <span className={styles.kicker}>Input geometry</span>
        <span className={styles.caption}>{input ? `${input.structure.name} · V${input.version.revision} · immutable` : "unavailable"}</span>
      </header>
      <div className={styles.viewerBody}>
        {input && structure
          ? <StructureViewer structure={structure} fallback={<StructureThumb result={preview} size="fill" />} name={input.structure.name} />
          : <div className={styles.notice} data-intent="warning" role="note"><strong>No geometry drawn</strong><span>{inputError ?? "The exact hash-bound input could not be verified, so no geometry is shown."}</span></div>}
      </div>
      {input && structure ? <p className={styles.caption} data-testid="bond-basis">{bondBasis(structure).text}</p> : null}
    </section>
  );
}

/**
 * The scientific viewer for result types that have one reachable from Results. Everything is the existing, deterministic
 * viewer; types without one say so and link to the workbench rather than showing an invented plot.
 */
export function ResultViewer({ kind, projectId, locale, detail, input }: {
  kind: ViewerKind; projectId: string; locale: Locale; detail: CalculationDetail; input: StructureVersionDetail | null;
}) {
  const result = detail.result;
  if (!result || kind === "energy") return null;
  const noop = () => {};
  const workbench = resultWorkspacePath(locale, projectId, detail.calculation.id, result.id);
  return (
    <section className={`${styles.panel} ${styles.panelPad}`} aria-label="Scientific viewer" data-testid="result-viewer" data-viewer={kind}>
      {kind === "orbitals" && input ? (
        <GuidedResultView projectId={projectId} calculationId={detail.calculation.id} resultId={result.id} result={result.payload as MolecularOrbitalAnalysis}
          initialTab="MO" onOptimizeGeometry={noop} onOpenAiScientist={() => window.dispatchEvent(new CustomEvent("chemdft:open-ai-scientist"))}
          onNavigateStructure={noop} onNavigateHome={noop} onSwitchToAdvanced={noop} />
      ) : kind === "optimization" ? (
        <OptimizationTrajectoryPanel key={detail.calculation.id} projectId={projectId} detail={detail} onOpenFinal={noop} />
      ) : kind === "conformers" ? (
        <ConformerEnsembleExplorer projectId={projectId} calculationId={detail.calculation.id} resultId={result.id} detail={detail} {...(input ? { inputStructure: input } : {})} />
      ) : kind === "dispersion" ? (
        <Dftd4ResultView key={detail.calculation.id} projectId={projectId} initial={detail} />
      ) : (
        <div className={styles.notice} data-intent="info" role="note" data-testid="viewer-unsupported">
          <strong>No Results viewer for this result type</strong>
          <span>Nothing is plotted or generated here. The stored result, its authority and its evidence below are unchanged; the scientific workbench has this type&apos;s dedicated viewer.</span>
          <span><Link className={styles.link} href={workbench}>Open in the scientific workbench</Link></span>
        </div>
      )}
    </section>
  );
}
