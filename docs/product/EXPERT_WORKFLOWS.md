# Expert and Manual Workflows

## Shared-action rule

The expert UI is not a second implementation. Forms, toolbars, context menus, command palette, and AI plans all edit or submit the same normalized draft action and call the same Tool Registry entry. A manual change produces a new draft revision visible to the AI Scientist; AI can explain or run that exact revision but cannot silently overwrite it.

## AI ↔ expert handoff

1. AI creates a non-executing plan and normalized settings draft.
2. Researcher selects **Review settings**; the related calculation document opens on Quick with Advanced available.
3. Researcher changes basis, solvent, convergence, resources, constraints, stage count, or processing parameters.
4. Validation runs deterministically and the plan shows “Modified by you,” a diff, new estimate, and invalidated approval if material.
5. Researcher may return to AI and say “run with these settings”; the AI references the immutable draft revision.
6. Submission uses normal authorization, budget, job, provenance, and firewall paths.

The reverse also works: a manually configured draft can be sent to the AI Scientist for critique or explanation without giving the model authority to execute or rewrite it.

## Manual calculation workflow

- Select exact StructureVersion/Conformer.
- Choose Quick preset or Advanced.
- Set engine (`Auto` or explicit), task/driver, method, basis, dispersion, solvent, charge, multiplicity, SCF/convergence, resources, constraints, and property-specific settings.
- Inspect compatibility diagnostics and generated normalized input preview; raw engine input is read-only/generated unless a future expert raw-input mode creates an explicitly unsupported/custom action class.
- Request estimate; approve maximum; submit.
- Monitor durable state/logs/artifacts; cancel/retry by creating a new attempt/draft.
- Inspect result with convergence, provenance, and raw output reachable.

## Manual structure workflow

Use Ketcher-backed 2D tools and contextual 3D tools for select/build/modify/measure. Commit scientifically meaningful edits as named StructureVersions or variants; session undo/redo operates before commit. Constraints and coordinates attach to the current version/draft. Geometry cleanup is an explicit deterministic action with preview and method provenance.

## Manual spectrum workflow

Open raw dataset → create processing branch → append deterministic steps (baseline, smoothing, normalization, peak picking, integration where applicable) → preview each change → commit derived version → edit assignments/annotations as versioned analysis. Users can toggle or reorder compatible steps and compare branches; raw data never changes.

## Manual crystal workflow

Inspect/edit lattice parameters, coordinates, occupancy, symmetry interpretation, replication, and supercell transforms in a dedicated workspace. Each committed transform creates a StructureVersion with coordinate convention and symmetry provenance. Unsupported disorder/refinement states are shown rather than normalized away.

## Manual comparison and export

Users explicitly choose left/right/overlay sources, synchronization, alignment/matching method, metrics, and display settings. AI explanation is optional. Export uses the same `export.*` action as language requests and offers a manifest/provenance sidecar by default.

## Presets

Presets are versioned scientific configuration bundles with owner, rationale, compatible task/domain, and visible values. “Recommended” means a documented policy/model selected it; it is not a guarantee. Organization presets may constrain allowed engines/methods/budgets but cannot hide the resulting settings.

## No-token deterministic interactions

Rotating/zooming a molecule, switching an already-computed orbital, opening/filtering/navigating, drawing, visualization changes, spectrum pan/zoom, measurement, selecting a mode/peak, toggling layers, and exporting known data do not call an LLM. Model use is reserved for ambiguous intent, planning, explanation, synthesis/RAG, and hypothesis generation.
