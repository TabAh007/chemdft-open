# Preliminary Dependency Licensing Matrix

Checked against primary project repositories/pages on **2026-09-11**.
> **Update 2026-11-13 (release 0.0.51).** The project's own licence is decided: all first-party code and
> documentation is Apache-2.0 (see `REUSE.toml`, `LICENSE`, `NOTICE`). The root-licence paragraph in the addendum
> below ("UNDECIDED and must not be invented") is superseded. The third-party rows are unchanged and are now
> consolidated, with how each component is used and what an open release would carry, in
> [implementation/THIRD_PARTY_LICENCE_AUDIT.md](implementation/THIRD_PARTY_LICENCE_AUDIT.md). This is still
> engineering triage, not legal advice.
 This is engineering triage, not legal advice or a guarantee. Recheck exact pinned versions, transitive/bundled dependencies, model/data assets, container images, distribution method, notices, and commercial terms before adoption or release.

## Classification

- **GREEN:** permissive terms generally straightforward for commercial SaaS use, with notice/attribution obligations.
- **YELLOW:** copyleft, bundled-component, data-license, dynamic-linking, or distribution/deployment details require review.
- **RED:** commercial/proprietary terms, strong copyleft/significant compatibility concern, or explicit commercial licensing action.

SaaS operation and distribution are different legal events; containers, desktop/offline deliverables, customer HPC agents, modified libraries, and source/binary redistribution can change obligations.

## Matrix

| Dependency | Observed license/terms | Class | Preliminary action | Primary source |
|---|---|---:|---|---|
| Blueprint.js | Apache-2.0 | GREEN | retain notices | [repository license](https://github.com/palantir/blueprint/blob/develop/LICENSE) |
| Ketcher | Apache-2.0 | GREEN | retain notices; review separately if optional Indigo/service components are deployed | [repository license](https://github.com/epam/ketcher/blob/master/LICENSE) |
| 3Dmol.js | BSD-3-Clause plus incorporated component notices | GREEN | preserve full bundled notices | [repository license](https://github.com/3dmol/3Dmol.js/blob/master/LICENSE) |
| Three.js | MIT | GREEN | retain notice | [repository license](https://github.com/mrdoob/three.js/blob/dev/LICENSE) |
| Apache ECharts | Apache-2.0 | GREEN | retain notices | [repository license](https://github.com/apache/echarts/blob/master/LICENSE) |
| RDKit | BSD-3-Clause | GREEN | retain notice; review optional data/dependencies in built image | [repository license](https://github.com/rdkit/rdkit/blob/master/license.txt) |
| PySCF | Apache-2.0 | GREEN | retain notices; inventory optional backends | [repository license](https://github.com/pyscf/pyscf/blob/master/LICENSE) |
| GPU4PySCF | Apache-2.0 | GREEN | retain notices; separately comply with CUDA/NVIDIA components | [repository license](https://github.com/pyscf/gpu4pyscf/blob/master/LICENSE) |
| xTB | LGPL-3.0 | YELLOW | review linking, modifications, container/binary distribution, notices/source obligations | [repository license](https://github.com/grimme-lab/xtb/blob/main/COPYING) |
| CREST | GPL-3.0 source headers/COPYING plus LGPL/bundled components in accepted patched source | RED | 2026-10-15 correction to LGPL-only shorthand; review exact files, linking, distribution and bundled source obligations | [v3.0.2 source header](https://github.com/crest-lab/crest/blob/v3.0.2/CMakeLists.txt), current registry |
| geomeTRIC 1.1.1 | Custom BSD 3-clause Non-AI License in installed worker LICENSE; SPDX UNKNOWN | YELLOW | additional code/binary AI-training restriction; retain exact notice and review intended use/distribution; do not label ordinary BSD-3-Clause | registry and installed-license evidence |
| GSAP 3.15.0 | Custom Standard no-charge license, not MIT | YELLOW | retain/review exact installed terms; no automatic permissive-license assumption | installed package metadata, registry |
| Psi4 | LGPL-3.0 | YELLOW | review linking, modifications, binary/container distribution and bundled dependencies | [repository license](https://github.com/psi4/psi4/blob/master/COPYING) |
| libcint | Apache-2.0 | GREEN | retain notices | [repository license](https://github.com/sunqm/libcint/blob/master/LICENSE) |
| LibXC | MPL-2.0 | YELLOW | file-level copyleft review for modifications/distribution; retain notices | [repository license](https://gitlab.com/libxc/libxc/-/blob/devel/COPYING) |
| XCFun | MPL-2.0 | YELLOW | file-level copyleft review for modifications/distribution | [repository license](https://github.com/dftlibs/xcfun/blob/master/LICENSE.md) |
| DFT-D4 | LGPL-3.0 | YELLOW | review linking, modifications, and distribution | [repository license](https://github.com/dftd4/dftd4/blob/main/COPYING) |
| Basis Set Exchange software | BSD-3-Clause | GREEN | retain notice; separately verify provenance/terms of selected basis datasets and citations | [repository license](https://github.com/MolSSI-BSE/basis_set_exchange/blob/master/LICENSE) |
| QCSchema | BSD-3-Clause | GREEN | retain notice | [repository license](https://github.com/MolSSI/QCSchema/blob/master/LICENSE) |
| QCElemental | BSD-3-Clause | GREEN | retain notice | [repository license](https://github.com/MolSSI/QCElemental/blob/master/LICENSE) |
| QCEngine | BSD-3-Clause | GREEN | retain notice; every invoked engine has independent terms | [repository license](https://github.com/MolSSI/QCEngine/blob/master/LICENSE) |
| QCFractal/QCArchive | BSD-3-Clause | GREEN | retain notice; review separately deployed dependencies | [repository license](https://github.com/MolSSI/QCFractal/blob/main/LICENSE) |
| cclib | BSD-3-Clause | GREEN | retain notice; parsing support does not grant rights to proprietary engines/files | [repository license](https://github.com/cclib/cclib/blob/master/LICENSE) |
| nmrglue | BSD-3-Clause | GREEN | retain notice; vendor input formats may have separate constraints | [repository license](https://github.com/jjhelmus/nmrglue/blob/master/LICENSE.txt) |
| pyOpenMS / OpenMS | BSD-3-Clause core | YELLOW | compiled distribution must inventory third-party/bundled licenses and notices | [OpenMS repository license](https://github.com/OpenMS/OpenMS/blob/develop/LICENSE) |
| pymatgen | MIT | GREEN | retain notice; separately review bundled/reference data | [repository license](https://github.com/materialsproject/pymatgen/blob/main/LICENSE) |
| pyFAI | MIT/X11 core with files/components under other terms including GPL packaging files | YELLOW | generate per-version file/dependency inventory; exclude non-runtime packaging where appropriate | [repository copyright/license inventory](https://github.com/silx-kit/pyFAI/blob/main/copyright) |
| ASE | LGPL-2.1-or-later | YELLOW | review modifications, linking, binary/container distribution, and calculator plugins | [repository license](https://gitlab.com/ase/ase/-/blob/master/LICENSE) |
| GPAW | GPL-3.0-or-later | RED | significant distribution/derivative-work review before optional integration | [repository license](https://gitlab.com/gpaw/gpaw/-/blob/master/LICENSE) |
| GradDFT | Apache-2.0 | GREEN | retain notices; separately review pretrained weights/datasets if used | [repository license](https://github.com/XanaduAI/GradDFT/blob/main/LICENSE) |
| ORCA | free for academic/personal use; commercial licenses available | RED | do not deploy commercially or redistribute until written commercial terms and technical model are approved | [official ORCA page](https://www.faccts.de/orca/) |

## Required follow-up gates

1. Legal review of LGPL/MPL/GPL use, especially shipped containers, customer-side/HPC agents, modifications, linking, and source/notice delivery.
2. Written ORCA commercial license and service/redistribution interpretation before any production adapter is enabled.
3. Automated SBOM and license-notice generation from exact lockfiles/images in the phase that introduces dependencies.
4. Per-version audit of GPU/CUDA images, OpenMS/pyOpenMS, pyFAI, Psi4, RDKit, and other bundled native dependencies.
5. Dataset/weights/vendor-format review for Basis Set Exchange content, pymatgen/reference data, GradDFT models, and instrument formats.
6. Recheck license URLs and upstream terms at every major upgrade; repository metadata alone is not legal approval.

## Addendum — 2026-10-15 candidate models and root license (engineering triage only)

Public repository/model-card metadata was read on 2026-10-15 without downloading weights or installing
anything. **Nothing below is a legal approval**; weights, training data and per-file terms are not reviewed.
Status DEFERRED means no integration in the current phase; classification is provisional.

| Candidate (all DEFERRED, not installed) | License evidence read | Class | Open review |
| --- | --- | --- | --- |
| IBM MoLFormer | model card `apache-2.0`; repository Apache-2.0 | YELLOW (provisional) | training-data terms; possible custom/remote model code |
| MACE-MP / MACE | code MIT (`LICENSE.md`); `mace-foundations` repository MIT; individual releases may ship their own `LICENSE.md` | YELLOW | **per-release weight terms NOT VERIFIED**; PyTorch stack |
| Microsoft MatterGen | model card `mit`; repository MIT | YELLOW (provisional) | training-data/weights terms; large checkpoints |
| AllenAI SPECTER2 | base model card `apache-2.0`; repository Apache-2.0 | YELLOW (provisional) | adapter repositories show no license field (**NOT VERIFIED**) |
| BAAI BGE-M3 | model card `mit`; FlagEmbedding repository MIT | YELLOW (provisional) | training-data terms; footprint |
| Hugging Face compute (Spaces/Jobs) | service terms UNKNOWN | RED until reviewed | privacy, retention, engine/model license compatibility |

**ChemDFT's own root license:** no `LICENSE`/`COPYING` file and no `CITATION.cff` exist at the repository root;
the project license and public author/release metadata are **UNDECIDED and must not be invented**. This blocks
any public distribution claim and the planned citation file. CREST remains RED (GPL source headers plus bundled
LGPL components in the accepted patched source); geomeTRIC carries a non-AI-training restriction; per-file and
container redistribution review is still required for every scientific binary shipped in an image.
