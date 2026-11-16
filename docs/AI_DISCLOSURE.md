# AI authorship disclosure

This document states what is verifiable about how ChemDFT's code was written. It is written to be quoted in funding
applications and questionnaires, so every sentence is either evidenced or marked **OWNER TO CONFIRM**.

## 1. What was used

AI coding agents wrote a substantial part of the code. The evidence is in the repository's own history:

| Fact | Evidence |
|---|---|
| 43 commits were authored directly as `Claude <noreply@anthropic.com>` | `git log --all --format='%an'` |
| 375 commits carry a `Co-Authored-By: Claude …` trailer | `git log --all --format='%b'` |
| The agent models named in those trailers are Claude Sonnet 5.5, Claude Opus 5.5 and Claude Fable 5.1 | the same trailers |
| 652 commits are authored by the owner (Tabriz Ahmadli), under two addresses | `git log --all --format='%an|%ae'` |
| Codex and Antigravity agents are also used, and their work is governed by the same rules | AGENTS.md, apps/web/AGENTS.md |

The project's own instruction file is written for exactly this situation: *"Applies to Claude, Codex, Antigravity and any
other assistant."* Agents are not an incidental tool here; they are the primary implementation mechanism.

## 2. Who decides

The owner directs the work, sets the constraints, and approves or refuses each step. Recorded rules:

- Every commit, push, merge, deploy, image build, scientific run and any spending requires the owner's explicit approval
  for that step (AGENTS.md).
- The owner's decisions are recorded in DECISIONS.md and are binding on the agents.
- Agents may merge their own PRs only after both CI checks are green and only when the change carries no migration, route,
  schema, config or spending change (DECISIONS.md).

**OWNER TO CONFIRM:** the repository does not prove that the owner reads every line of every agent-written change before it
is merged. What it does show is that the owner defines the rules, reviews the results he chooses to review, and is the only
person who can deploy, spend or run science. Any statement stronger than that — for example "every line was reviewed by a
human" — would not be supported by these documents, and should not be made.

## 3. What a language model is not allowed to do

The project's central rule is that a model never produces a scientific value. From
[02_SCIENTIFIC_INTEGRITY.md](02_SCIENTIFIC_INTEGRITY.md) and [15_ENGINEERING_RULES.md](15_ENGINEERING_RULES.md):

- Engines (PySCF, Quantum ESPRESSO, xTB, CREST) are the only source of calculated numbers.
- The AI Scientist plans, explains and requests typed tools; it cannot write a result.
- "LLMs cannot directly write authoritative calculated results" (rule 3).
- Hypotheses produced by a model stay labelled and separate from `CALCULATED` results.

## 4. How that is enforced: the Result Firewall

Every result that reaches a scientist passes through the Result Firewall. It records provenance for each value and refuses
a job that did not converge or whose numbers cannot be cross-checked. This is implemented in the backend, not asserted in
prose: the publication gates, the convergence checks and the engine log cross-checks (`_require_qe_log_energy`, the relax
cross-check at 1e-6 Ha, the energy check at 1e-7 Ha) live in `services/api/src/chemdft_api/`.

The firewall is a software control. It is only as good as its tests, and those tests are listed in §6.

## 5. What the tests and gates actually are

- A local verification gate (`scripts/local-gate`, `--full`) that runs backend tests against a known-failure baseline,
  backend lint, web unit tests, web lint, web typecheck, version-consistency tests, the licence-map check and the
  documentation rules. It prints PASS / FAIL / NOT RUN per step and a machine-readable summary.
- About 1,800 web unit tests and a large backend suite, of which roughly 130 need native engines or retained evidence and
  are listed in `.github/ci-local-only-tests.txt`.
- Playwright layout suites for the public pages and the workspace.
- Opt-in tests against real engines that are skipped when the engine is absent.

## 6. What is NOT verified

These are open, recorded in NEXT.md, and must not be described as done:

- **AI-planned proposals are not verified on the hosted platform.** The AI Scientist's plans have not been shown end to end
  against the live service.
- **Two-account isolation is not verified live.** The owner skipped that test; the offline suites pass.
- **Live Google sign-up with a new account is not verified.**
- **Real-engine verification covers one system.** The only end-to-end scientific runs recorded are on alpha-Cr2O3 and a
  small set of molecular jobs, on one platform, with recorded engine versions. That is evidence for those runs, not for
  the platform in general.
- **A model's scientific prose is not independently fact-checked.** Citations and values in AI output are constrained by
  the tools it can call, not proofread by a chemist.

## 7. What this means for a funder

Stated plainly: ChemDFT is a project where AI agents write much of the code under an owner who sets the rules, holds the
credentials and makes every consequential decision, and where scientific values can only come from engines through a
provenance firewall. The risk is not that a model invents a number — the architecture forbids that — but that
agent-written code contains defects the owner has not personally read. The mitigation is tests and gates, not review
claims.

## 8. How contributors should declare AI assistance

See [CONTRIBUTING.md](../CONTRIBUTING.md). A contributor who used an AI assistant must say so in the pull request, name the
tool, and describe what it wrote. Undeclared AI authorship is treated as a review problem, not a legal one.
