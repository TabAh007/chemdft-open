"use client";

import { useMemo } from "react";
import type { StructureVersionDetail } from "@chemdft/schemas";
import { HelpTip } from "@/app/_components/help/help-tip";
import { deriveMolecularFormula } from "@/lib/scientific-format";
import { parseChargeInput } from "@/lib/guided-draft";
import { structureConnectivity } from "@/lib/structure-connectivity";
import { buildScientificScene } from "@chemdft/scientific-scene";
import type { GuidedConfig } from "@/lib/use-guided-config";
import styles from "./guided-workspace.module.css";

function sourceText(detail: StructureVersionDetail): string {
  const rawClass = detail.provenance?.source_class ?? detail.version.origin ?? "";
  if (detail.version.origin === "IMPORTED_CALCULATION") return "Imported from a calculation output (not calculated by ChemDFT)";
  if (rawClass.includes("USER_SUPPLIED") || rawClass.includes("IMPORTED")) return "Supplied by you";
  if (rawClass.includes("COMPUTED") || rawClass.includes("OPTIMIZED")) return "Calculated by ChemDFT";
  if (rawClass.includes("EXTRACTED") || rawClass.includes("LITERATURE")) return "Extracted from a paper";
  return "Imported coordinate file";
}

/**
 * Stage 1: look at the committed structure and confirm what the calculation needs from it. A structure that
 * exists is not a structure that has been scientifically reviewed, so nothing here is marked complete until the
 * server accepts the geometry and the researcher confirms the electronic-state inputs.
 */
export function GuidedStructureStage({ detail, config, onGenerate3d, canEdit }: {
  detail: StructureVersionDetail;
  config: GuidedConfig;
  onGenerate3d?: (() => void) | undefined;
  canEdit: boolean;
}) {
  const atoms = useMemo(() => detail.version.coordinates?.atoms ?? [], [detail.version.coordinates]);
  const formula = useMemo(() => deriveMolecularFormula(atoms), [atoms]);
  const connectivity = useMemo(() => {
    try { return structureConnectivity(buildScientificScene(detail)); } catch { return null; }
  }, [detail]);
  const { inputs, geometry, isPsi4, electronicLocked } = config;
  const reviewed = detail.provenance?.verification_state === "REVIEWED";
  const diagnostics = (detail.diagnostics ?? detail.version.diagnostics ?? []);
  const electronicDiagnostics = diagnostics.filter((d) => /charge|multiplicity|electronic|spin/i.test(d.message));
  const otherDiagnostics = diagnostics.filter((d) => !electronicDiagnostics.includes(d));

  return (
    <div className={styles.inspectorBody} data-testid="guided-structure-view">
      <div className={styles.section}>
        <h3>Committed structure</h3>
        <dl className={styles.facts}>
          <dt>Name</dt><dd><strong>{detail.structure.name}</strong> · V{detail.version.revision}</dd>
          {formula ? <><dt>Formula</dt><dd>{formula}</dd></> : null}
          <dt>Atoms</dt><dd>{atoms.length}</dd>
          <dt>Source <HelpTip topic="provenance.authority" /></dt><dd>{sourceText(detail)}</dd>
          <dt>Scientific review</dt>
          <dd>
            <span className={styles.tag} data-intent={reviewed ? "success" : "warning"} data-testid="structure-review-state">{reviewed ? "Reviewed" : "Not reviewed"}</span>
            {!reviewed ? <span className={styles.caption}> A successful import checks the file format, not the chemistry.</span> : null}
          </dd>
          <dt>Geometry</dt>
          <dd>
            {geometry.loading ? <span className={styles.tag}>Checking eligibility…</span>
              : geometry.error ? <span className={styles.tag} data-intent="danger">Could not verify</span>
              : geometry.eligible ? <span className={styles.tag} data-intent="success">Calculation-ready 3D geometry</span>
              : <span className={styles.tag} data-intent="warning">Not calculation-ready</span>}
          </dd>
          {connectivity ? <><dt>Connectivity</dt><dd>{connectivity.label}</dd></> : null}
        </dl>
      </div>

      {geometry.error ? (
        <div className={styles.notice} data-intent="danger" role="alert">
          <strong>Calculation eligibility could not be verified.</strong>
          <span>{geometry.error}</span>
          <button type="button" className={styles.secondary} onClick={geometry.retry}>Retry eligibility check</button>
        </div>
      ) : null}
      {geometry.eligibility && !geometry.eligibility.eligible ? (
        <div className={styles.notice} data-intent="warning" role="alert" data-testid="guided-geometry-ineligible">
          <strong>Valid 3D geometry required</strong>
          <span>{geometry.eligibility.detail || "This structure is a raw 2D drawing. Real 3D coordinates and explicit hydrogens are required before a calculation can run."}</span>
          {onGenerate3d && canEdit ? <button type="button" className={styles.secondary} onClick={onGenerate3d} data-testid="guided-generate-3d-for-2d-btn">Generate 3D with RDKit</button> : null}
        </div>
      ) : null}

      <div className={styles.section}>
        <h3>Electronic state for this calculation</h3>
        <p className={styles.caption}>
          Charge and spin multiplicity are inputs to every calculation. A coordinate file often carries neither, so the values recorded on this
          structure version can be placeholders. Confirm them before continuing.
        </p>
        {electronicDiagnostics.length > 0 ? (
          <div className={styles.notice} data-intent="warning" data-testid="electronic-state-diagnostics">
            <strong>Recorded by the importer</strong>
            <ul>{electronicDiagnostics.map((d, i) => <li key={`${d.code}-${i}`}>{d.message}</li>)}</ul>
          </div>
        ) : null}
        {electronicLocked ? (
          <div data-testid="electronic-state-locked">
            <div className={styles.row2}>
              <div className={styles.field}>
                <span className={styles.label} id="gw-charge-fixed-label">Total charge <HelpTip topic="structure.charge" /></span>
                <output className={styles.fixedValue} aria-labelledby="gw-charge-fixed-label" data-testid="gw-charge-fixed">{inputs.charge}</output>
              </div>
              <div className={styles.field}>
                <span className={styles.label} id="gw-multiplicity-fixed-label">Multiplicity (2S+1) <HelpTip topic="structure.multiplicity" /></span>
                <output className={styles.fixedValue} aria-labelledby="gw-multiplicity-fixed-label" data-testid="gw-multiplicity-fixed">{inputs.multiplicity}</output>
              </div>
            </div>
            <p className={styles.caption} data-testid="electronic-state-locked-note">Taken from the structure file; it cannot be changed here.</p>
          </div>
        ) : (
        <div className={styles.row2}>
          <div className={styles.field}>
            <span className={styles.label}><label htmlFor="gw-charge">Total charge</label> <HelpTip topic="structure.charge" /></span>
            <input id="gw-charge" type="number" step={1} value={inputs.charge ?? ""} disabled={!canEdit}
              onChange={(e) => config.setInputs({ charge: parseChargeInput(e.target.value) })} />
          </div>
          <div className={styles.field}>
            <span className={styles.label}><label htmlFor="gw-multiplicity">Multiplicity (2S+1)</label> <HelpTip topic="structure.multiplicity" /></span>
            <input id="gw-multiplicity" type="number" min={1} step={1} value={inputs.multiplicity} disabled={!canEdit}
              onChange={(e) => config.setInputs({ multiplicity: Math.max(1, Number.parseInt(e.target.value, 10) || 1) })} />
          </div>
        </div>
        )}
        {inputs.charge === null ? (
          <p className={styles.caption} data-testid="charge-empty-hint">
            Enter the overall electric charge for this species (e.g. 0 for neutral, 1 for cation, -1 for anion).
          </p>
        ) : config.electronicState.status === "invalid" ? (
          <div className={styles.notice} data-intent="danger" role="alert" data-testid="electronic-state-impossible">
            <strong>This electronic state is impossible</strong>
            <span>{config.electronicState.message}</span>
          </div>
        ) : config.electronicState.status === "ok" ? (
          <p className={styles.caption} data-testid="electronic-state-no-impossibility">
            {config.electronicState.electrons} electrons: no impossibility found. This counts electrons only; it does not show the state is the right one for this chemistry.
          </p>
        ) : null}
        {inputs.confirmed
          ? <p><span className={styles.tag} data-intent="success" data-testid="inputs-confirmed">Confirmed for this calculation</span> <span className={styles.caption}>Editing either value asks for confirmation again.</span></p>
          : <p><span className={styles.tag} data-intent="warning" data-testid="inputs-unconfirmed">Not yet confirmed</span></p>}
        {isPsi4 ? <p className={styles.caption}>Psi4 accepts neutral closed-shell singlets only (charge 0, multiplicity 1).</p> : null}
      </div>

      <details className={styles.disclosure}>
        <summary>Technical details</summary>
        <div className={styles.disclosureBody}>
          <dl className={styles.facts}>
            <dt>Version ID</dt><dd className={styles.mono}>{detail.version.id}</dd>
            <dt>Origin</dt><dd>{detail.version.origin}</dd>
            <dt>Coordinate system</dt><dd>{detail.version.coordinates?.coordinate_system ?? "CARTESIAN"}</dd>
            <dt>Stored bonds</dt><dd>{connectivity?.authoritativeCount ?? 0}</dd>
          </dl>
          {otherDiagnostics.length > 0 ? <ul>{otherDiagnostics.map((d, i) => <li key={`${d.code}-${i}`} className={styles.caption}><strong>{d.code}</strong> {d.message}</li>)}</ul> : <p className={styles.caption}>No other structure diagnostics were recorded.</p>}
        </div>
      </details>
    </div>
  );
}
