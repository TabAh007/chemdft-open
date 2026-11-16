# Governance

## Who decides

ChemDFT is maintained by **Tabriz Ahmadli** as a solo maintainer. There is no committee, no foundation and no company
behind it today. The maintainer makes every decision, holds the credentials, and is the only person who can deploy, spend
money or approve a scientific run.

This is a deliberate stage, not a permanent design: the goal is research infrastructure that outlives one person, which
is why the code is Apache-2.0 and the project is looking for a co-maintainer.

## How decisions are made

1. Anything that changes scientific behaviour, a contract, a schema or the licence needs a written decision (an ADR in
   `docs/adr/` in the repository) before it is implemented.
2. Every other change is decided in the pull request, in public, with the tests as the argument.
3. Where the maintainer is unsure, the project ships the narrower, more honest statement rather than the stronger one.

## How someone becomes a co-maintainer

There is no formal election. The path is:

1. Contribute changes that are reviewed and merged (a handful, not one).
2. Show judgement about provenance and about what must not be claimed.
3. Ask. The maintainer will grant commit or review rights for a defined area first (for example "the periodic engine" or
   "the web workspace"), then wider rights.

**Open call: ChemDFT is looking for a co-maintainer with a computational-chemistry or research-software-engineering
background.** The work is engine integration, scientific validation and reviewing claims for truth. If that is you,
open an issue introducing yourself.

## The two rules that cannot be changed by a vote

1. **No AI-generated scientific value may enter a result.** Engines calculate; models plan and explain; the Result
   Firewall records provenance. A change that lets a model write a number into a result is not merged, whatever its
   popularity.
2. **No dependency may be used in breach of its licence about machine-learning training.** geomeTRIC forbids use of its
   source or binary in AI-training datasets; it is therefore optional, never vendored, and never part of a default
   install. The same test applies to any dependency with similar terms.

## Money and conflicts

There is no revenue, no sponsorship and no donations channel at present. If that changes, the maintainer will state who
pays and what they get. Promises already made — free for scientists, no selling user data, no ads, no training on user
results — are not for sale.

## Licence and forkability

Apache-2.0 means anyone may fork. Governance is therefore a matter of trust and of who does the work, not of legal
control.
