"use client";

import { useEffect, useMemo, useState } from "react";
import type { StructureVersionDetail } from "@chemdft/schemas";
import { positionLetter, type CompareItem } from "@/lib/compare-model";
import { bondBasis, viewerStructure } from "@/lib/overview-structure";
import { buildPreviewModel } from "@/lib/project-structure-preview";
import { listStructureVersions } from "@/lib/structure-workspace-api";
import { StructureThumb } from "../projects/structure-thumbnail";
import { StructureViewer } from "../overview/overview-viewer";
import styles from "./compare.module.css";

type Loaded = { status: "loading" } | { status: "ready"; detail: StructureVersionDetail } | { status: "unavailable"; reason: string };

/**
 * Reads the immutable structure version each selected result was calculated from (by the version id the result row
 * records). Nothing is aligned, transformed or re-bonded: each viewer draws the stored coordinates of its own version.
 */
function useStructureVersions(projectId: string, items: readonly CompareItem[]): ReadonlyMap<string, Loaded> {
  const [store, setStore] = useState<{ projectId: string; byVersion: Map<string, Loaded> }>({ projectId, byVersion: new Map() });
  const current = store.projectId === projectId ? store.byVersion : new Map<string, Loaded>();
  const wanted = items.filter((item) => item.structureId && item.structureVersionId && !current.has(item.structureVersionId));
  const wantedKey = wanted.map((item) => item.structureVersionId).join(",");
  useEffect(() => {
    if (wanted.length === 0) return;
    let alive = true;
    const bySt = new Map<string, string[]>();
    for (const item of wanted) bySt.set(item.structureId!, [...(bySt.get(item.structureId!) ?? []), item.structureVersionId!]);
    for (const [structureId, versionIds] of bySt) {
      void listStructureVersions(projectId, structureId)
        .then((versions) => {
          if (!alive) return;
          setStore((previous) => {
            const byVersion = new Map(previous.projectId === projectId ? previous.byVersion : []);
            for (const id of versionIds) {
              const detail = versions.find((v) => v.version.id === id);
              byVersion.set(id, detail ? { status: "ready", detail } : { status: "unavailable", reason: "The structure version this result was calculated from is not available." });
            }
            return { projectId, byVersion };
          });
        })
        .catch((cause: unknown) => {
          if (!alive) return;
          setStore((previous) => {
            const byVersion = new Map(previous.projectId === projectId ? previous.byVersion : []);
            for (const id of versionIds) byVersion.set(id, { status: "unavailable", reason: cause instanceof Error ? cause.message : "The structure could not be loaded." });
            return { projectId, byVersion };
          });
        });
    }
    return () => { alive = false; };
    // `wanted` is represented by its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, wantedKey]);
  return current;
}

function StructureCard({ item, index, loaded }: { item: CompareItem; index: number; loaded: Loaded | undefined }) {
  const detail = loaded?.status === "ready" ? loaded.detail : null;
  const structure = useMemo(() => (detail ? viewerStructure(detail) : null), [detail]);
  const preview = useMemo(() => (detail ? buildPreviewModel(detail) : ({ status: "unavailable" } as const)), [detail]);
  const reference = index === 0;
  return (
    <article className={styles.structure} data-reference={reference} data-testid="compare-structure" data-result-id={item.resultId}>
      <header>
        <span className={styles.letter} data-reference={reference}>{positionLetter(index)}</span>
        <span>{item.structureText}</span>
        <span className={styles.caption} style={{ marginLeft: "auto", fontWeight: 400 }}>{reference ? "Reference" : item.taskText}</span>
      </header>
      <div className={styles.viewerBody}>
        {structure && detail ? (
          <StructureViewer structure={structure} fallback={<StructureThumb result={preview} size="fill" />} name={`${detail.structure.name} version ${detail.version.revision}`} />
        ) : loaded?.status === "unavailable" ? (
          <p className={styles.notice} data-intent="warning" role="note"><strong>No geometry drawn</strong><span>{loaded.reason}</span></p>
        ) : item.structureVersionId ? (
          <p className={styles.muted} role="status">Loading the stored structure…</p>
        ) : (
          <p className={styles.notice} data-intent="warning" role="note"><strong>No geometry drawn</strong><span>This result records no structure version.</span></p>
        )}
      </div>
      <p className={styles.caption} data-testid="compare-structure-basis">
        Input geometry of immutable structure version{detail ? ` V${detail.version.revision}` : ""}; coordinates are drawn exactly as stored, not aligned or overlaid.{" "}
        {structure ? bondBasis(structure).text : ""}
      </p>
    </article>
  );
}

/** The recorded input geometry of each selected result, side by side, in the product's one molecular viewer. */
export default function StructuresView({ projectId, items }: { projectId: string; items: readonly CompareItem[] }) {
  const loaded = useStructureVersions(projectId, items);
  return (
    <div className={styles.tabPanel} data-testid="compare-structures">
      <div className={styles.structures}>
        {items.map((item, index) => <StructureCard key={item.resultId} item={item} index={index} loaded={item.structureVersionId ? loaded.get(item.structureVersionId) : undefined} />)}
      </div>
      <p className={styles.caption}>Same atoms and different coordinates are not an identical geometry; the Rules tab reports each pairing&apos;s geometry relation and RMSD as the platform computed it. For an optimization result, its final geometry is in the Result Inspector.</p>
    </div>
  );
}
