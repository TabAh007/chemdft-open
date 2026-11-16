"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import type { NavigatorFactsSummary, NavigatorState } from "@chemdft/schemas";
import type { Locale } from "@chemdft/i18n";
import { AppIcon } from "@chemdft/ui";
import { crystalFormulas, plural, selectionHref } from "@/lib/overview-model";
import { bondBasis, structureAuthority, viewerStructure, type ActiveStructure } from "@/lib/overview-structure";
import { FormulaText, StructureThumb } from "../projects/structure-thumbnail";
import { StructureViewer } from "./overview-viewer";
import styles from "./overview.module.css";

export type StructureLoad =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "none" }
  | { status: "error" }
  | { status: "ready"; value: ActiveStructure };

const TYPE_LABEL: Record<string, string> = { molecule: "Molecule", crystal: "Periodic crystal" };

function Fact({ term, children, attention }: { term: string; children: ReactNode; attention?: boolean }) {
  return (
    <div data-attention={attention || undefined}>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * What structure am I studying? The product renderer draws the committed coordinates large and interactively;
 * the structure's own facts sit beside it. Nothing here is generated: no committed structure, no molecule.
 */
export function StructureStage({ projectId, locale, load, facts, state, actionHref, recommendedId }: {
  projectId: string; locale: Locale; load: StructureLoad; facts: NavigatorFactsSummary | undefined; state: NavigatorState | null; actionHref: (actionId: string) => string | null;
  /** The single prioritised recommendation; the structure card never repeats it. */
  recommendedId: string | null;
}) {
  const ready = load.status === "ready" ? load.value : null;
  const viewer = useMemo(() => (ready ? viewerStructure(ready.detail) : null), [ready]);
  const heading = <h2 className={styles.kicker} id="overview-structure-title">Structure</h2>;

  if (load.status === "idle" || load.status === "loading") {
    return (
      <section className={styles.stage} aria-labelledby="overview-structure-title" aria-busy="true" data-testid="overview-structure">
        <div className={styles.stageHead}>{heading}</div>
        <div className={styles.stageBody}>
          <div className={styles.viewer}><div className={styles.viewport}><StructureThumb result={undefined} size="fill" /></div></div>
          <p className={styles.muted} role="status">Reading the committed structure…</p>
        </div>
      </section>
    );
  }
  if (load.status === "none" || load.status === "error") {
    const none = load.status === "none";
    return (
      <section className={styles.stage} aria-labelledby="overview-structure-title" data-testid="overview-structure">
        <div className={styles.stageHead}>{heading}</div>
        <div className={styles.stageBody}>
          <div className={styles.viewer}><div className={styles.viewport}><StructureThumb result={{ status: none ? "none" : "unavailable" }} size="fill" /></div></div>
          <div className={styles.emptyCopy}>
            <p className={styles.emptyTitle}>{none ? "No committed scientific structure yet." : "The committed structure could not be read."}</p>
            <p className={styles.muted} role={none ? undefined : "alert"}>
              {none ? "Use the recommended action to import coordinates or draw a molecule, then commit it. Nothing is assumed or generated for an empty project." : "No preview is shown. Refresh the Navigator to retry."}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const { detail, preview } = load.value;
  const authority = structureAuthority(detail);
  const model = preview.status === "ready" ? preview.model : null;
  const periodic = (model?.kind ?? (facts?.structure_type === "crystal" ? "periodic" : "molecule")) === "periodic";
  const composition = state?.have.find((item) => item.state_id === "structure.composition")?.detail ?? null;
  const elements = (detail.version.coordinates?.atoms ?? []).map((atom) => atom.element);
  const crystal = periodic && elements.length ? crystalFormulas(elements) : null;
  const atoms = facts?.atom_count ?? detail.version.coordinates?.atoms.length ?? null;
  const cell = detail.version.periodic_cell;
  const bonds = bondBasis(viewer);
  const inspectHref = selectionHref(locale, projectId, { kind: "structureVersion", id: detail.version.id, projectId, sourceId: detail.structure.id });
  // Contextual actions only: never the recommendation, and Edit only when the server offers it (editor access).
  const showInspect = recommendedId !== "structure.inspect";
  const editHref = recommendedId === "structure.edit" ? null : actionHref("structure.edit");
  const fallback = <StructureThumb result={preview} size="fill" />;
  return (
    <section className={styles.stage} aria-labelledby="overview-structure-title" data-testid="overview-structure">
      <div className={styles.stageHead}>
        {heading}
        <span className={styles.versionTag}>V{detail.version.revision} · committed</span>
      </div>
      <div className={styles.stageBody}>
        {viewer ? <StructureViewer structure={viewer} fallback={fallback} name={detail.structure.name} /> : <div className={styles.viewer}><div className={styles.viewport}>{fallback}</div><p className={styles.caption}>{preview.status === "large" ? "Too many atoms for a preview; open the structure to inspect it." : "The coordinates could not be drawn here."}</p></div>}
        <div className={styles.structureInfo}>
          <h3 className={styles.structureName}>{detail.structure.name}</h3>
          <p className={styles.formula} data-testid="structure-formula">{crystal ? <FormulaText formula={crystal.reduced ?? crystal.cell} /> : model ? <FormulaText formula={model.formula} /> : composition ?? "—"}</p>
          {crystal?.reduced ? <p className={styles.caption} data-testid="cell-composition">Reduced formula · unit cell <strong><FormulaText formula={crystal.cell} /></strong> ({plural(crystal.atoms, "atom")})</p> : crystal ? <p className={styles.caption} data-testid="cell-composition">Unit-cell composition ({plural(crystal.atoms, "atom")})</p> : null}
          <dl className={styles.facts}>
            <Fact term={periodic ? "Atoms in cell" : "Atoms"}>{atoms ?? "—"}</Fact>
            <Fact term="Type">{TYPE_LABEL[facts?.structure_type ?? ""] ?? (periodic ? "Periodic crystal" : "Molecule")}</Fact>
            {periodic ? (
              <>
                <Fact term="Lattice a · b · c">{cell ? `${cell.a.toFixed(3)} · ${cell.b.toFixed(3)} · ${cell.c.toFixed(3)} Å` : "not recorded"}</Fact>
                <Fact term="Angles α · β · γ">{cell ? `${cell.alpha.toFixed(2)} · ${cell.beta.toFixed(2)} · ${cell.gamma.toFixed(2)}°` : "not recorded"}</Fact>
              </>
            ) : (
              <>
                <Fact term="Charge" attention={facts?.charge == null}>{facts?.charge != null ? facts.charge : "not recorded"}</Fact>
                <Fact term="Multiplicity" attention={facts?.multiplicity == null}>{facts?.multiplicity != null ? facts.multiplicity : "not recorded"}</Fact>
              </>
            )}
            <Fact term="Version">V{detail.version.revision}</Fact>
            <Fact term="Origin">{detail.version.origin.toLowerCase()}</Fact>
          </dl>
          <p className={styles.authority}>
            <span title="Source classification recorded with this structure version">{authority.source}</span>
            <span title="Review state recorded with this structure version">{authority.verification}</span>
          </p>
          <p className={styles.caption} data-bonds={bonds.kind}>{bonds.text}</p>
          {showInspect || editHref ? (
            <div className={styles.stageActions}>
              {showInspect ? <Link className="bp6-button" href={inspectHref}><span>Open in workspace</span><AppIcon icon="arrow-right" /></Link> : null}
              {editHref ? <a className="bp6-button bp6-minimal" href={editHref}><span>Edit structure</span></a> : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
