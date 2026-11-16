# AI-First Workflows

## Interaction contract

Natural language is the default path for multi-step work. The AI Scientist resolves active project/selection, retrieves relevant context, proposes a reviewable typed plan, exposes assumptions/settings, requests deterministic estimates and approval, invokes the shared Tool Registry, monitors durable jobs, opens deterministic views, compares results, and explains evidence/uncertainty.

Plans never execute by implication. The AI cannot author authoritative values, lower permission/cost classes, create approval tokens, or bypass the Scientific Result Firewall. Simple deterministic interaction uses no model call.

## Structured message types

User request; explanation; proposed plan; tool action; progress; approval request; budget estimate; evidence; warning; failed calculation; result comparison; hypothesis; uncertainty; citation/reference; suggested next action. Render as compact notebook/activity blocks with timestamp, actor, entity links, state, and expandable details—not giant chat bubbles.

Entity references select/open the central workspace. For example, selecting “1718 cm⁻¹” in an explanation selects the peak, focuses the spectrum range, opens the mapped normal mode, highlights atoms, and exposes mapping confidence and provenance.

## Workflow A — Draw molecule → optimize → HOMO/LUMO → export

| Aspect | Contract |
|---|---|
| User action | draw/import and say “Optimize this and show the HOMO and LUMO.” |
| System action | validate active StructureVersion; propose optimization + orbital plan; estimate/approve; run; publish validated results; open orbital view |
| Action families | `structure.*`, `calculation.*`, `budget.*`, `visualization.*`, `export.*` |
| UI response | plan block → job activity → optimized variant/result → HOMO/LUMO selector and export |
| Provenance | original structure preserved; optimized coordinates link to exact job/input/engine/method/artifacts |
| Failure path | invalid valence or nonconvergence names the cause; keep logs/partial result; offer settings/manual inspection |
| Approval | low-cost auto-run only under policy; otherwise estimate and approval/cap |
| AI / deterministic | AI interprets intent/explains; editor validation, engine, firewall, orbital scene, and export are deterministic |

## Workflow B — FTIR → molecule → calculated IR → linked vibration

| Aspect | Contract |
|---|---|
| User action | upload FTIR and structure; ask to calculate IR and compare |
| System action | import/quarantine raw FTIR; review processing; validate structure; propose optimize/frequency workflow; compare peaks/modes |
| Action families | `experiment.*`, `spectrum.ftir.*`, `structure.*`, `calculation.*`, `result.compare`, `visualization.*` |
| UI response | raw/derived pipeline, overlay/residual view, mapping table, linked molecule mode |
| Provenance | raw immutable; baseline/smoothing/peak picks versioned; computed modes retain exact calculation provenance |
| Failure path | unsupported data, poor baseline, imaginary/nonconverged modes, or ambiguous mapping remain explicit |
| Approval | import/inspection is low-cost; calculation plan is estimated and policy-approved |
| AI / deterministic | AI recommends/explains assignments; processing, calculation, matching metrics, and displacement animation are deterministic |

## Workflow C — “Find conformers and calculate the best ones”

| Aspect | Contract |
|---|---|
| User action | natural-language request on active structure |
| System action | ask only material ambiguity (property/accuracy/budget); propose CREST → xTB → ranked selection → DFT DAG with stop criteria |
| Action families | `conformer.*`, `calculation.*`, `budget.*`, `result.compare` |
| UI response | editable plan with counts/methods, per-stage estimates, rank table, selected conformers, durable jobs |
| Provenance | generated conformers, ranking method, thresholds, selected/rejected candidates, and every calculation linked |
| Failure path | no valid conformers, duplicated structures, stage failure, or cap exhaustion stops safely with partial completed results |
| Approval | aggregate maximum or staged authorizations; never exceed hard cap |
| AI / deterministic | AI scopes/justifies plan; CREST/xTB/QM, deduplication, ranking metrics, and budget ledger are deterministic |

## Workflow D — PDF → evidence → verified project entities

| Aspect | Contract |
|---|---|
| User action | upload paper and request experimental methods/data extraction |
| System action | quarantine/parse; detect candidates; display page/table/figure coordinates and source class; user accepts/corrects/ignores/promotes |
| Action families | `knowledge.*`, `literature.*`, `experiment.*`, `structure.version.create` |
| UI response | synchronized PDF + extraction ledger + entity-link inspector; filters for pending/accepted/ignored |
| Provenance | written value=`EXTRACTED`; graph reconstruction=`DIGITIZED`; figure structure=`AI_HYPOTHESIS`/AI-reconstructed until verified |
| Failure path | malicious/unsupported PDF, OCR uncertainty, conflicts, or missing coordinates blocks promotion or requires review |
| Approval | parsing may auto-run within limits; creating entities requires explicit user acceptance; external literature actions follow policy |
| AI / deterministic | AI identifies/summarizes candidates; parser coordinates, hashes, types, validation and promotion are controlled pipelines |

## Workflow E — Variant → compare calculations → preserve original

| Aspect | Contract |
|---|---|
| User action | ask AI to replace/add/edit a scientifically meaningful structural feature and compare outcomes |
| System action | preview edit; create child StructureVersion; apply equivalent calculation specs; compare results |
| Action families | `structure.version.create`, `structure.*`, `calculation.*`, `result.compare` |
| UI response | original/variant side-by-side with structural difference, synchronized camera, calculation/evidence table |
| Provenance | parent, edit operation, actor/model, settings and calculations retained; original immutable |
| Failure path | ambiguous edit requests clarification/selection; chemically invalid proposal remains a candidate and cannot calculate |
| Approval | variant creation may be reversible/low-cost; calculations follow cost policy |
| AI / deterministic | AI proposes transformation/explanation; structure operation, validation, calculation and diffs are deterministic |

## Workflow F — Import Gaussian/ORCA result → reconstruct project → visualize

| Aspect | Contract |
|---|---|
| User action | upload supported output/log files |
| System action | quarantine; identify format/version; parse with cclib/validated adapter; show reconstruction preview and unsupported fields; user confirms entities |
| Action families | `artifact.*`, `calculation.import`, `structure.import`, `visualization.*` |
| UI response | import report, extracted input/method/geometry/results, raw log, warnings, reconstructed calculation document |
| Provenance | `CALCULATED` imported result retains external engine/version/parser/source artifact; no claim that ChemDFT executed it |
| Failure path | truncated/unknown output, ambiguous units, failed calculation, or proprietary format remains partial/non-authoritative |
| Approval | parsing is low-cost; entity promotion requires confirmation when mappings are ambiguous |
| AI / deterministic | AI explains failures/missing fields; parser/schema/firewall/scene are deterministic |

## Workflow G — CIF → crystal → XRD comparison

| Aspect | Contract |
|---|---|
| User action | upload CIF and XRD dataset; ask to inspect/compare |
| System action | validate cell/symmetry/occupancy; import raw XRD; propose versioned processing; calculate/import reference pattern where supported; map peaks/planes |
| Action families | `crystal.*`, `experiment.*`, `spectrum.xrd.*`, `result.compare`, `visualization.*` |
| UI response | crystal document, lattice/atom/symmetry tables, synchronized XRD overlay and plane/phase inspector |
| Provenance | CIF source and all cell transforms versioned; raw XRD retained; mapping method/confidence visible |
| Failure path | invalid/disordered CIF, unsupported occupancy, unidentified phase, or ambiguous peak mapping is explicit |
| Approval | import/inspection low-cost; simulated patterns/refinement/compute require normal estimate policy |
| AI / deterministic | AI narrates hypotheses; crystallographic validation, transformations, plots, and mappings use deterministic services |

## Workflow H — Expensive agent plan → estimate → approval → enforced budget

| Aspect | Contract |
|---|---|
| User action | request multi-stage scientific outcome and specify “do not spend more than $5” |
| System action | normalize DAG; estimate each stage; set maximum ≤$5; reserve budget; require approval; dispatch stages; reconcile actuals |
| Action families | `calculation.*`, `budget.estimate`, `approval.*`, `budget.reserve`, `job.*` |
| UI response | itemized range, assumptions, maximum authorized, current/remaining, stage progress, cancel, partial outputs |
| Provenance | approval identity/time/scope, plan version, estimates, executions, actual cost and stop cause retained |
| Failure path | stale quote, insufficient allowance, provider unavailable, or projected overrun prevents start/next stage; no silent downgrade |
| Approval | explicit when policy requires; any material plan/settings/cap change invalidates old approval |
| AI / deterministic | AI drafts plan; policy, estimate, reservation, cap enforcement, execution and metering are server-side deterministic systems |

See [expert workflows](EXPERT_WORKFLOWS.md), [calculation UX](CALCULATION_UX.md), and [ADR-016](../adr/ADR-016-ai-first-expert-equivalent.md).
