# Import, Paper, Export, and Publication UX

## Import pattern

1. Select/drop/upload source; show file type, size, hash state, and project target.
2. Quarantine and validate safely; progress is ingestion state, not scientific validity.
3. Preview detected format/entities/metadata, parser/version, warnings, unsupported/lost fields, and source class.
4. Resolve ambiguous sample/structure/project links and duplicates.
5. Confirm import/promotion; originals remain immutable and derived entities retain lineage.

Supported families are introduced incrementally: SDF/MOL/MOL2/XYZ/PDB, CIF/POSCAR, CUBE and supported Gaussian/ORCA/Psi4/PySCF outputs, CSV/JCAMP-DX/mzML, and vendor formats where validated.

## Paper workspace

PDF document uses a synchronized split:

- PDF pages with search, thumbnails, page/region focus.
- Extraction ledger grouped by Metadata, Experiments, Methods, Structures, Figures, Tables, and Claims.
- Inspector shows exact evidence coordinates, source class, confidence, parser/model run, linked entity, and review state.

Candidate actions: Accept, Correct, Ignore, Promote to project entity, Link to sample/structure, Open source region. Acceptance means the extraction accurately represents the paper—not that the scientific claim is universally true.

Labels are explicit:

- “Explicitly stated on page 6” → `EXTRACTED`.
- “Digitized from Figure 3” → `DIGITIZED · Approximate`.
- “AI reconstructed from image” → `AI_HYPOTHESIS · Needs review`.

Low OCR/digitization confidence, conflicting source statements, missing coordinates, malicious/unsupported content, or ambiguous units block silent promotion and expose correction paths.

## Export groups

| Group | Formats/content | Rules |
|---|---|---|
| Scientific | SDF, MOL, MOL2, XYZ, PDB, CIF, CUBE | select entity/version/coordinate source; disclose format loss; provenance sidecar/manifests |
| Visual | GLB/glTF, OBJ, STL where meaningful | scene/geometry source explicit; no scientific claim that target format cannot preserve |
| Publication | PNG, transparent PNG, SVG where technically valid | dimensions, DPI, background, legend, labels, source footer/sidecar |
| Report | methods, calculation manifest, provenance, citations, comparison summary | choose included evidence/artifacts; machine-readable manifest alongside human report |

Language commands (“Export the optimized structure as CIF”; “Create a publication figure showing the HOMO”) and UI forms call the same `export.*` actions. If CIF is inappropriate for a nonperiodic molecule, the system explains assumptions/alternatives rather than quietly fabricating a unit cell.

## Publication Studio

Future-ready presentation workspace controls camera, projection, background, atom sizing, bond thickness, labels, annotations, orbital isovalue, opacity, legend, dimensions, resolution, and figure panels. It reads immutable scientific scene/data references. Appearance settings become a versioned figure specification; they cannot alter coordinates, grids, mode vectors, values, or calculation records.

Exports include a visual preview, estimated file size, accessible title/description fields, reproducibility/provenance option enabled by default, and exact warnings. Long exports become durable jobs.

See [provenance UX](PROVENANCE_UX.md) and [export wireframe](../wireframes/CALCULATION_WIREFRAMES.md#13-export).
