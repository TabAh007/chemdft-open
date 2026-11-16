# Error, Empty, and Uncertainty States

## Copy formula

Lead with the exact state, identify affected object/stage, state what remains valid, then offer recovery. Preserve technical detail behind an expandable section/log; do not replace it with friendliness.

| State | Primary message | Primary recovery |
|---|---|---|
| No project | “Start a project or open existing work.” | Create, import, open recent, skip onboarding |
| Project loading | “Loading project structure…” with freshness/status | Retry; work shell remains stable |
| No structure | “This project has no structure yet.” | Draw, import, reconstruct from supported result |
| Unsupported file | “This file type/version is not supported.” | Show detected type, supported formats, retain/reject safely |
| Invalid molecule | Exact validation issue (valence, missing coordinates, charge ambiguity) | Focus atoms/fields, edit, inspect raw import |
| Failed parser | “Parser X could not read section Y.” | Open raw file/log, try supported parser/version, report issue |
| AI uncertain | “I found 3 plausible assignments; evidence does not distinguish them.” | Compare candidates, inspect evidence, ask/record expert correction |
| Calculation queued | “Queued; provider has not started execution.” | Show queue time estimate only if reliable, cancel |
| Nonconverged | “SCF did not converge after 100 cycles.” | Inspect log, modify settings, retry recommended draft, ask AI |
| Calculation failed | Exact engine/system exit and last valid stage | Logs/artifacts, retry/new settings, support path |
| Partial result | “Stage 3 failed; stages 1–2 remain validated.” | Inspect partial outputs, resume/replan where valid |
| Missing experimental data | “No compatible experimental FTIR is linked.” | Select/import dataset, continue calculated-only |
| Insufficient basis support | Name elements/basis incompatibility | Choose supported basis/preset; no silent substitution |
| Compute unavailable | Name required capability/availability state | Wait, change policy/resource if scientifically equivalent, cancel |
| Budget exceeded | “Next stage would exceed the $5.00 authorization.” | Raise cap with new approval, remove stage, stop with partial results |
| API key invalid | Name provider/connection, never echo key | Reconnect/rotate, use managed AI if permitted |
| Conflicting RAG sources | “Sources disagree on X.” | Side-by-side citations, trust/provenance, record decision/correction |
| Low-confidence digitization | “Digitized from Figure 3; estimated confidence low.” | Inspect overlay/calibration, correct points, keep approximate label |

## Empty-state rules

Use one sentence, direct domain actions, and optional short explanation. No invented metrics/charts/cards, cartoons, or forced AI prompt. Empty groups remain compact in explorer. A first project may show the six onboarding actions defined in [Product Definition](PRODUCT_DEFINITION.md#onboarding).

## Loading/progress rules

Skeletons reflect real shell geometry only; they never contain fake molecular/spectral shapes or numbers. Use percentage only from real telemetry. Keep elapsed time, current stage, last update/freshness, and cancellation available.

## Uncertainty rules

Express source, type, confidence/ambiguity, alternatives, missing evidence, and what would resolve it. Do not convert model confidence into scientific probability unless calibrated and defined. Approximate/AI hypotheses remain labeled after user acceptance unless verified by an approved mechanism.
