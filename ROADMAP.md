# Roadmap

Derived only from `docs/14_ROADMAP.md` and `NEXT.md`. **No dates are promised.** Items marked verified were verified as
described; everything else is planned or unverified.

## Available today on the hosted beta

- Molecular DFT with PySCF 2.14.0: single point, optimisation (needs geomeTRIC installed as an extra), frequencies,
  thermochemistry, TDDFT, Raman, orbitals, cubes.
- Semi-empirical and conformer work with xTB and CREST.
- Periodic DFT with Quantum ESPRESSO 7.6 and periodic PySCF, with documented limits.
- Structures, imports (CIF, XYZ, SDF, MOL), the Result Firewall, exports and citations.
- English only. Turkish, Russian and German are marked "Coming soon".

## Not available, planned for a future build

- **Psi4** — not available. Kept for a future build; its LGPL terms are under review.
- **DFT-D4** — not available. Kept for a future build.
- **GPU4PySCF** — not available. No GPU path exists on the hosted worker.

## Next, in rough order

1. Publish the source repository (blocked on the owner's decisions; see `docs/implementation/PUBLICATION_READINESS.md`).
2. A dedicated support and donation channel, so the hosted service can be paid for without selling anything.
3. Localisation after English is settled; mobile layout last.
4. A co-maintainer.

## Open problems, stated plainly

- Two-account isolation is verified offline, not live.
- AI-planned proposals are not verified on the hosted platform.
- Live sign-up with a new Google account is not verified.
- The legal reading of the licence structure (CREST's GPL scope, the SSSP terms, whether the hosted image conveys GPL
  binaries) has not been done.
- No local Quantum ESPRESSO recipe exists, and the self-hosting Postgres path is untested.
