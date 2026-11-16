# Permanent Engineering Rules

1. Verify repository health before every feature phase.
2. REAL SCIENCE ONLY: never invent scientific output or silently substitute simulated production providers/results. Explicit isolated test doubles are allowed only as labeled automated-test fixtures, never as real scientific evidence; see [scientific integrity](02_SCIENTIFIC_INTEGRITY.md).
3. LLMs cannot directly write authoritative calculated results.
4. Preserve scientific provenance.
5. Scientific engines must remain replaceable.
6. Business/domain logic must not live inside UI components.
7. UI, API, AI Scientist, WebMCP, and MCP reuse typed domain actions.
8. Expensive operations require deterministic server-side budget enforcement.
9. Preserve original scientific source data as immutable artifacts.
10. AI-generated scientific modifications create versions/variants by default.
11. Do not overwrite working architecture casually; supersede decisions explicitly.
12. Do not add dependencies without a documented reason, exact version, license review, and ownership.
13. Do not mix full UI design systems.
14. Blueprint.js is the confirmed UI foundation.
15. Light-first scientific workstation is the confirmed design direction.
16. **Impeccable is mandatory for every UI change**, for Codex, Claude Code, Antigravity and future
    agents. Review existing standards, perform an appropriate audit/critique, implement, refine
    layout/typography, check spacing/alignment/accessibility/responsiveness, then visually review
    and polish. Use focused Playwright/browser visual checks where feasible. Reuse the installed
    skill, Blueprint.js, existing tokens/components; no unnecessary reinstall or competing UI system.
    Report actual checks/evidence. If unavailable, report the blocker; never claim unused checks ran.
17. Internationalization is foundational, not a later retrofit.
18. Provider-specific compute stays behind Compute Gateway adapters.
19. Provider-specific LLM behavior stays behind Model Gateway adapters.
20. Optimize token/model consumption without sacrificing correctness; follow [MODEL_ROUTING.md](engineering/MODEL_ROUTING.md).
21. Update NEXT.md after every phase or meaningful implementation milestone by **replacing** the
    current state (it stays under ~150 lines, no logs), and add one line per change to
    CHANGELOG.md. Detailed evidence belongs in the task's implementation document.
22. Architecture documentation is source of truth; intentional divergence requires the relevant document and ADR/index update.
23. Before proposing or installing a dependency, consult TECHNOLOGY_REGISTRY.md, reuse approved technologies when suitable, inspect actual implementation status, verify compatibility/licensing, document the decision, and update the registry after implementation. Installation is not execution evidence.
24. **Every user-visible change adds or updates a release entry** (`apps/web/src/content/releases.ts`) and bumps the version
    (patch for fixes, 0.0.x steps for meaningful batches, 1.0.0 reserved), keeping `package.json` and `CITATION.cff` equal to it (tests enforce this).
    Each entry states its scientific status honestly: Verified (platform and engine), Not yet verified, Known limits. Backend-only changes need
    an entry only if users would notice. Licensing: open-group files carry the Apache-2.0 SPDX header and nothing else does; see
    [RELEASES_AND_LICENSE.md](implementation/RELEASES_AND_LICENSE.md).
25. **Every release states whether a Zenodo version is needed** (only if an open-core path changed or at a milestone; otherwise the
    release notes say "no Zenodo version"). Procedure and the snapshot script: ZENODO_RELEASE_CHECKLIST.md.

## Working practices

- Read `NEXT.md`, these rules, and only the task-relevant architecture/ADRs before broad repository inspection.
- Prefer small, evidence-backed changes and executable tests/results over long speculative explanations.
- Preserve unrelated user changes and local scientific sources.
- Keep authoritative, candidate, narrative, estimate, and display-only data types distinct in contracts and UI.
- Capture units, versions, hashes, immutable inputs, and typed errors at system boundaries.
- Avoid framework/provider leakage into domain contracts.
- Treat documents, model output, scientific files, calculation inputs, and remote providers as untrusted at their boundaries.
- Do not claim legal, scientific, security, performance, or cost guarantees without validation evidence.

## Milestone checklist

For every meaningful milestone:

1. Check working tree and current phase.
2. State scope and applicable ADRs.
3. Implement without unrelated rewrites.
4. Test scientific/domain invariants and boundary failure paths.
5. Review security, provenance, budgets, i18n, licensing, and accessibility as applicable.
6. Update docs/ADRs and `NEXT.md` when state or architecture changes.
7. Leave the Git working tree and handoff understandable.

## Local verification gate (merge gate)

Release 0.0.25 (decision recorded in DECISIONS.md, 2026-11-09): GitHub Actions is not the merge gate. Before merging, run `scripts/local-gate` (fast: the branch's changes against `origin/main`) or `scripts/local-gate --full`. It runs backend tests against the tracked known-failure baseline (`scripts/local-gate-baseline.txt`; only new failures fail), backend lint, web unit tests, web lint, web typecheck, the release-version-vs-`releases.ts` tests, the licence-map check and the `NEXT.md` / `CHANGELOG` rules, and prints PASS / FAIL / NOT RUN per step plus one `GATE_SUMMARY` line. It never touches AWS, SSM, the worker, a provider or any paid service. A `FAIL` blocks the merge; a `NOT RUN` must be named in the report. Regenerate the baseline only on a clean `origin/main` with `scripts/local-gate --regen-baseline`.

