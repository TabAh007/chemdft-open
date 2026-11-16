# Homepage reference crystal: α-Cr₂O₃ (eskolaite)

| | |
|---|---|
| Database | Crystallography Open Database (COD), entry **9014036** — https://www.crystallography.net/cod/9014036.html |
| Upstream | American Mineralogist Crystal Structure Database, AMCSD **0017803** |
| Publication | H. Sawada, "Residual electron density study of chromium sesquioxide by crystal structure and scattering factor refinement", *Materials Research Bulletin* **29**, 239–245 (1994), doi:10.1016/0025-5408(94)90019-1 |
| Reuse basis | COD data are dedicated to the public domain (CC0). The CIF header additionally asks that the original journal article be attributed, which the homepage does (COD id and Sawada citation beside the viewer). |
| Phase / symmetry | Cr₂O₃, mineral name Eskolaite, synthetic; R-3c (No. 167), hexagonal axes, Z = 6 |
| Cell (from the CIF) | a = b = 4.9570 Å, c = 13.5923 Å, α = β = 90°, γ = 120°, V = 289.242 Å³ |
| Atoms in the CIF | Cr (0, 0, 0.34749), O (0.30570, 0, 0.25000); the 30 sites of the conventional cell follow from the CIF's 36 symmetry operators |

Files: `cod-9014036-cr2o3.cif` (unmodified COD file, 2.9 KB), `cr2o3-reference.json` (generated: lattice, the 30 fractional sites and the validation record).
Regenerate and re-validate with `uv run --project services/api python tools/homepage_reference_structure.py`; the checks are enforced by
`services/api/tests/test_homepage_reference_structure.py` (ChemDFT's pymatgen CIF path) and `apps/web/tests/crystal-reference.test.ts`
(independent re-derivation from the CIF's symmetry operators).

## Relation to the Aliyeva α-Cr₂O₃ study

The research study that motivates this use case reports a ≈ b ≈ 4.958 Å, c ≈ 13.593 Å, α = β = 90°, γ = 120°, but does not give enough
atomic-coordinate information to reconstruct that sample's refined structure. This reference is therefore **independently sourced and
deliberately not combined with those lattice parameters**: the viewer shows COD 9014036 exactly as published (a = 4.9570 Å,
c = 13.5923 Å). It is labelled as a reference structure and is not presented as the structure of any ChemDFT sample or study. The full
worked example belongs to a later phase (PF-5).

## Reference molecules (`molecules.json`)

The homepage structure selector also offers three isolated molecules. They are **reference structures for illustration**, never ChemDFT
calculation results.

| | Source | Reuse basis |
|---|---|---|
| Water, H₂O | ChemDFT's own test geometry `services/api/tests/fixtures/structures/test-user-supplied-water.xyz` (O–H 0.9572 Å, H–O–H 104.52°), the geometry behind the real PySCF water calculation the homepage shows | Part of this repository |
| Benzene, C₆H₆ | PubChem CID 241, 3D conformer (`molecules/pubchem-cid-241-benzene.sdf`, unmodified) | NCBI places no restrictions on use of PubChem data; third-party submitters may claim rights in submitted content (https://www.ncbi.nlm.nih.gov/home/about/policies/); the conformer is computed by PubChem; NLM acknowledged |
| Caffeine, C₈H₁₀N₄O₂ | PubChem CID 2519, 3D conformer (`molecules/pubchem-cid-2519-caffeine.sdf`, unmodified) | as above |

No repository fixture existed for benzene or caffeine, so the PubChem records were downloaded once from PUG REST
(`compound/cid/<cid>/SDF?record_type=3d`) and committed; **the page never calls PubChem at runtime**.

Validation (`uv run --project services/api python tools/homepage_reference_molecules.py`, guarded by
`services/api/tests/test_homepage_reference_molecules.py` and `apps/web/tests/homepage-structures.test.ts`): each source parses
through ChemDFT's own RDKit structure adapter (`parse_sdf` / `parse_xyz`), is sanitised by RDKit, matches the expected formula and InChIKey,
every bond length is within 0.30 Å of the sum of covalent radii, there are no atomic clashes, benzene's carbon ring is planar (RMS 0.00005 Å)
with six aromatic bonds, and caffeine's heavy atoms are coplanar (RMS 0.0005 Å). Connectivity comes from the SDF bond table; the water XYZ
has none, so the renderer infers display-only bonds from distances.
