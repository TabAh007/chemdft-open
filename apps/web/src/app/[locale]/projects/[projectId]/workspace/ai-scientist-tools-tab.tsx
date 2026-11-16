"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AIToolPolicy, EngineCapabilityView } from "@chemdft/schemas";
import { ActionButton, AppIcon } from "@chemdft/ui";
import { useCalculationCapabilities } from "@/lib/use-calculation-capabilities";
import { basisLabel, methodLabel } from "@/lib/scientific-labels";

export type ToolCategory = "All" | "Calculation" | "Structure" | "Analysis" | "Visualization" | "Data" | "Files" | "External";

type ToolGroup = "Computational Chemistry" | "Structure & Data" | "Analysis & Visualization" | "Roadmap — Not Available";

/**
 * How a row's availability is decided. Engines come from this deployment's capability endpoint,
 * AI actions from the project's allowed tool policies; nothing is marked available by default.
 */
type ToolBinding =
  | { kind: "engine"; engine: string; draftable: boolean }
  | { kind: "ai-tools"; toolIds: string[] }
  | { kind: "workspace" }
  | { kind: "roadmap"; label: "Planned" | "Not configured" };

export interface ToolItem {
  id: string;
  name: string;
  group: ToolGroup;
  category: ToolCategory[];
  description: string;
  fullDescription: string;
  tags: string[];
  operations: string[];
  inputs: string[];
  availabilityNote: string;
  binding: ToolBinding;
  iconType: "pyscf" | "orca" | "xtb" | "crest" | "gaussian" | "nwchem" | "structure-builder" | "3d-view" | "file-converter" | "analysis" | "spectra" | "external-search" | "materials";
}

export type ToolStatusTone = "available" | "unavailable" | "checking" | "workspace" | "roadmap";
export interface ResolvedToolStatus {
  label: string;
  tone: ToolStatusTone;
  /** True only when the AI Scientist can be asked to use this tool from Chat right now. */
  canDraft: boolean;
  detail: string;
  capability: EngineCapabilityView | null;
}

const TASK_LABEL: Record<string, string> = {
  ENERGY: "Single-point energy", GEOMETRY_OPTIMIZATION: "Geometry optimization", FREQUENCY: "Harmonic frequencies",
  ORBITAL: "Molecular orbitals", TDDFT: "TD-DFT excited states", THERMOCHEMISTRY: "Thermochemistry",
  CONFORMER_SEARCH: "Conformer search",
};

const ENGINE_COPY: Record<string, Pick<ToolItem, "name" | "description" | "fullDescription" | "iconType">> = {
  pyscf: {
    name: "PySCF", iconType: "pyscf",
    description: "Ab initio and DFT quantum chemistry calculations.",
    fullDescription: "Python-based Simulations of Chemistry Framework. Methods, basis sets and tasks listed here are read from this deployment's engine capability record.",
  },
  xtb: {
    name: "xTB", iconType: "xtb",
    description: "Semi-empirical tight-binding calculations.",
    fullDescription: "Extended tight-binding (GFN-xTB) program. Methods and tasks listed here are read from this deployment's engine capability record.",
  },
  crest: {
    name: "CREST", iconType: "crest",
    description: "Conformer search with GFN-xTB.",
    fullDescription: "Conformer–rotamer ensemble sampling tool. Availability depends on this deployment's engine capability record.",
  },
  qe: {
    name: "Quantum ESPRESSO", iconType: "analysis",
    description: "Plane-wave periodic DFT of crystals (SSSP PBE Efficiency v2.0).",
    fullDescription: "Quantum ESPRESSO runs periodic crystals with plane waves: single-point energy, atom relaxation with the cell fixed, density of states, band structure and Lowdin local moments. Availability depends on this deployment's engine capability record; the planning AI does not set these up.",
  },
  psi4: {
    name: "Psi4", iconType: "nwchem",
    description: "Open-source quantum chemistry calculations.",
    fullDescription: "Psi4 electronic-structure engine. Methods and basis sets listed here are read from this deployment's engine capability record.",
  },
};

const ENGINE_ORDER = ["pyscf", "qe", "xtb", "crest", "psi4"];

function engineTool(engine: string): ToolItem {
  const copy = ENGINE_COPY[engine] ?? {
    name: engine, iconType: "analysis" as const, description: "Calculation engine reported by this deployment.",
    fullDescription: "Engine reported by this deployment's capability endpoint.",
  };
  return {
    id: engine, group: "Computational Chemistry", category: ["Calculation"], tags: [], operations: [],
    inputs: ["Saved structure version", "Charge and spin multiplicity", "Method and basis supported by the engine"],
    availabilityNote: "", binding: { kind: "engine", engine, draftable: engine === "pyscf" }, ...copy,
  };
}

const STATIC_TOOLS: ToolItem[] = [
  {
    id: "structure-builder", name: "Structure Builder", group: "Structure & Data", category: ["Structure"],
    description: "Draw, import and edit molecular structures.",
    fullDescription: "Ketcher 2D editor with RDKit-based coordinate handling in the workspace. When allowed for this project, the AI Scientist can resolve molecule names and create draft candidates that you review.",
    tags: ["Ketcher", "SMILES", "Draft candidates"],
    operations: ["2D drawing and editing in the workspace", "AI molecule name resolution (when allowed)", "AI draft candidate creation (when allowed; requires your review)"],
    inputs: ["Drawing, SMILES, or a molecule name"],
    availabilityNote: "AI access follows the project's allowed tools; drafts are never authoritative structures.",
    binding: { kind: "ai-tools", toolIds: ["molecule.resolve", "molecule.draft.create"] }, iconType: "structure-builder",
  },
  {
    id: "structure-import", name: "Structure Import", group: "Structure & Data", category: ["Files", "Data"],
    description: "Import saved structures from files.",
    fullDescription: "Imports molecular structures into versioned project records with source provenance.",
    tags: ["XYZ", "SDF", "MOL", "CIF", "SMILES"],
    operations: ["Import XYZ, SDF, MOL, CIF or SMILES into a structure version"],
    inputs: ["Structure file or SMILES string"],
    availabilityNote: "Workspace feature; the AI Scientist does not import files on your behalf.",
    binding: { kind: "workspace" }, iconType: "file-converter",
  },
  {
    id: "3d-visualization", name: "3D Visualization", group: "Structure & Data", category: ["Visualization", "Structure"],
    description: "Interactive 3D molecular viewer.",
    fullDescription: "3Dmol.js-based viewer for saved structures and calculation outputs in the workspace.",
    tags: ["3D View", "Orbitals", "Density"],
    operations: ["View saved structures", "Display orbital and density surfaces from saved results"],
    inputs: ["Saved structure version or calculation result"],
    availabilityNote: "Workspace feature; not invoked by the AI Scientist.",
    binding: { kind: "workspace" }, iconType: "3d-view",
  },
  {
    id: "structure-analysis", name: "Structure Analysis", group: "Structure & Data", category: ["Analysis", "Structure"],
    description: "Inspect geometric properties of saved structures.",
    fullDescription: "Interatomic distances, angles and molecular formula derived from saved Cartesian coordinates.",
    tags: ["Bond lengths", "Angles", "Formula"],
    operations: ["Distances and angles from saved coordinates", "Molecular formula from persisted atoms"],
    inputs: ["Saved 3D coordinates (Å)"],
    availabilityNote: "Workspace feature; values are derived from saved coordinates, not engine output.",
    binding: { kind: "workspace" }, iconType: "analysis",
  },
  {
    id: "result-analysis", name: "Result Inspection", group: "Analysis & Visualization", category: ["Analysis"],
    description: "Open persisted calculation results with provenance.",
    fullDescription: "Shows engine results only when the persisted record passes the Scientific Result Firewall checks; other records are labelled as not authoritative.",
    tags: ["Energies", "Provenance", "Result Firewall"],
    operations: ["Inspect saved results and their provenance", "AI can read calculation records when allowed"],
    inputs: ["Persisted calculation record"],
    availabilityNote: "AI read access follows the project's allowed tools; the AI never writes results.",
    binding: { kind: "ai-tools", toolIds: ["calculation.get"] }, iconType: "analysis",
  },
  {
    id: "spectra-analysis", name: "Experimental Spectra", group: "Analysis & Visualization", category: ["Analysis", "Visualization"],
    description: "Import and inspect experimental spectra.",
    fullDescription: "Imports experimental IR, Raman and UV-Vis spectra into the workspace for inspection and comparison.",
    tags: ["IR", "Raman", "UV-Vis"],
    operations: ["Experimental spectrum import", "Peak detection on imported data"],
    inputs: ["Experimental spectrum file"],
    availabilityNote: "Workspace feature; not invoked by the AI Scientist.",
    binding: { kind: "workspace" }, iconType: "spectra",
  },
  {
    id: "project-knowledge-search", name: "Project Evidence Search", group: "Analysis & Visualization", category: ["Data"],
    description: "Search this project's indexed documents.",
    fullDescription: "Project-scoped retrieval over indexed documents. Answers cite the passages they use.",
    tags: ["Project documents", "Passages", "Citations"],
    operations: ["Search indexed project documents", "Cite page and anchor references"],
    inputs: ["Question about this project's documents"],
    availabilityNote: "AI access follows the project's allowed tools. External literature is not searched.",
    binding: { kind: "ai-tools", toolIds: ["knowledge.search"] }, iconType: "external-search",
  },
  {
    id: "orca", name: "ORCA", group: "Roadmap — Not Available", category: ["Calculation"],
    description: "DFT, post-HF and excited-state calculations.", fullDescription: "Not installed or integrated in ChemDFT.",
    tags: ["Not integrated"], operations: [], inputs: [],
    availabilityNote: "Roadmap only. Requires a separately licensed installation and an approved adapter.",
    binding: { kind: "roadmap", label: "Planned" }, iconType: "orca",
  },
  {
    id: "gaussian", name: "Gaussian", group: "Roadmap — Not Available", category: ["Calculation"],
    description: "Gaussian input generation and execution.", fullDescription: "Gaussian is not distributed or executed by ChemDFT.",
    tags: ["Not integrated"], operations: [], inputs: [],
    availabilityNote: "Roadmap only. ChemDFT does not run Gaussian.",
    binding: { kind: "roadmap", label: "Planned" }, iconType: "gaussian",
  },
  {
    id: "nwchem", name: "NWChem", group: "Roadmap — Not Available", category: ["Calculation"],
    description: "Parallel electronic-structure calculations.", fullDescription: "Not installed or integrated in ChemDFT.",
    tags: ["Not integrated"], operations: [], inputs: [],
    availabilityNote: "Roadmap only.",
    binding: { kind: "roadmap", label: "Planned" }, iconType: "nwchem",
  },
  {
    id: "literature-search-external", name: "External Literature Search", group: "Roadmap — Not Available", category: ["External"],
    description: "Search external literature databases.", fullDescription: "No external literature service is integrated.",
    tags: ["Not configured"], operations: [], inputs: [],
    availabilityNote: "Roadmap only. The AI Scientist cites only project records and indexed project documents.",
    binding: { kind: "roadmap", label: "Not configured" }, iconType: "external-search",
  },
  {
    id: "web-search", name: "Web Search", group: "Roadmap — Not Available", category: ["External"],
    description: "General web search.", fullDescription: "No web search service is configured.",
    tags: ["Not configured"], operations: [], inputs: [],
    availabilityNote: "Not configured; disabled so the AI cannot cite unreviewed web pages.",
    binding: { kind: "roadmap", label: "Not configured" }, iconType: "external-search",
  },
  {
    id: "materials-databases", name: "Materials Databases", group: "Roadmap — Not Available", category: ["Data", "External"],
    description: "External materials and crystal databases.", fullDescription: "No external materials database connector is configured.",
    tags: ["Not configured"], operations: [], inputs: [],
    availabilityNote: "Roadmap only.",
    binding: { kind: "roadmap", label: "Not configured" }, iconType: "materials",
  },
];

const GROUPS: ToolGroup[] = ["Computational Chemistry", "Structure & Data", "Analysis & Visualization", "Roadmap — Not Available"];
const FILTER_CHIPS: ToolCategory[] = ["All", "Calculation", "Structure", "Analysis", "Visualization", "Data", "Files", "External"];

export function resolveToolStatus(tool: ToolItem, context: {
  capabilities: EngineCapabilityView[];
  capabilitiesLoading: boolean;
  capabilitiesError: string | null;
  allowedTools: AIToolPolicy[] | null;
  aiAvailable: boolean;
}): ResolvedToolStatus {
  const binding = tool.binding;
  if (binding.kind === "roadmap") return { label: binding.label, tone: "roadmap", canDraft: false, detail: tool.availabilityNote, capability: null };
  if (binding.kind === "workspace") return { label: "Workspace feature", tone: "workspace", canDraft: false, detail: tool.availabilityNote, capability: null };
  const allowed = new Set((context.allowedTools ?? []).map((policy) => policy.tool_id));
  if (binding.kind === "ai-tools") {
    if (context.allowedTools === null) return { label: "Checking", tone: "checking", canDraft: false, detail: "Reading this project's allowed AI tools…", capability: null };
    const granted = binding.toolIds.filter((id) => allowed.has(id));
    return granted.length
      ? { label: "Available to AI", tone: "available", canDraft: false, detail: `${tool.availabilityNote} Allowed here: ${granted.join(", ")}.`, capability: null }
      : { label: "Not available to AI", tone: "unavailable", canDraft: false, detail: `${tool.availabilityNote} Not in this project's allowed AI tools.`, capability: null };
  }
  const capability = context.capabilities.find((item) => item.engine === binding.engine) ?? null;
  if (!capability) {
    if (context.capabilitiesLoading) return { label: "Checking", tone: "checking", canDraft: false, detail: "Reading engine capabilities for this deployment…", capability: null };
    if (context.capabilitiesError) return { label: "Availability unknown", tone: "unavailable", canDraft: false, detail: `Engine capabilities could not be read: ${context.capabilitiesError}`, capability: null };
    return { label: "Not on this deployment", tone: "unavailable", canDraft: false, detail: "This deployment does not report this engine.", capability: null };
  }
  if (capability.availability !== "AVAILABLE") {
    return { label: capability.availability === "MISCONFIGURED" ? "Misconfigured" : "Unavailable", tone: "unavailable", canDraft: false,
      detail: capability.diagnostic ?? "The engine is reported but not available on this deployment.", capability };
  }
  const submitAllowed = allowed.has("calculation.submit");
  const canDraft = binding.draftable && submitAllowed && context.aiAvailable;
  // The capability record says the engine is installed and usable by this deployment; it does not
  // say a compute worker is running right now (the Jobs page shows execution state).
  return {
    label: "Engine available", tone: "available", canDraft, capability,
    detail: canDraft
      ? "Engine reported available by this deployment (worker status is shown in Jobs). The AI Scientist can propose a calculation; it runs only after you approve it."
      : !submitAllowed ? "Available on this deployment. Calculation proposals are not allowed for you in this project."
      : !binding.draftable ? "Available on this deployment. Chat planning currently covers PySCF energy proposals only; use the calculation setup in the workspace."
      : "Available on this deployment. AI is currently unavailable, so Chat cannot draft a proposal.",
  };
}

interface AIScientistToolsTabProps {
  projectId?: string;
  allowedTools?: AIToolPolicy[] | null;
  aiAvailable?: boolean;
  onSelectToolForChat?: (toolName: string, promptSuggestion: string) => void;
}

export function AIScientistToolsTab({ projectId = "", allowedTools = null, aiAvailable = false, onSelectToolForChat }: AIScientistToolsTabProps) {
  const { capabilities, loading: capabilitiesLoading, error: capabilitiesError } = useCalculationCapabilities(projectId);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<ToolCategory>("All");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [selectedTool, setSelectedTool] = useState<ToolItem | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const catalog = useMemo(() => {
    const engines = [...new Set([...ENGINE_ORDER.filter((engine) => engine === "pyscf" || engine === "xtb"), ...capabilities.map((item) => item.engine)])]
      .sort((a, b) => (ENGINE_ORDER.indexOf(a) + 1 || 99) - (ENGINE_ORDER.indexOf(b) + 1 || 99));
    return [...engines.map(engineTool), ...STATIC_TOOLS];
  }, [capabilities]);

  const statusContext = { capabilities, capabilitiesLoading, capabilitiesError, allowedTools, aiAvailable };
  const statusFor = (tool: ToolItem) => resolveToolStatus(tool, statusContext);

  const filteredTools = catalog.filter((tool) => {
    if (activeFilter !== "All" && !tool.category.includes(activeFilter)) return false;
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    const capability = statusFor(tool).capability;
    const haystack = [tool.name, tool.description, ...tool.tags, ...(capability?.supported_methods ?? []), ...(capability?.supported_basis_sets ?? [])];
    return haystack.some((text) => text.toLowerCase().includes(query));
  });

  const counts = catalog.reduce((total, tool) => {
    const status = statusFor(tool);
    if (tool.binding.kind === "engine" && status.tone === "available") total.engines += 1;
    if (tool.binding.kind === "ai-tools" && status.tone === "available") total.ai += 1;
    if (status.tone === "roadmap") total.roadmap += 1;
    return total;
  }, { engines: 0, ai: 0, roadmap: 0 });

  const draft = (tool: ToolItem) => onSelectToolForChat?.(tool.name, `Plan a single-point energy calculation with ${tool.name} for the selected structure.`);
  const openDetail = (tool: ToolItem, opener: HTMLElement) => { openerRef.current = opener; setSelectedTool(tool); };
  const closeDetail = () => { setSelectedTool(null); openerRef.current?.focus(); };

  return (
    <div className="ai-tools-view-container" data-testid="ai-tools-view">
      {/* Counts come from the same resolver as the rows: deployment capabilities + allowed tools. */}
      <p className="ai-tools-summary" data-testid="ai-tools-summary">
        <span><strong>{counts.engines}</strong> {counts.engines === 1 ? "engine" : "engines"} available</span>
        <span><strong>{counts.ai}</strong> AI {counts.ai === 1 ? "action" : "actions"} allowed</span>
        <span><strong>{counts.roadmap}</strong> roadmap</span>
      </p>
      <p className="ai-tools-explanation">
        Engine status is read from this deployment; AI access follows this project&apos;s allowed tools. Calculations always need your approval.
      </p>

      <div className="ai-tools-search-bar-row">
        <div className="ai-tools-search-input-wrap">
          <AppIcon icon="search" />
          <input type="search" className="ai-tools-search-input" placeholder="Search tools…"
            value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} aria-label="Search tools"
            data-testid="ai-tools-search-input" />
        </div>
        <select className="ai-tools-category-dropdown" value={activeFilter}
          onChange={(event) => setActiveFilter(event.target.value as ToolCategory)} aria-label="Filter tools by category"
          data-testid="ai-tools-category-select">
          {FILTER_CHIPS.map((chip) => <option key={chip} value={chip}>{chip === "All" ? "All categories" : chip}</option>)}
        </select>
      </div>

      {/* Wide (expanded) panel: the same category filter as one row of chips. */}
      <div className="ai-tools-filter-chips-row" role="group" aria-label="Tool category filters">
        {FILTER_CHIPS.map((chip) => (
          <button key={chip} type="button" aria-pressed={activeFilter === chip}
            className={`ai-filter-chip ${activeFilter === chip ? "active" : ""}`} onClick={() => setActiveFilter(chip)}
            data-testid={`ai-filter-${chip.toLowerCase()}`}>
            {chip}
          </button>
        ))}
      </div>

      <div className="ai-tools-list-scroll">
        {filteredTools.length === 0 ? (
          <div className="ai-tools-empty-search" role="status">
            <p>No tools match the current search and filters.</p>
            <button type="button" className="ai-tools-reset-filters-btn"
              onClick={() => { setSearchQuery(""); setActiveFilter("All"); }}>
              Reset filters
            </button>
          </div>
        ) : null}
        {GROUPS.map((group) => {
          const tools = filteredTools.filter((tool) => tool.group === group);
          if (tools.length === 0) return null;
          const collapsed = Boolean(collapsedGroups[group]);
          const roadmap = group === "Roadmap — Not Available";
          return (
            <div key={group} className={`ai-tools-group-section ${roadmap ? "is-roadmap-group" : ""}`} data-testid={`ai-tools-group-${roadmap ? "roadmap" : group.split(" ")[0]?.toLowerCase()}`}>
              <button type="button" className="ai-tools-group-header-btn" aria-expanded={!collapsed}
                onClick={() => setCollapsedGroups((previous) => ({ ...previous, [group]: !previous[group] }))}>
                <div className="ai-tools-group-title-side">
                  <span className="ai-group-icon-wrap" aria-hidden="true">
                    <AppIcon icon={group === "Computational Chemistry" ? "lab-test" : group === "Structure & Data" ? "cube" : group === "Analysis & Visualization" ? "chart" : "time"} />
                  </span>
                  <span className="ai-group-title-text">{group}</span>
                </div>
                <div className="ai-tools-group-meta-side">
                  <span className="ai-group-count">{tools.length} {tools.length === 1 ? "tool" : "tools"}</span>
                  <AppIcon icon={collapsed ? "chevron-down" : "chevron-up"} />
                </div>
              </button>
              {!collapsed ? (
                <div className="ai-tools-cards-container ai-tools-row-list">
                  {tools.map((tool) => (
                    <ToolCard key={tool.id} tool={tool} status={statusFor(tool)}
                      onOpenDetail={(opener) => openDetail(tool, opener)} onDraft={() => draft(tool)} />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {selectedTool ? (
        <ToolDetailModal tool={selectedTool} status={statusFor(selectedTool)} onClose={closeDetail}
          onDraft={() => { setSelectedTool(null); draft(selectedTool); }} />
      ) : null}
    </div>
  );
}

function capabilityTags(status: ResolvedToolStatus, tool: ToolItem): string[] {
  const capability = status.capability;
  if (!capability) return tool.tags;
  // Methods on the card; tasks, bases and version live in the detail dialog.
  return capability.supported_methods.map((method) => method.toUpperCase()).slice(0, 6);
}

function ToolCard({ tool, status, onOpenDetail, onDraft }: {
  tool: ToolItem;
  status: ResolvedToolStatus;
  onOpenDetail: (opener: HTMLElement) => void;
  onDraft: () => void;
}) {
  return (
    <div className={`ai-tool-card status-tone-${status.tone}`} data-testid={`ai-tool-card-${tool.id}`} data-status={status.tone}>
      <div className="ai-tool-icon-col" aria-hidden="true">
        <ToolVisualIcon type={tool.iconType} name={tool.name} />
      </div>
      <button type="button" className="ai-tool-center-col ai-tool-open-detail" onClick={(event) => onOpenDetail(event.currentTarget)}
        aria-label={`${tool.name}: ${status.label}. Show details`}>
        <span className="ai-tool-name-line"><strong className="ai-tool-title">{tool.name}</strong></span>
        <span className="ai-tool-desc">{tool.description}</span>
        <span className="ai-tool-tags-row">
          {capabilityTags(status, tool).map((tag) => <span key={tag} className="ai-tool-tag-chip">{tag}</span>)}
        </span>
      </button>
      <div className="ai-tool-status-col">
        <span className={`ai-tool-status-pill tone-${status.tone}`} data-testid="ai-tool-status"><span className="ai-tool-status-dot" aria-hidden="true" />{status.label}</span>
        {status.canDraft ? (
          <button type="button" className="ai-tool-row-menu-btn" onClick={onDraft} aria-label={`Draft a ${tool.name} proposal in Chat`}
            title="Draft a proposal in Chat" data-testid={`ai-tool-draft-${tool.id}`}>
            <AppIcon icon="chat" />
          </button>
        ) : null}
        <AppIcon icon="chevron-right" />
      </div>
    </div>
  );
}

function ToolDetailModal({ tool, status, onClose, onDraft }: {
  tool: ToolItem;
  status: ResolvedToolStatus;
  onClose: () => void;
  onDraft: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const capability = status.capability;

  // Dialog pattern: focus moves in, Tab stays inside, Escape closes and returns focus to the opener.
  useEffect(() => {
    const card = cardRef.current;
    card?.querySelector<HTMLElement>(".ai-tool-modal-close")?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !card) return;
      const focusable = [...card.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const operations = capability ? capability.supported_tasks.map((task) => TASK_LABEL[task] ?? task) : tool.operations;
  return (
    <div className="ai-tool-modal-backdrop" onClick={onClose}>
      <div className="ai-tool-modal-card" ref={cardRef} role="dialog" aria-modal="true" aria-labelledby={`ai-tool-modal-title-${tool.id}`}
        onClick={(event) => event.stopPropagation()} data-testid="ai-tool-detail">
        <div className="ai-tool-modal-header">
          <div className="ai-tool-modal-brand">
            <ToolVisualIcon type={tool.iconType} name={tool.name} size="large" />
            <div>
              <div className="ai-tool-modal-title-row">
                <h3 className="ai-tool-modal-title" id={`ai-tool-modal-title-${tool.id}`}>{tool.name}</h3>
                <span className={`ai-tool-status-pill tone-${status.tone}`}>{status.label}</span>
              </div>
              <p className="ai-tool-modal-group">{tool.group}{capability?.version ? ` • version ${capability.version} (reported)` : ""}</p>
            </div>
          </div>
          <button type="button" className="ai-tool-modal-close" onClick={onClose} aria-label="Close tool details">
            <AppIcon icon="cross" />
          </button>
        </div>

        <div className="ai-tool-modal-body">
          <section className="ai-modal-section">
            <h4>Description</h4>
            <p className="ai-modal-desc-text">{tool.fullDescription}</p>
          </section>
          {operations.length ? (
            <section className="ai-modal-section">
              <h4>{capability ? "Supported tasks (reported by this deployment)" : "What it does"}</h4>
              <ul className="ai-modal-ops-list">{operations.map((operation) => <li key={operation}>{operation}</li>)}</ul>
            </section>
          ) : null}
          {capability ? (
            <section className="ai-modal-section">
              <h4>Methods and basis sets (reported)</h4>
              <ul className="ai-modal-params-list">
                <li>Methods: {capability.supported_methods.length ? capability.supported_methods.map(methodLabel).join(", ") : "none reported"}</li>
                <li>Basis sets: {capability.supported_basis_sets.length ? capability.supported_basis_sets.map(basisLabel).join(", ") : "none (not applicable or not reported)"}</li>
              </ul>
            </section>
          ) : null}
          {tool.inputs.length ? (
            <section className="ai-modal-section">
              <h4>Inputs</h4>
              <ul className="ai-modal-params-list">{tool.inputs.map((input) => <li key={input}>{input}</li>)}</ul>
            </section>
          ) : null}
          <section className="ai-modal-section">
            <h4>Availability</h4>
            <div className={`ai-modal-availability-callout ${status.tone === "available" ? "callout-available" : "callout-warning"}`}>
              <AppIcon icon={status.tone === "available" ? "tick-circle" : "info-sign"} />
              <p data-testid="ai-tool-availability-detail">{status.detail}</p>
            </div>
          </section>
        </div>

        <div className="ai-tool-modal-footer">
          <ActionButton minimal text="Close" onClick={onClose} />
          {status.canDraft ? (
            <ActionButton intent="primary" icon="chat" text="Draft proposal in Chat" onClick={onDraft} data-testid="ai-tool-detail-draft" />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Engine monograms and workspace glyphs: distinct, flat tiles in the workstation palette. */
const ENGINE_MONOGRAM: Partial<Record<ToolItem["iconType"], { text: string; hue: string }>> = {
  pyscf: { text: "Py", hue: "pyscf" },
  xtb: { text: "xTB", hue: "xtb" },
  crest: { text: "CR", hue: "crest" },
  nwchem: { text: "NW", hue: "neutral" },
  orca: { text: "OR", hue: "neutral" },
  gaussian: { text: "G", hue: "neutral" },
};

function ToolVisualIcon({
  type,
  name,
  size = "normal",
}: {
  type: ToolItem["iconType"];
  name?: string;
  size?: "normal" | "large";
}) {
  const monogram = name === "Psi4" ? { text: "Ψ4", hue: "psi4" } : ENGINE_MONOGRAM[type];
  if (monogram) {
    return <div className={`ai-tool-icon-block ai-tool-monogram hue-${monogram.hue} ${size}`}><span>{monogram.text}</span></div>;
  }
  return (
    <div className={`ai-tool-icon-block icon-generic ${size}`}>
      <AppIcon
        icon={
          type === "structure-builder"
            ? "edit"
            : type === "3d-view"
            ? "cube"
            : type === "file-converter"
            ? "import"
            : type === "analysis"
            ? "derive-column"
            : type === "spectra"
            ? "timeline-line-chart"
            : type === "materials"
            ? "database"
            : "search"
        }
      />
    </div>
  );
}
