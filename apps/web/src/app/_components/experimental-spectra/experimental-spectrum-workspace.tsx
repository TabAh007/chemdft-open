"use client";

import { HelpTip } from "@/app/_components/help/help-tip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssociationState, SpectrumArraysView, SpectrumComparisonView, SpectrumDatasetView } from "@chemdft/schemas";
import {
  getSpectrumArrays,
  listSpectrumComparisons,
  listSpectrumDatasets,
  setSpectrumAssociation,
} from "@/lib/experimental-spectra-api";
import {
  TECHNIQUE_LABEL,
  authorityText,
  conventionalInversion,
  descendants,
  evidenceLabel,
  evidenceTone,
  opLabel,
  peakSetsFor,
  xUnitText,
  yUnitText,
  type EvidenceKind,
  type Trace,
} from "@/lib/experimental-spectra";
import { ExperimentalSpectrumChart, type ChartPeak } from "./experimental-spectrum-chart";
import { SpectrumComparePanel } from "./spectrum-compare-panel";
import { SpectrumProcessingPanel } from "./spectrum-processing-panel";
import { SpectrumProvenancePanel } from "./spectrum-provenance-panel";

type Tab = "raw" | "processed" | "peaks" | "compare" | "provenance";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "raw", label: "Raw" },
  { id: "processed", label: "Processed" },
  { id: "peaks", label: "Peaks" },
  { id: "compare", label: "Compare" },
  { id: "provenance", label: "Provenance" },
];
const DISPLAY_POINTS = 4000;

export interface ExperimentalSpectrumWorkspaceProps {
  projectId: string;
  datasetId?: string | undefined;
  active?: boolean | undefined;
  structures: Array<{ id: string; name: string }>;
  onImport: () => void;
  onBack?: (() => void) | undefined;
  /** Open on this tab (used when returning to a comparison). */
  initialTab?: Tab | undefined;
}

/**
 * The experimental spectrum workspace: one measured spectrum, its immutable raw data, every version made from it, detected peaks and
 * comparisons with calculated or imported results. Used by both the Guided and Advanced workspaces.
 */
export function ExperimentalSpectrumWorkspace({ projectId, datasetId, active = true, structures, onImport, onBack, initialTab }: ExperimentalSpectrumWorkspaceProps) {
  const [datasets, setDatasets] = useState<SpectrumDatasetView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rootId, setRootId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [peakSetId, setPeakSetId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab ?? "raw");
  const [arrays, setArrays] = useState<Record<string, SpectrumArraysView>>({});
  const [comparisons, setComparisons] = useState<SpectrumComparisonView[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const requested = useRef(new Set<string>());

  const reload = useCallback(async (preferRoot?: string) => {
    try {
      const output = await listSpectrumDatasets(projectId);
      setDatasets(output.datasets);
      setError(null);
      setRootId((current) => {
        const raws = output.datasets.filter((item) => item.kind === "RAW");
        const wanted = preferRoot ?? current ?? (datasetId ? (output.datasets.find((item) => item.id === datasetId)?.lineage[0] ?? datasetId) : undefined);
        return raws.some((item) => item.id === wanted) ? wanted! : (raws[0]?.id ?? null);
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The experimental spectra could not be loaded.");
    }
  }, [projectId, datasetId]);

  useEffect(() => { queueMicrotask(() => void reload()); }, [reload]);
  useEffect(() => {
    const handler = () => void reload();
    window.addEventListener("chemdft:workspace-items-changed", handler);
    return () => window.removeEventListener("chemdft:workspace-items-changed", handler);
  }, [reload]);

  const all = useMemo(() => datasets ?? [], [datasets]);
  const root = all.find((item) => item.id === rootId) ?? null;
  const family = useMemo(() => (root ? [root, ...descendants(all, root.id)] : []), [all, root]);
  const versions = family.filter((item) => item.kind !== "PEAKS");
  const version = versions.find((item) => item.id === versionId) ?? root;
  const parentOfVersion = version?.parent_dataset_id ? (all.find((item) => item.id === version.parent_dataset_id) ?? null) : null;
  const versionPeakSets = version ? peakSetsFor(all, version.id) : [];
  const peakSet = versionPeakSets.find((item) => item.id === peakSetId) ?? versionPeakSets[versionPeakSets.length - 1] ?? null;
  const focus = tab === "peaks" && peakSet ? peakSet : version;

  // Open the dataset the caller asked for (a version or a peak set), once.
  const openedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!datasetId || !datasets || openedFor.current === datasetId) return;
    const wanted = datasets.find((item) => item.id === datasetId);
    if (!wanted) return;
    openedFor.current = datasetId;
    queueMicrotask(() => {
      setRootId(wanted.lineage[0] ?? wanted.id);
      setTab(wanted.kind === "PEAKS" ? "peaks" : wanted.kind === "RAW" ? "raw" : "processed");
      if (wanted.kind === "PEAKS") { setVersionId(wanted.parent_dataset_id); setPeakSetId(wanted.id); }
      else { setVersionId(wanted.id); setPeakSetId(null); }
    });
  }, [datasetId, datasets]);

  const neededKey = [root?.id, version?.id, parentOfVersion?.id].filter((id): id is string => Boolean(id)).join(",");
  useEffect(() => {
    for (const id of neededKey ? neededKey.split(",") : []) {
      if (requested.current.has(id)) continue;
      requested.current.add(id);
      void getSpectrumArrays({ projectId, datasetId: id, maxPoints: DISPLAY_POINTS })
        .then((value) => setArrays((previous) => ({ ...previous, [id]: value })))
        .catch((cause: unknown) => { requested.current.delete(id); setError(cause instanceof Error ? cause.message : "The spectrum arrays could not be loaded."); });
    }
  }, [neededKey, projectId]);

  useEffect(() => {
    if (!root) return;
    let alive = true;
    void listSpectrumComparisons({ projectId }).then((output) => { if (alive) setComparisons(output.comparisons.filter((item) => family.some((member) => member.id === item.experimental_dataset_id))); }).catch(() => undefined);
    return () => { alive = false; };
  }, [projectId, root, family]);

  useEffect(() => {
    if (!active || !root) return;
    window.dispatchEvent(new CustomEvent("chemdft:workspace-selection", {
      detail: {
        projectId,
        currentView: `Experimental spectrum → ${root.name} → ${TABS.find((item) => item.id === tab)?.label}${version && version.id !== root.id ? ` → ${version.name}` : ""}`,
        selectionName: version?.name ?? root.name,
        datasetName: root.name,
        experimentalSpectrum: { datasetId: root.id, versionId: version?.id ?? root.id, peakSetId: peakSet?.id ?? null, tab },
      },
    }));
  }, [active, projectId, root, version, peakSet, tab]);

  async function created(dataset: SpectrumDatasetView) {
    setNotice(null);
    await reload(root?.id);
    if (dataset.kind === "PEAKS") { setPeakSetId(dataset.id); setTab("peaks"); setNotice(`Peak set created: ${dataset.peak_set?.peak_count ?? 0} peaks (derived, not raw).`); }
    else {
      setVersionId(dataset.id); setPeakSetId(null); setTab("processed");
      const warnings = dataset.transform?.warnings ?? [];
      setNotice(`New version created: ${dataset.name}. ${warnings.length ? `${warnings.length} warning${warnings.length === 1 ? "" : "s"} below.` : ""} The version it came from is unchanged.`);
    }
  }

  if (error && !datasets) return <p className="workspace-canvas-error" role="alert" data-testid="spectrum-workspace-error">{error}</p>;
  if (!datasets) return <p className="workspace-canvas-loading" role="status">Loading experimental spectra…</p>;
  if (!root || !version) {
    return (
      <div className="xspec-empty" data-testid="spectrum-workspace-empty">
        <h2>No experimental spectra yet</h2>
        <p>Import a measured IR/FTIR, Raman or UV/Vis spectrum from a plain-text file. You will see exactly what was read and confirm every unit before anything is stored.</p>
        <button type="button" className="import-primary-btn" onClick={onImport} data-testid="spectrum-empty-import">Import experimental spectrum</button>
      </div>
    );
  }

  const authority = authorityText(version);
  const rootArrays = arrays[root.id];
  const versionArrays = arrays[version.id];
  const parentArrays = parentOfVersion ? arrays[parentOfVersion.id] : undefined;
  const unit = version.x.definition.unit.code;
  const inverted = conventionalInversion(version.technique, unit);
  const yLabel = `${version.y.definition.label} (${yUnitText(version.y.definition.unit.code)})`;
  const xLabel = `${version.x.definition.label} (${xUnitText(unit)})`;

  const rawTraces: Trace[] = rootArrays ? [{ id: "raw", label: `Raw measurement · ${root.name}`, x: rootArrays.x, y: rootArrays.y, style: "raw" }] : [];
  const processedTraces: Trace[] = (() => {
    if (!versionArrays) return [];
    if (version.id === root.id) return [{ id: "raw", label: "Raw measurement (nothing has been processed yet)", x: versionArrays.x, y: versionArrays.y, style: "raw" }];
    const out: Trace[] = [];
    if (parentArrays) out.push({ id: "input", label: `Input · ${parentOfVersion?.name}`, x: parentArrays.x, y: parentArrays.y, style: "raw" });
    if (versionArrays.baseline && versionArrays.baseline_x) out.push({ id: "baseline", label: "Estimated baseline", x: versionArrays.baseline_x, y: versionArrays.baseline, style: "baseline" });
    out.push({ id: "version", label: version.transform ? `${opLabel(version.transform.op)}${versionArrays.baseline ? " · corrected" : ""}` : version.name, x: versionArrays.x, y: versionArrays.y, style: versionArrays.baseline ? "corrected" : "processed" });
    return out;
  })();
  const peakMarkers: ChartPeak[] = peakSet?.peak_set ? peakSet.peak_set.peaks.map((p, i) => ({ index: i, x: p.x, y: p.y, label: p.x.toFixed(version.technique === "UVVIS" ? 1 : 0) })) : [];
  const latestWarnings = version.transform?.warnings ?? [];

  return (
    <div className="xspec-workspace" data-testid="spectrum-workspace">
      <header className="xspec-identity" data-testid="spectrum-identity">
        <div className="xspec-identity-main">
          {onBack ? <button type="button" className="xspec-link-btn" onClick={onBack}>← Overview</button> : null}
          <h2 data-testid="spectrum-title">{root.name}</h2>
          <div className="xspec-chips">
            <span className="xspec-badge" data-tone="raw">{TECHNIQUE_LABEL[root.technique]}</span>
            <span className="xspec-badge" data-tone={authority.tone} data-testid="spectrum-authority" title={authority.detail}>{authority.label}</span>
            {datasets.filter((item) => item.kind === "RAW").length > 1 ? (
              <select value={root.id} aria-label="Experimental spectrum" onChange={(event) => { setRootId(event.currentTarget.value); setVersionId(null); setPeakSetId(null); setTab("raw"); }} data-testid="spectrum-picker">
                {datasets.filter((item) => item.kind === "RAW").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            ) : null}
          </div>
          <dl className="xspec-identity-facts">
            <div data-testid="spectrum-identity-x"><dt>x</dt><dd>{root.x.definition.label} · {xUnitText(root.x.definition.unit.code)} <small data-tone={evidenceTone(root.x.unit_evidence as EvidenceKind)}>{evidenceLabel(root.x.unit_evidence as EvidenceKind)}</small></dd></div>
            <div data-testid="spectrum-identity-y"><dt>signal</dt><dd>{root.y.definition.label} · {yUnitText(root.y.definition.unit.code)} <small data-tone={evidenceTone(root.y.unit_evidence as EvidenceKind)}>{evidenceLabel(root.y.unit_evidence as EvidenceKind)}</small></dd></div>
            <div><dt>points</dt><dd>{root.point_count.toLocaleString()} · {root.x_min}–{root.x_max} {xUnitText(root.x.definition.unit.code)}</dd></div>
            <div><dt>source</dt><dd>{root.source?.original_name ?? "—"} <small className="xspec-hash">{root.source?.sha256.slice(0, 10)}…</small></dd></div>
          </dl>
        </div>
        <AssociationEditor key={`${root.id}:${root.association.id ?? "none"}`} projectId={projectId} root={root} structures={structures} onSaved={() => void reload(root.id)} />
      </header>

      <div className="xspec-layout">
        <nav className="xspec-versions" aria-label="Versions" data-testid="spectrum-versions">
          <h3>Versions</h3>
          <ul>
            {versions.map((item) => {
              const depth = item.lineage.length;
              const peakSetsOfItem = peakSetsFor(all, item.id);
              return (
                <li key={item.id} style={{ paddingLeft: depth * 12 }}>
                  <button type="button" className={`xspec-version${item.id === version.id && tab !== "peaks" ? " is-active" : ""}`} onClick={() => { setVersionId(item.id); setPeakSetId(null); if (tab === "raw") setTab(item.id === root.id ? "raw" : "processed"); }} data-testid={`spectrum-version-${item.id}`} data-kind={item.kind}>
                    <strong>{item.id === root.id ? "Raw" : opLabel(item.transform?.op ?? "")}</strong>
                    <span>{item.id === root.id ? "as imported" : item.name}</span>
                    <em>{item.state}</em>
                  </button>
                  {peakSetsOfItem.map((ps) => (
                    <button key={ps.id} type="button" className={`xspec-version xspec-version-peaks${ps.id === peakSet?.id && tab === "peaks" ? " is-active" : ""}`} style={{ marginLeft: 12 }} onClick={() => { setVersionId(item.id); setPeakSetId(ps.id); setTab("peaks"); }} data-testid={`spectrum-peakset-${ps.id}`}>
                      <strong>Peaks</strong><span>{ps.peak_set?.peak_count ?? 0} detected</span><em>DERIVED · NOT RAW</em>
                    </button>
                  ))}
                </li>
              );
            })}
          </ul>
          <p className="xspec-note">The raw data are never edited. Every action creates a new version that remembers its parent.</p>
          <button type="button" className="import-secondary-btn" onClick={onImport} data-testid="spectrum-import-another">Import another spectrum</button>
        </nav>

        <div className="xspec-main">
          <div role="tablist" className="xspec-tabs" aria-label="Spectrum views">
            {TABS.map((item) => (
              <button key={item.id} role="tab" type="button" aria-selected={tab === item.id} className={tab === item.id ? "is-active" : undefined} onClick={() => setTab(item.id)} data-testid={`spectrum-tab-${item.id}`}>{item.label}</button>
            ))}
          </div>
          {notice ? <p className="xspec-notice" role="status" data-testid="spectrum-notice">{notice}</p> : null}
          {error ? <p className="import-error" role="alert">{error}</p> : null}

          {tab === "raw" ? (
            <section aria-label="Raw spectrum" data-testid="spectrum-raw">
              <p className="xspec-statement">Raw measurement exactly as imported, in the order of the file ({root.x_order.toLowerCase()} {xUnitText(root.x.definition.unit.code)}). {root.y_error_present ? "An uncertainty column is stored but not drawn." : ""}</p>
              {rootArrays ? <ExperimentalSpectrumChart traces={rawTraces} xLabel={`${root.x.definition.label} (${xUnitText(root.x.definition.unit.code)})`} yLabel={`${root.y.definition.label} (${yUnitText(root.y.definition.unit.code)})`} inverted={conventionalInversion(root.technique, root.x.definition.unit.code)} height={400} testIdPrefix="spectrum-raw" ariaLabel={`Raw ${TECHNIQUE_LABEL[root.technique]} spectrum`} description="The stored raw experimental arrays." /> : <p role="status">Loading arrays…</p>}
              {rootArrays?.decimated ? <p className="xspec-note">Display shows {rootArrays.returned_points.toLocaleString()} of {rootArrays.point_count.toLocaleString()} points (min/max per bin, extremes kept). The stored data are complete.</p> : null}
            </section>
          ) : null}

          {tab === "processed" ? (
            <section aria-label="Processed spectrum" data-testid="spectrum-processed">
              <p className="xspec-statement">
                Showing <strong>{version.id === root.id ? "the raw measurement" : version.name}</strong> <span className="xspec-badge" data-tone={authority.tone}>{authority.label}</span>
                {version.id !== root.id ? ` made from ${parentOfVersion?.id === root.id ? "the raw data" : parentOfVersion?.name}.` : ". Choose an action below to make a new version."}
              </p>
              {versionArrays ? <ExperimentalSpectrumChart traces={processedTraces} xLabel={xLabel} yLabel={yLabel} inverted={inverted} height={400} testIdPrefix="spectrum-processed" ariaLabel="Processed spectrum" description="Input, estimated baseline and result of the selected version." /> : <p role="status">Loading arrays…</p>}
              {latestWarnings.length ? (
                <ul className="xspec-diagnostics" data-testid="spectrum-version-warnings" aria-label="Warnings for this version">
                  {latestWarnings.map((w) => <li key={w.code} data-tone="warning"><strong>{w.code.replaceAll("_", " ").toLowerCase()}</strong> {w.message}</li>)}
                </ul>
              ) : null}
              <SpectrumProcessingPanel projectId={projectId} dataset={version} peakWidths={versionPeakSets[versionPeakSets.length - 1]?.peak_set?.peaks ?? null} onCreated={(value) => void created(value)} sections={["baseline", "smooth", "normalize", "other"]} />
            </section>
          ) : null}

          {tab === "peaks" ? (
            <section aria-label="Peaks" data-testid="spectrum-peaks">
              <p className="xspec-statement">Peaks are detected on <strong>{version.id === root.id ? "the raw measurement" : version.name}</strong>. A peak set is algorithm output with the parameters shown, <strong>not raw data</strong>.</p>
              {versionArrays ? <ExperimentalSpectrumChart traces={[{ id: "version", label: version.name, x: versionArrays.x, y: versionArrays.y, style: "processed" }]} xLabel={xLabel} yLabel={yLabel} inverted={inverted} peaks={peakMarkers} height={380} testIdPrefix="spectrum-peaks" ariaLabel="Spectrum with detected peaks" description="Detected peaks drawn on the selected version." /> : <p role="status">Loading arrays…</p>}
              {peakSet?.peak_set ? (
                <>
                  <h4>{peakSet.peak_set.peak_count} peaks · {peakSet.peak_set.library} {peakSet.peak_set.library_version} <span className="xspec-badge" data-tone="peaks">DERIVED · NOT RAW</span></h4>
                  <table className="xspec-table" data-testid="spectrum-peak-table">
                    <thead><tr><th>#</th><th>Position ({xUnitText(unit)})</th><th>Height</th><th>FWHM ({xUnitText(unit)})</th><th>Prominence</th><th>Position method</th></tr></thead>
                    <tbody>{peakSet.peak_set.peaks.map((p, i) => <tr key={p.index} data-testid={`spectrum-peak-row-${i}`}><td>{i + 1}</td><td>{p.x.toFixed(2)}</td><td>{p.y.toPrecision(3)}</td><td>{p.fwhm_x.toFixed(2)}</td><td>{p.prominence.toPrecision(3)}</td><td>{p.refined ? "parabolic vertex" : "sample value"}</td></tr>)}</tbody>
                  </table>
                  <ul className="xspec-params">{peakSet.peak_set.parameters.map((p) => <li key={p.key}><code>{p.key}</code> = {String(p.value)}</li>)}</ul>
                  {peakSet.peak_set.warnings.length ? <ul className="xspec-diagnostics">{peakSet.peak_set.warnings.map((w) => <li key={w.code} data-tone="warning"><strong>{w.code.replaceAll("_", " ").toLowerCase()}</strong> {w.message}</li>)}</ul> : null}
                </>
              ) : <p className="xspec-empty-inline" data-testid="spectrum-no-peaks">No peaks have been detected on this version yet.</p>}
              <SpectrumProcessingPanel projectId={projectId} dataset={version} peakWidths={peakSet?.peak_set?.peaks ?? null} onCreated={(value) => void created(value)} sections={["peaks"]} />
            </section>
          ) : null}

          {tab === "compare" ? (
            <SpectrumComparePanel key={version.id} projectId={projectId} dataset={version} peakSets={versionPeakSets} arrays={versionArrays ?? null} onNeedPeaks={() => setTab("peaks")} persistenceKey={`spectrum:${version.id}`} />
          ) : null}

          {tab === "provenance" && focus ? <SpectrumProvenancePanel dataset={focus} all={all} comparisons={comparisons} /> : null}
        </div>
      </div>
    </div>
  );
}

function AssociationEditor({ projectId, root, structures, onSaved }: { projectId: string; root: SpectrumDatasetView; structures: Array<{ id: string; name: string }>; onSaved: () => void }) {
  const current = root.association;
  const [state, setState] = useState<AssociationState>(current.state);
  const [structureId, setStructureId] = useState(current.structure_id ?? "");
  const [sample, setSample] = useState(current.sample_label ?? "");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await setSpectrumAssociation({ projectId, datasetId: root.id, association: { state, ...(state === "ASSOCIATED_WITH_STRUCTURE" ? { structure_id: structureId } : {}), ...(state === "ASSOCIATED_WITH_SAMPLE" ? { sample_label: sample } : {}) } });
      setEditing(false); onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The association could not be saved.");
    }
  }
  const text = current.state === "UNASSIGNED" ? "Not associated with a molecule or sample" : current.state === "ASSOCIATED_WITH_STRUCTURE" ? `Associated with structure ${current.structure_name ?? current.structure_id}` : `Associated with sample “${current.sample_label}”`;
  return (
    <aside className="xspec-association" data-testid="spectrum-association" aria-label="Association">
      <h3>Association</h3>
      <HelpTip topic="spectra.experimental" /><p data-testid="spectrum-association-text">{text}</p>
      {!editing ? <button type="button" className="xspec-link-btn" onClick={() => setEditing(true)} data-testid="spectrum-association-edit">Change</button> : (
        <div className="xspec-form">
          <label className="xspec-field"><span>Belongs to</span>
            <select value={state} onChange={(event) => setState(event.currentTarget.value as AssociationState)} data-testid="spectrum-association-state">
              <option value="UNASSIGNED">nothing yet (unassigned)</option>
              <option value="ASSOCIATED_WITH_STRUCTURE">a structure in this project</option>
              <option value="ASSOCIATED_WITH_SAMPLE">a sample (label)</option>
            </select>
          </label>
          {state === "ASSOCIATED_WITH_STRUCTURE" ? (
            <label className="xspec-field"><span>Structure</span>
              <select value={structureId} onChange={(event) => setStructureId(event.currentTarget.value)} data-testid="spectrum-association-structure"><option value="" disabled>Choose…</option>{structures.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            </label>
          ) : null}
          {state === "ASSOCIATED_WITH_SAMPLE" ? <label className="xspec-field"><span>Sample label</span><input type="text" value={sample} maxLength={160} onChange={(event) => setSample(event.currentTarget.value)} data-testid="spectrum-association-sample" /></label> : null}
          {error ? <p className="import-error" role="alert">{error}</p> : null}
          <div className="xspec-button-row">
            <button type="button" className="import-primary-btn" onClick={() => void save()} disabled={(state === "ASSOCIATED_WITH_STRUCTURE" && !structureId) || (state === "ASSOCIATED_WITH_SAMPLE" && !sample.trim())} data-testid="spectrum-association-save">Save</button>
            <button type="button" className="import-secondary-btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          <small>Associations are recorded as history; the spectrum itself does not change.</small>
        </div>
      )}
    </aside>
  );
}
