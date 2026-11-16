# Shared AI context contract (PR 1)

Branch `design/ai-context-contract-v1` from `origin/main` @ fa67289. **Not deployed, no PR opened, backend untouched.** No AI provider, model, engine or
spending was used: every AI endpoint in the browser tests is mocked.

## Problem
The AI Scientist dock followed the Workspace selection (events on `window`) on every page, so an answer given under one selection stayed visible on
Compare, Jobs and the rest. Only the view *label* followed the URL.

## Contract (`apps/web/src/lib/ai-context.tsx`)
- `AiContextProvider` is mounted in `ProjectShell`. A page calls `useAiPageContext(projectId, context)`; the entry is removed when the page unmounts and only
  its owner can clear it (a late unmount never wipes its successor). With no provider the hook is a no-op.
- `resolveAiContext(projectId, projectName, context)` is the single mapping to: the **thread key**, the `current_view` text, the **`ProductSelection` hints**,
  the grounding level and the read-only flag.
- `ProjectDock` chooses the context: the Workspace route (and any unrecognised route) is **bridged** from the existing Workspace selection and events (unchanged
  behaviour, same thread key `kind:id`); every other route uses what its page published, else the project default. It never falls back to the Workspace selection.
- `AIScientistPanel` takes `aiContext`; without it the old `currentSelection`/`currentViewLabel` props still work (tests, bridge).

| Page | Publishes | Thread key | Sent to the server | Grounding |
|---|---|---|---|---|
| Workspace | selection + view label (bridge) | `kind:id` / `project` | as before | grounded |
| Result inspector | the inspected `calculationResult` | `calculationResult:<id>` | `selected_result_id` | grounded |
| Overview, Results, Settings, empty lists | section | `project` | `current_view` only | project |
| Jobs | selected job | `job:<id>` | `current_view` only | **named** |
| Claims | selected claim (+ source document id) | `claim:<id>` | `current_view`, `selected_document_id` if a UUID | **partial** (paper only) |
| Compare | compared result ids (read-only) | `compare:<sorted ids>` | `current_view` only (letters, reference) | **named** |
| Paper vs ChemDFT | selected row (read-only) | `paper:<row>` | `current_view` only | **named** |

The server's `ProductSelection` accepts one structure, version, result, document or spectrum id plus `goal` and `current_view` (max 500 characters). It accepts no
job id, claim id or list of results; those are named in the view text only and badged "Named, not grounded". Proposed additive backend work (not done):
`compared_result_ids`, `selected_claim_id`, `selected_job_id`.

## Panel behaviour on a context change
- One conversation thread per key (`turnStarts[key]`): an answer asked under key A is shown collapsed in "Previous conversation" under any other key and returns
  to the thread when A returns. A key never asked in shows only history and an empty state naming the new context.
- A run loaded from the server after a reload has no recorded context, so the old "Saved workflow messages" block (which showed that run's messages open under *any*
  context) now appears only for a run asked under the current context; otherwise those messages stay in the collapsed history. (Found by the Compare e2e on the real
  stack; the mocked scenarios did not catch it.)
- The page's limits are one quiet line in the existing status bar (`ai-context-tags`: "Read-only", "Named, not grounded" / "Named, partly grounded"), only where the answer
  is limited. A first version added a separate row; it pushed the chat container into overflow at 1440x900, so it was folded into the status bar (overflow now identical to origin/main).
  `data-context-page|key` and `data-grounding` are on the panel root.
- Unsent drafts are kept per key (memory only).
- Each run remembers the context it was asked under. If a run is still working, a notice says its answer will appear under that context; the pending-question bubble
  is shown only under its own context.
- A pending approval stays on screen with the full proposed action, labelled "Proposed under: <context>" when the context has changed; approve and reject keep
  working and **nothing is decided automatically** by switching pages. After a reload the origin is unknown and no label is shown (limitation).
- `chemdft:compare-context` and `chemdft:comparison-summary`-style plumbing for Compare is replaced by the provider; the other window events (selection, inspector,
  open/toggle dock, approval state, evidence, guided navigation) are unchanged.

## Verification (2026-10-26, real output; see the PR 1 report)
Unit/component: `tests/ai-context.test.ts` (contract, mapping, provider), `tests/ui-1-scientific-integrity.test.ts` (5 panel tests: per-key thread, badge, drafts,
approval origin, in-flight run), `tests/compare-workstation.test.ts` (notice and publisher). E2E `tests/e2e/ai-context-follows-page.spec.ts` (`playwright.ai-context.config.ts`):
one scenario per page; Jobs, Claims, Paper vs ChemDFT, Settings against the presentation-fixture mock APIs, Overview, Workspace, Results, Compare against the
disposable evidence stack. **NOT VERIFIED:** real AI replies, the real `/ai/context` for non-Workspace pages (including the Claims `selected_document_id`), a hosted
build, dark theme, below 1280 px.

## Update 0.0.18: ids now grounded
`ProductSelection` accepts `compared_result_ids` (max 8), `selected_claim_id`, `selected_job_id`; the server verifies project membership, ignores foreign or unknown ids with one neutral note, and adds `grounding_facts` built from stored records only (see RELEASE_0_0_18.md section 4). Jobs, Claims, Compare and Paper vs ChemDFT now publish those ids (grounding "grounded"); Claims no longer sends `selected_document_id`; the panel falls back to the view text alone if the server refuses id hints. The tables above describe the 0.0.1 contract; where they say "named, not grounded" for these four pages, this update supersedes them. NOT VERIFIED against the real `/ai/context` on the live server or a real model.
