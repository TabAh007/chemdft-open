# AI Scientist panel: layout, tabs and plain language (PR 2)

Branch `design/ai-panel-layout-v1` from `origin/main` 318dbb1. **Not deployed, no PR opened, backend untouched.** No AI provider, model, engine
or spending was used: every AI endpoint in the browser tests is mocked.

## Measured problem (origin/main, jobs fixture, AI mocked)
Dock width is 319-373 px at 1280-1440 px and was **not** the cause. The chat column needed 757-774 px and had 546-565 px at 1280x720
(overflow ~190 px; 110 px at 1280x800; 12-31 px at 1440x900) because the conversation block was `flex: 1 0 auto; min-height: 220px`, so the whole column
scrolled and the status bar scrolled out of view. Rows: status bar 127 px, investigation row 25, composer 231 (mode row 34, scope text 33, run limits 24, box 97).

## What changed
- `ai-conversation-state.ts`, `ai-scientist-composer.tsx`, `ai-scientist-chat-tab.tsx`, `ai-scientist-messages.tsx`: pure moves out of
  `ai-scientist-panel.tsx` (1576 -> 845 lines). Rendered HTML identical across 34 panel states of the ui-1 suite before and after each move.
- Tabs: Chat, Evidence, Runs; Tools and Settings behind a "More" menu and joining the row while active. No event or deep link opened them before.
- Layout: the conversation is the one scroll region (min 120 px); status bar 127 -> 107 px, composer 231 -> 201 px; run limits and the general-planner
  opt-in behind one Options button (dot when changed); Follow AI / Stay here only in the Workspace (the Result inspector does not read the workspace
  selection, so it cannot act there). Grounding and read-only badges wrap instead of truncating.
- Copy: stored error codes, the approval's status code, tool and fingerprint, and model-save errors show as plain sentences with the original text under
  Details. Unchanged on purpose: "Development use only", "No fallback model is used", "AI explanation", "Named, not grounded", "Read-only",
  "Proposed under", "Nothing runs until you approve", the proposal blocker notice, Investigation tools wording, and the Tools, Runs and Evidence tabs.

## Verification (real output, 2026-10-26)
tsc, eslint (0 warnings) and vitest 95 files / 1282 tests: PASS. Fixture e2e (jobs, claims, comparison, settings mock APIs, AI mocked): 76 PASS and
1 FAIL (`settings-redesign:84`, needs a second dev server on :3395 that did not start; identical before and after this work). New `ai-panel-layout.spec`
(1280x720, 1280x800, 1440x900, 1920x1080, dock open and closed, badge whole, no page overflow, overflow-menu keyboard path, Options): 9 PASS guided,
5 PASS + 4 skipped advanced (the Advanced Workbench has no closable dock). axe (WCAG A/AA) on Chat, Chat with Options, the open menu, Settings and
Evidence: 0 violations. Impeccable detector: 0 findings in the AI panel sources.

## NOT RUN / NOT VERIFIED
- Real-stack specs (`ai-scientist`, `ui-1-ai-scientist`, `ai-model-switcher`, `ai-nvidia-planning`, `guided-workflow-acceptance`,
  `results-inspector-evidence`): edited where they click Tools or Settings (`openAiPanelTab`) but NOT RUN (they need the isolated backend stack).
- The Tools and Runs tabs crash the page on the jobs fixture (also on the commit before the tabs change), so they were not measured or axe-checked there.
- Real model replies, a hosted build, dark theme, below 1280 px, the approval screen at 1280 px (no fixture proposal), the activity-timeline error states.
- `NEXT.md` and `docs/history/CHANGELOG.md` are not touched here (PR #11 owns them); update them when this lands.
