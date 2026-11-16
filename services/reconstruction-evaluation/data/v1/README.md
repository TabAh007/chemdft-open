# ChemDFT synthetic structure-image evaluation set v1

Dataset license: CC0-1.0 (<https://creativecommons.org/publicdomain/zero/1.0/>).
The manifest repeats the license and provenance for every individual image.

All 69 images are generated locally from hand-authored SMILES or deterministic
Pillow schematics. No journal, patent, or third-party scientific-paper images
are included. Each manifest row records its image SHA-256, CC0-1.0 license,
provenance, generation recipe, category, and ground truth where a single
molecular graph is meaningful.

The clean molecular depictions are rendered by RDKit. Augmentations are
deterministic and named in each row. Out-of-domain schematics include
coordination complexes, repeat units, reaction schemes, crystal/material
diagrams, plots with embedded structures, multiple molecules, occlusion,
hand-drawn-like diagrams, and abbreviations. These are intentionally not
assigned a single-molecule ground truth; expected routing is manual review or
abstention.

Regenerate from `services/reconstruction-evaluation/src/chemdft_reconstruction/dataset.py`.
