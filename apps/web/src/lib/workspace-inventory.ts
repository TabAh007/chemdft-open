import type { CalculationDetail, EvidenceCandidate, GeometryCandidateView, StructureCandidate } from "@chemdft/schemas";
import type { WorkspaceCatalogItem } from "@/app/_components/workspace-state-provider";
import { getCalculation, listComputeJobs, listGeometryCandidates, listStructureVersions, listStructures } from "./structure-workspace-api";
import { getExternalImport, listExternalImports } from "./external-import-api";
import { IMPORTED_RESULT_TITLE, asVibrations, importStateLabel, isImportedSpectrum, methodBasisDisplay, programDisplay, type ImportedResultType } from "./imported-results";
import { getDocument, listCandidateRepresentations, listDocuments, listExperimentalDatasets, listStructureCandidates } from "./phase7-api";
import { listProjectMemory } from "./knowledge-api";
import { listSpectrumDatasets } from "./experimental-spectra-api";
import { opLabel } from "./experimental-spectra";
import { listWorkspaceFiles, listWorkspaceHistory } from "./workspace-api";
import { vibrationalKind, vibrationalSpectrumLabel } from "./vibrational-kind";
import { conditionsLabel, isThermochemistryPayload } from "./thermochemistry";
import { selectionKey, validSelection, type WorkspaceSelection } from "./workspace-selection";

const short = (id: string) => id.slice(0, 8);
const readable = (value: string) => value.replaceAll("_", " ").toLowerCase();
const resultLabel = (resultType: string, method: string, basis?: string) => {
  const description = resultType === "chemdft.optimization"
    ? "Geometry optimization result"
    : resultType === "chemdft.vibrational-analysis"
      ? "IR spectrum"
      : resultType === "chemdft.molecular-orbitals"
        ? "Electronic structure"
      : resultType === "chemdft.tddft"
        ? "UV/Vis absorption spectrum"
      : readable(resultType);
  return `${description}${method ? ` · ${method}${basis ? `/${basis}` : ""}` : ""}`;
};

function candidateLabel(candidate: StructureCandidate): string {
  const figure = candidate.source_anchor?.figure_number;
  return figure ? `Candidate · Fig. ${figure}` : `Candidate · p. ${candidate.source_page ?? "?"}`;
}

function evidenceLabel(candidate: EvidenceCandidate): string {
  return `${readable(candidate.evidence_type)} · p. ${candidate.source_anchor?.page_number ?? "?"}`;
}

function historyItem(projectId: string, id: string, label: string, occurredAt: string, detail: string, linkedSelection?: WorkspaceSelection): WorkspaceCatalogItem {
  return {
    selection: { kind: "historyEvent", id, projectId }, label, section: "history", detail,
    occurredAt, ...(linkedSelection ? { linkedSelection } : {}),
  };
}

export async function loadWorkspaceInventory(projectId: string): Promise<WorkspaceCatalogItem[]> {
  const [files, documentsOutput, structures, candidatesOutput, datasetsOutput, jobsOutput, memoryOutput, auditEvents, importsOutput, spectraOutput, geometryOutput] = await Promise.all([
    listWorkspaceFiles(projectId), listDocuments(projectId), listStructures(projectId),
    listStructureCandidates(projectId), listExperimentalDatasets(projectId),
    listComputeJobs(projectId), listProjectMemory(projectId), listWorkspaceHistory(projectId),
    listExternalImports(projectId), listSpectrumDatasets(projectId),
    // Generated (not optimized) geometry drafts, including those created by the AI Scientist.
    listGeometryCandidates(projectId).catch(() => ({ candidates: [] as GeometryCandidateView[] })),
  ]);
  const documents = documentsOutput.documents;
  const candidates = candidatesOutput.candidates ?? [];
  const datasets = datasetsOutput.datasets;
  const jobs = jobsOutput.jobs;
  const importedDetails = await Promise.all(importsOutput.imports
    .filter((item) => item.state === "IMPORTED")
    .map((item) => getExternalImport({ projectId, importId: item.id })));
  const [documentDetails, versionLists, representationLists, calculations] = await Promise.all([
    Promise.all(documents.map((item) => getDocument(projectId, item.id))),
    Promise.all(structures.map((item) => listStructureVersions(projectId, item.id))),
    Promise.all(candidates.map((item) => listCandidateRepresentations(projectId, item.id))),
    Promise.all(jobs.map((item) => getCalculation({ projectId, calculationId: item.calculation_id }))),
  ]);
  const items: WorkspaceCatalogItem[] = [];
  const fileByHash = new Map(files.map((file) => [file.sha256, file]));
  const promotedRepresentationIds = new Set(versionLists.flatMap((versions) => versions
    .map((item) => item.provenance?.candidate_representation_id)
    .filter((id): id is string => Boolean(id))));
  for (const file of files) {
    items.push({ selection: { kind: "file", id: file.id, projectId }, label: file.original_name,
      section: "files", detail: `${file.media_type} · ${file.provenance_class} · ${file.size_bytes} bytes` });
  }
  for (const [index, document] of documents.entries()) {
    const selection: WorkspaceSelection = { kind: "document", id: document.id, projectId };
    const file = fileByHash.get(document.sha256);
    items.push({ selection, label: document.title || `Document ${short(document.id)}`,
      section: "files", detail: `${document.page_count} pages · ${document.media_type}`,
      ...(file ? { parentKey: selectionKey({ kind: "file", id: file.id, projectId }) } : {}) });
    items.push(historyItem(projectId, document.id, "Document uploaded", document.created_at,
      document.title || `Document ${short(document.id)}`, selection));
    for (const evidence of documentDetails[index]?.candidates ?? []) {
      items.push({ selection: { kind: "documentEvidence", id: evidence.id, projectId, sourceId: document.id,
        ...(evidence.source_anchor?.page_number ? { locator: { page: evidence.source_anchor.page_number } } : {}) },
      label: evidenceLabel(evidence), section: "files", detail: `${evidence.source_class} · ${evidence.review_state}`,
      parentKey: selectionKey(selection) });
    }
  }
  for (const [index, structure] of structures.entries()) {
    for (const version of versionLists[index] ?? []) {
      items.push({ selection: { kind: "structureVersion", id: version.version.id, projectId, sourceId: structure.id },
        label: `${structure.name} · ${version.version.origin === "OPTIMIZED" ? "optimized " : ""}V${version.version.revision}${version.version.origin === "RECONSTRUCTED" ? " · RECONSTRUCTED · USER REVIEWED" : ""}${version.version.origin === "IMPORTED_CALCULATION" ? " · IMPORTED" : ""}`, section: "structures", authority: version.version.origin === "IMPORTED_CALCULATION" ? "IMPORTED" : "COMMITTED",
        detail: `Authority: ${version.provenance?.source_class ?? version.version.origin} · Verification: ${version.provenance?.verification_state === "UNVERIFIED" ? "NOT REVIEWED" : version.provenance?.verification_state ?? "NOT REVIEWED"}` });
    }
  }
  for (const [index, candidate] of candidates.entries()) {
    const selection: WorkspaceSelection = { kind: "structureCandidate", id: candidate.id, projectId };
    const promotedVersion = candidate.promoted_structure_version_id
      ? versionLists.flat().find((item) => item.version.id === candidate.promoted_structure_version_id)
      : undefined;
    items.push({ selection, label: candidateLabel(candidate), section: "structures", authority: "CANDIDATE",
      detail: `${candidate.candidate_state} · UNVERIFIED` });
    items.push(historyItem(projectId, candidate.id, "Structure candidate detected", candidate.created_at,
      candidateLabel(candidate), selection));
    for (const representation of representationLists[index]?.representations ?? []) {
      const representationSelection: WorkspaceSelection = { kind: "candidateRepresentation", id: representation.id, projectId, sourceId: candidate.id };
      const promoted = promotedRepresentationIds.has(representation.id);
      items.push({ selection: representationSelection,
        label: `Representation R${representation.revision} · ${representation.representation_type}${promoted && promotedVersion ? ` · promoted to V${promotedVersion.version.revision}` : ""}`,
        section: "structures", ...(promoted ? {} : { authority: "CANDIDATE" as const }), parentKey: selectionKey(selection),
        detail: `${representation.validation_state} · ${representation.review_state ?? "UNREVIEWED"}` });
      items.push(historyItem(projectId, representation.id, "Candidate representation generated",
        representation.created_at, `${representation.method} · R${representation.revision}`, representationSelection));
    }
  }
  for (const draft of geometryOutput.candidates ?? []) {
    const selection: WorkspaceSelection = { kind: "geometryCandidate", id: draft.id, projectId };
    const draftName = draft.manifest.coordinate_representation.name ?? draft.manifest.formula;
    items.push({ selection, label: `${draftName} · ${draft.manifest.formula} · 3D draft`, section: "structures",
      authority: draft.state === "ACCEPTED" ? "COMMITTED" : "CANDIDATE",
      detail: `${draft.state} · ${draft.manifest.geometry_class} · UNVERIFIED` });
  }
  for (const dataset of datasets) {
    const selection: WorkspaceSelection = { kind: "experimentalDataset", id: dataset.id, projectId };
    const digitizationSession = dataset.digitization_session;
    const label = digitizationSession
      ? `Figure ${digitizationSession.figure_number} ${"y_unit_status" in digitizationSession ? "XRD" : "DLS"} · DIGITIZED · V${digitizationSession.revision}`
      : dataset.name;
    items.push({ selection, label, section: "experimentalData",
      detail: `${dataset.modality} · ${dataset.source_class} · ${dataset.point_count} points` });
    items.push(historyItem(projectId, dataset.id, digitizationSession ? `${"y_unit_status" in digitizationSession ? "XRD" : "DLS"} digitization committed` : "Experimental data imported", dataset.created_at,
      dataset.name, selection));
  }
  for (const spectrum of spectraOutput.datasets) {
    const selection: WorkspaceSelection = { kind: "experimentalSpectrum", id: spectrum.id, projectId };
    const technique = spectrum.technique === "UVVIS" ? "UV/Vis" : spectrum.technique === "RAMAN" ? "Raman" : "IR";
    const parentSelection = spectrum.parent_dataset_id ? selectionKey({ kind: "experimentalSpectrum", id: spectrum.parent_dataset_id, projectId }) : undefined;
    const label = spectrum.kind === "RAW"
      ? `${spectrum.name} · ${technique} · EXPERIMENTAL`
      : spectrum.kind === "PEAKS"
        ? `Peaks · ${spectrum.peak_set?.peak_count ?? 0} detected · DERIVED, NOT RAW`
        : `${opLabel(spectrum.transform?.op ?? "")} · DERIVED`;
    items.push({ selection, label, section: "experimentalData", authority: "EXPERIMENTAL", experimentalSpectrum: true,
      ...(parentSelection ? { parentKey: parentSelection } : {}),
      detail: `${spectrum.kind === "RAW" ? "EXPERIMENTAL · raw" : spectrum.kind === "PEAKS" ? "DERIVED_NOT_RAW" : "DETERMINISTIC_TRANSFORM"} · ${spectrum.point_count} ${spectrum.kind === "PEAKS" ? "peaks" : "points"}` });
    items.push(historyItem(projectId, spectrum.id,
      spectrum.kind === "RAW" ? "Experimental spectrum imported" : spectrum.kind === "PEAKS" ? "Peaks detected" : `Spectrum ${opLabel(spectrum.transform?.op ?? "").toLowerCase()}`,
      spectrum.created_at, spectrum.name, selection));
  }
  for (const [index, job] of jobs.entries()) {
    const detail: CalculationDetail | undefined = calculations[index];
    const task = detail?.specification.task_type ?? job.workload.workload_type;
    const selection: WorkspaceSelection = { kind: "calculation", id: job.calculation_id, projectId };
    const method = detail?.specification.method.display_name ?? "Method unavailable";
    const basis = detail?.specification.basis?.display_name;
    const resultPayload = detail?.result?.result_type === "chemdft.vibrational-analysis" && "modes" in detail.result.payload
      ? detail.result.payload : undefined;
    const taskTitle = task === "THERMOCHEMISTRY"
      ? "Thermochemistry calculation"
      : task === "FREQUENCY"
      ? `Vibrational / ${resultPayload && vibrationalKind(resultPayload) === "raman" ? "Raman" : "IR"} calculation`
      : readable(task);
    items.push({ selection, label: `${taskTitle} · ${method}${basis ? `/${basis}` : ""}`,
      section: "calculations", detail: `${job.state} · ${job.provider}` });
    if (detail?.optimization_trajectory) {
      const trajectory = detail.optimization_trajectory;
      items.push({ selection: { kind: "optimizationTrajectory", id: trajectory.id, projectId, sourceId: job.calculation_id },
        label: `Optimization trajectory · ${trajectory.steps.length} ${detail.specification.engine_preference.engine === "xtb" ? "evaluations" : "steps"}`,
        section: "results", authority: "AUTHORITATIVE",
        detail: `${trajectory.state} · ${trajectory.steps.length} engine evaluations` });
      if (trajectory.final_structure_version_id) {
        const version = versionLists.flat().find((item) => item.version.id === trajectory.final_structure_version_id);
        if (version) items.push({ selection: { kind: "optimizedStructureVersion", id: version.version.id, projectId, sourceId: version.structure.id },
          label: `${version.structure.name} · optimized V${version.version.revision}`,
          section: "results", authority: "COMMITTED", detail: "CALCULATED · optimized geometry" });
      }
    }
    if (detail?.result) {
      const vibrational = detail.result.result_type === "chemdft.vibrational-analysis"
        && "modes" in detail.result.payload ? detail.result.payload : undefined;
      const thermo = isThermochemistryPayload(detail.result.payload) ? detail.result.payload : undefined;
      items.push({ selection: { kind: "calculationResult", id: detail.result.id, projectId, sourceId: job.calculation_id },
        label: thermo
          ? `Thermochemistry · ${conditionsLabel(thermo.conditions.temperature_k, thermo.conditions.pressure_pa)}`
          : vibrational === undefined ? resultLabel(detail.result.result_type, method, basis)
          : vibrationalSpectrumLabel(vibrational),
        section: "results", authority: "AUTHORITATIVE",
        detail: `${detail.result.source_class ?? "CALCULATED"} · ${detail.result.producer_software.name}${vibrational && vibrationalKind(vibrational) === "raman" ? " · includes IR intensities" : ""}` });
    }
  }
  const importedById = new Map(importedDetails.map((item) => [item.import_record.id, item]));
  for (const entry of importsOutput.imports) {
    const selection: WorkspaceSelection = { kind: "externalImport", id: entry.id, projectId };
    const detail = importedById.get(entry.id);
    if (entry.state === "IMPORTED" && detail) {
      const preview = detail.import_record.preview;
      const job = preview.job;
      const source = programDisplay(preview.program);
      items.push({ selection, section: "calculations", authority: "IMPORTED",
        label: `Imported calculation · ${entry.source_filename} · ${source}`,
        detail: `IMPORTED${job ? ` · ${methodBasisDisplay(job.method)}/${methodBasisDisplay(job.basis)}` : ""}` });
      const vibrations = asVibrations(detail.results)?.payload;
      for (const result of detail.results ?? []) {
        const type = result.result_type as ImportedResultType;
        if (type === "chemdft.imported.structure") continue;
        const suffix = type === "chemdft.imported.vibrations" && vibrations
          ? ` · ${[vibrations.has_ir_intensities ? "IR" : "", vibrations.has_raman_activities ? "Raman" : ""].filter(Boolean).join(" + ") || "frequencies"}`
          : "";
        items.push({ selection: { kind: "importedResult", id: result.id, projectId, sourceId: entry.id },
          label: `${IMPORTED_RESULT_TITLE[type]}${suffix} · ${source}`, section: "results", authority: "IMPORTED",
          ...(isImportedSpectrum(type, vibrations) ? { importedSpectrum: true as const } : {}),
          detail: `IMPORTED · ${result.producer_type} · not a ChemDFT engine result` });
      }
      items.push(historyItem(projectId, entry.id, "Calculation imported", entry.confirmed_at ?? entry.created_at,
        `${source} · ${entry.source_filename}`, selection));
    } else {
      items.push({ selection, section: "files",
        label: `${entry.state === "REJECTED" ? "Rejected import" : "Import preview"} · ${entry.source_filename}`,
        detail: `${importStateLabel(entry.state)}${entry.program_label ? ` · ${entry.program_label}` : ""}` });
    }
  }
  for (const memory of memoryOutput.memories ?? []) {
    if (memory.memory_type !== "PROJECT_NOTE") continue;
    items.push({ selection: { kind: "note", id: memory.id, projectId },
      label: memory.content.split("\n")[0]?.slice(0, 64) || `Note ${short(memory.id)}`,
      section: "notes", detail: memory.content });
  }
  for (const event of auditEvents) {
    let linkedSelection: WorkspaceSelection | undefined;
    if (event.target_kind && event.target_id) {
      const candidate = { kind: event.target_kind, id: event.target_id, projectId,
        ...(event.source_id ? { sourceId: event.source_id } : {}) };
      if (validSelection(candidate, projectId)) linkedSelection = candidate;
    }
    items.push(historyItem(projectId, event.id, event.label, event.occurred_at,
      `${event.event_name} · ${event.outcome}`, linkedSelection));
  }
  const liveSelectionKeys = new Set(items
    .filter((item) => item.section !== "history")
    .map((item) => selectionKey(item.selection)));
  const reconciled = items.map((item) => {
    if (item.section !== "history" || !item.linkedSelection
      || liveSelectionKeys.has(selectionKey(item.linkedSelection))) return item;
    const withoutStaleLink = { ...item };
    delete withoutStaleLink.linkedSelection;
    return withoutStaleLink;
  });
  const ordered = [
    ...reconciled.filter((item) => item.section !== "history"),
    ...reconciled.filter((item) => item.section === "history")
      .sort((first, second) => (second.occurredAt ?? "").localeCompare(first.occurredAt ?? "")),
  ];
  const seen = new Set<string>();
  return ordered.filter((item) => {
    const key = selectionKey(item.selection);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
