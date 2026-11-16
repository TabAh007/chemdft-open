# Contributing to ChemDFT

Thanks for helping. This project is maintained by one person, so the rules below exist to keep review possible.

## Before you write code

1. Read [docs/02_SCIENTIFIC_INTEGRITY.md](docs/02_SCIENTIFIC_INTEGRITY.md). No pull request may introduce a scientific
   value that did not come from an engine.
2. Read [docs/15_ENGINEERING_RULES.md](docs/15_ENGINEERING_RULES.md).
3. Open an issue first for anything beyond a small fix. A co-maintainer is being sought (see [GOVERNANCE.md](GOVERNANCE.md)).

## What a pull request must have

- **Tests.** Every behaviour change needs a test that fails without it.
- **The local gate.** Run `scripts/local-gate` before opening the pull request. A `FAIL` blocks review; a `NOT RUN` must
  be named in the description.
- **A release entry** if a user would notice the change, with its scientific status stated honestly (verified, with
  platform and engine; or not verified).
- **No invented results.** If a number appears in a test, it must come from a recorded run or be clearly synthetic.

## Declaring AI assistance

AI assistance is allowed and must be declared. In the pull request description, add a line like:

> AI assistance: used <tool> to draft <what>. I reviewed every line and ran the gate.

Undeclared AI authorship is a review problem, not a legal one, but it slows the review down and is treated as a defect in
the pull request.

## The dependency rule that is not negotiable

Some dependencies carry licence terms about machine learning. **geomeTRIC** forbids use of its source or binary in
AI-training datasets. ChemDFT therefore does not ship it and does not install it by default — do not add it back to the
default dependency set, do not vendor it, and **never include geomeTRIC code or output in an AI-training dataset**.
The same caution applies to any dependency whose licence restricts training use: check before you add it.

## Licensing of contributions

By contributing you agree that your contribution is licensed Apache-2.0, the project's licence for first-party code.
Do not paste code from a project with an incompatible licence; if you adapt anything, say where it came from and under
what licence.

## Style

- Run the linters the gate runs. Do not add per-file ignores without a comment explaining why.
- Keep the distinction between calculated, candidate, estimated and display-only values visible in types and in the UI.
- British spelling in prose, matching the existing documents.

## Review

Expect questions about provenance and about tests. A change that cannot be verified will be described as unverified
rather than merged quietly.
