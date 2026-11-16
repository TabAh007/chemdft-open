"use client";

import { saveBlob } from "@/lib/download";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExternalImportDetail, StructureVersionDetail } from "@chemdft/schemas";
import { StructureVersionWorkbench } from "@/app/[locale]/projects/[projectId]/workspace/visualization/structure-version-workbench";
import { confirmExternalImport, getExternalImport } from "@/lib/external-import-api";
import { exportStructureVersion, getStructureVersion } from "@/lib/structure-workspace-api";
import {
  IMPORTED_RESULT_TITLE,
  asEnergy,
  asExcitations,
  asOptimization,
  asOrbitals,
  asStructure,
  asThermochemistry,
  asVibrations,
  importedTabs,
  methodBasisDisplay,
  programDisplay,
  tabForResultType,
  unavailableItems,
  type ImportedResultType,
  type ImportedTab,
} from "@/lib/imported-results";
import { ImportedBadge } from "./imported-badge";
import { ImportPreviewPanel } from "./import-preview-panel";
import { ImportedExcitationsPanel } from "./imported-excitations-panel";
import { ImportedOrbitalsPanel } from "./imported-orbitals-panel";
import { ImportedProvenancePanel } from "./imported-provenance-panel";
import { ImportedThermochemistryPanel } from "./imported-thermochemistry-panel";
import { ImportedVibrationsPanel } from "./imported-vibrations-panel";

const OPT_TEXT = { CONVERGED: "Converged", NOT_CONVERGED: "Not converged", NOT_REQUESTED: "Not requested" } as const;

/**
 * Workspace for one external import: the preview (before confirmation) or, once imported, the imported
 * calculation with Structure / IR / Raman / Excitations / Orbital energies / Thermochemistry / Provenance.
 * Used by both the Guided and Advanced workspaces.
 */
export function ImportedCalculationWorkspace({
  projectId,
  importId,
  initialResultId,
  active = true,
  onBack,
}: {
  projectId: string;
  importId: string;
  initialResultId?: string | undefined;
  active?: boolean | undefined;
  onBack?: (() => void) | undefined;
}) {
  const [detail, setDetail] = useState<ExternalImportDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [tab, setTab] = useState<ImportedTab | null>(null);
  const [structure, setStructure] = useState<StructureVersionDetail | null>(null);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getExternalImport({ projectId, importId });
      setDetail(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The imported calculation could not be opened.");
    }
  }, [projectId, importId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const imported = detail?.import_record.state === "IMPORTED";
  const results = useMemo(() => detail?.results ?? [], [detail]);
  const jobRow = detail?.jobs?.[0];

  // Land on the tab of the result that was opened (or Overview).
  useEffect(() => {
    if (!detail || !imported || tab !== null) return;
    const wanted = initialResultId ? results.find((item) => item.id === initialResultId) : undefined;
    const initial = wanted ? tabForResultType(wanted.result_type as ImportedResultType, asVibrations(results)?.payload) : "overview";
    queueMicrotask(() => setTab(initial));
  }, [detail, imported, initialResultId, results, tab]);

  useEffect(() => {
    if (!jobRow) return;
    let alive = true;
    void getStructureVersion({ projectId, structureId: jobRow.structure_id, versionId: jobRow.structure_version_id })
      .then((value) => { if (alive) setStructure(value); })
      .catch((cause: unknown) => { if (alive) setStructureError(cause instanceof Error ? cause.message : "The imported structure could not be loaded."); });
    return () => { alive = false; };
  }, [projectId, jobRow]);

  const sourceLabel = detail ? programDisplay(detail.import_record.preview.program) : "";

  useEffect(() => {
    if (!active || !detail) return;
    window.dispatchEvent(new CustomEvent("chemdft:workspace-selection", {
      detail: {
        projectId,
        currentView: `Imported calculation (${sourceLabel}) · ${detail.import_record.source.original_name}`,
      },
    }));
  }, [active, detail, projectId, sourceLabel]);

  async function confirm() {
    if (!detail) return;
    setImporting(true);
    setError(null);
    try {
      const next = await confirmExternalImport({ projectId, importId, previewSha256: detail.import_record.preview_sha256 });
      setDetail(next);
      setTab(null);
      window.dispatchEvent(new Event("chemdft:workspace-items-changed"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The import could not be completed.");
    } finally {
      setImporting(false);
    }
  }

  async function exportXyz() {
    if (!jobRow) return;
    try {
      const output = await exportStructureVersion({ projectId, structureId: jobRow.structure_id, versionId: jobRow.structure_version_id, fileFormat: "XYZ" });
      saveBlob(output.blob, output.filename);
      setNotice(`Exported ${output.filename}.`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Export failed.");
    }
  }

  if (error && !detail) return <p className="workspace-canvas-error" role="alert">{error}</p>;
  if (!detail) return <p className="workspace-canvas-loading" role="status">Loading imported calculation…</p>;

  const record = detail.import_record;
  const preview = record.preview;

  if (!imported) {
    return (
      <div className="imported-workspace imported-workspace--preview" data-testid="imported-workspace" data-import-state={record.state}>
        {onBack ? <button type="button" className="spectro-link-btn" onClick={onBack}>← Back</button> : null}
        {error ? <p className="import-error" role="alert" data-testid="import-error">{error}</p> : null}
        <ImportPreviewPanel
          view={record}
          importing={importing}
          onImport={record.state === "PREVIEW_READY" ? () => void confirm() : undefined}
        />
      </div>
    );
  }

  const job = preview.job;
  const tabs = importedTabs(results);
  const activeTab = tab ?? "overview";
  const vibrations = asVibrations(results)?.payload;
  const energy = asEnergy(results)?.payload;
  const optimization = asOptimization(results)?.payload;
  const structureResult = asStructure(results)?.payload;
  const excitations = asExcitations(results)?.payload;
  const orbitals = asOrbitals(results)?.payload;
  const thermo = asThermochemistry(results)?.payload;

  return (
    <div className="imported-workspace" data-testid="imported-workspace" data-import-state="IMPORTED">
      <header className="imported-workspace-head">
        <div>
          <h2 data-testid="imported-workspace-title">Imported calculation</h2>
          <p>
            {record.source.original_name} · {job?.job_type ?? jobRow?.source_job_type ?? ""}
            {job ? ` · ${methodBasisDisplay(job.method)}/${methodBasisDisplay(job.basis)}` : ""}
          </p>
        </div>
        <div className="imported-workspace-badges">
          <ImportedBadge source={sourceLabel} />
          <span className="import-chip import-chip--note">Not calculated by ChemDFT</span>
        </div>
      </header>

      <div role="tablist" aria-label="Imported calculation views" className="imported-tabs" data-testid="imported-tabs">
        {tabs.filter((item) => item.available).map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`imported-tab-${item.id}`}
            aria-selected={activeTab === item.id}
            aria-controls={`imported-panel-${item.id}`}
            data-testid={`imported-tab-${item.id}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`imported-panel-${activeTab}`} aria-labelledby={`imported-tab-${activeTab}`} className="imported-tabpanel">
        {activeTab === "overview" ? (
          <section className="imported-overview" data-testid="imported-overview">
            <dl className="imported-facts">
              <div><dt>Source</dt><dd data-testid="overview-source">{sourceLabel}</dd></div>
              <div><dt>Job type</dt><dd>{job?.job_type ?? jobRow?.source_job_type ?? "—"}</dd></div>
              <div><dt>Method</dt><dd>{job ? methodBasisDisplay(job.method) : "UNKNOWN"}</dd></div>
              <div><dt>Basis</dt><dd>{job ? methodBasisDisplay(job.basis) : "UNKNOWN"}</dd></div>
              <div><dt>Charge / multiplicity</dt><dd>{jobRow ? `${jobRow.charge} / ${jobRow.multiplicity}` : "—"}</dd></div>
              <div><dt>Termination</dt><dd>{job?.termination.status === "COMPLETED" ? "Terminated normally" : job?.termination.status ?? "—"}</dd></div>
              <div><dt>Optimization</dt><dd>{job ? OPT_TEXT[job.convergence.optimization.status] : "—"}</dd></div>
              {energy ? (
                <div>
                  <dt>SCF energy (as reported)</dt>
                  <dd data-testid="overview-scf-energy">{energy.scf_energy.value.toFixed(8)} Eh <em className="imported-raw">({energy.scf_energy.raw_value} {energy.scf_energy.raw_unit})</em></dd>
                </div>
              ) : null}
              {optimization ? <div><dt>Optimization frames</dt><dd>{optimization.frame_count}</dd></div> : null}
              {structureResult ? <div><dt>Atoms</dt><dd>{structureResult.atoms.length}</dd></div> : null}
            </dl>
            <h3>Imported results</h3>
            <ul className="imported-result-list" data-testid="imported-result-list">
              {results.map((result) => (
                <li key={result.id} data-testid={`imported-result-${result.result_type.replace("chemdft.imported.", "")}`}>
                  <strong>{IMPORTED_RESULT_TITLE[result.result_type as ImportedResultType]}</strong>
                  <button type="button" className="spectro-link-btn" onClick={() => setTab(tabForResultType(result.result_type as ImportedResultType, vibrations))}>Open</button>
                </li>
              ))}
            </ul>
            {unavailableItems(preview.items).length > 0 ? (
              <>
                <h3>Not available from this file</h3>
                <ul className="imported-unavailable" data-testid="imported-unavailable">
                  {unavailableItems(preview.items).map((item) => (
                    <li key={item.id}><strong>{item.title}</strong> <span>{item.detail}</span></li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}

        {activeTab === "structure" ? (
          <section className="imported-structure" data-testid="imported-structure">
            {structureError ? <p role="alert" className="workspace-canvas-error">{structureError}</p> : null}
            <div className="imported-structure-frame">
              {structure ? <StructureVersionWorkbench detail={structure} active={active} /> : !structureError ? <p role="status">Loading imported structure…</p> : null}
            </div>
            <div className="imported-structure-actions">
              <button type="button" className="spectro-link-btn" onClick={() => void exportXyz()} data-testid="imported-export-xyz">Export XYZ</button>
              {notice ? <span role="status">{notice}</span> : null}
            </div>
            <p className="imported-note">
              {optimization
                ? `Final geometry of a converged optimization reported by ${sourceLabel} (${optimization.frame_count} frames). `
                : `Geometry as reported by ${sourceLabel}. `}
              Source bond connectivity is not part of the output; displayed bonds are inferred for display only.
            </p>
          </section>
        ) : null}

        {activeTab === "ir" && vibrations ? (
          <ImportedVibrationsPanel kind="ir" payload={vibrations} sourceLabel={sourceLabel} structureVersion={structure} active={active} persistenceKey={`chemdft:imported-ir:${importId}`} />
        ) : null}
        {activeTab === "raman" && vibrations ? (
          <ImportedVibrationsPanel kind="raman" payload={vibrations} sourceLabel={sourceLabel} structureVersion={structure} active={active} persistenceKey={`chemdft:imported-raman:${importId}`} />
        ) : null}
        {activeTab === "excitations" && excitations ? <ImportedExcitationsPanel payload={excitations} sourceLabel={sourceLabel} /> : null}
        {activeTab === "orbitals" && orbitals ? <ImportedOrbitalsPanel payload={orbitals} sourceLabel={sourceLabel} /> : null}
        {activeTab === "thermochemistry" && thermo ? <ImportedThermochemistryPanel payload={thermo} sourceLabel={sourceLabel} /> : null}
        {activeTab === "provenance" ? <ImportedProvenancePanel detail={detail} /> : null}
      </div>
    </div>
  );
}
