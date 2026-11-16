# ruff: noqa: E501, RUF001
"""Workflow / how-to intent classifier and the static "app guide" for CHAT replies (release 0.0.24).

A how-to or action-intent message ("i want to import molecule", "how do I start a calculation") is
not a question about a paper, so it must not be forced through document search. This module gives:

* ``is_workflow_howto_request``: a deterministic classifier (no model call);
* ``APP_GUIDE_FACTS``: a small, versioned fact block listing ONLY what the app has today, put in
  front of the model for such messages so it can point at real places with plain steps.

Ask stays read-only: the guide only explains where to click. It never starts an import or a job.
"""

from __future__ import annotations

import re

from .structure_inspection import (
    is_calculation_inspection_request,
    is_current_view_request,
    is_ir_request,
    is_next_steps_request,
    is_raman_request,
    is_structure_inspection_request,
    is_tddft_request,
)
from .thermochemistry_inspection import is_thermochemistry_request

APP_GUIDE_VERSION = "CHEMDFT_APP_GUIDE_V1"

# Formats the structure import accepts today (StructureSourceFormat in scientific/structures.py;
# the Navigator text "Import SDF, MOL, XYZ or CIF"). A test pins this against the real enum.
APP_GUIDE_IMPORT_FORMATS = ("SDF", "MOL", "XYZ", "CIF")

APP_GUIDE_FACTS = f"""\
[APP GUIDE {APP_GUIDE_VERSION}: static facts about ChemDFT as it is today. Use ONLY these places and steps.]
- The project workspace has two modes: Guided and Advanced Workbench.
- To add or import a molecule:
  - On the 3D Structure viewer page, there is no direct file import control. The 3D view controls are:
    view styling (Ball and Stick, Space-filling, Wireframe), Reset view, atom measurements, and calculation setup.
  - To import a structure file ({", ".join(APP_GUIDE_IMPORT_FORMATS)}), the real path is to return to Guided Home (Overview)
    where "Import structure file" and "Draw molecule" are available, or switch to Advanced Workbench and use
    "Import structure file" in the Workspace / Files & Data area or toolbar.
  Crystal (CIF): the researcher sets up periodic DFT in the Calculation panel; the AI does not plan it. Engines: PySCF periodic (Gaussian basis, single-point PBE/PBE+U) and Quantum ESPRESSO (plane waves, SSSP PBE Efficiency library, fixed cutoffs and pseudopotentials): single point, atom relaxation with the cell fixed, DOS and projected DOS, band structure along a high-symmetry path, Lowdin local spin moments. Collinear magnetism, PBE and PBE+U, at most 20 atoms; hosted PySCF periodic is Gamma only (about 17 minutes for 10 atoms), k-meshes up to 4x4x4 are Quantum ESPRESSO only. NOT offered: cell relaxation, stress or pressure, phonons, hybrid functionals, noncollinear or spin-orbit, molecular dynamics. Antiferromagnetic solutions are local minima that depend on U and on the pseudopotentials. Gaps come from eigenvalues, never from a DOS curve; the band gap is the gap along the chosen path only.
  Periodic wording: default U values are Materials Project starting values for oxides, calibrated for formation energies with PAW potentials, not fitted to this basis or to band gaps; the user should test the sensitivity by changing U. The periodic gap is a Kohn-Sham gap from the converged SCF at the k-points used, not an optical gap. Per-atom values are called "local spin population (Mulliken-type)": a basis-dependent projection of the spin density onto atoms, not directly comparable with an experimental magnetisation or neutron moment.
- Project sections, in this order: Overview, Workspace (molecules, structure versions, calculation
  setup, viewers), Results, Compare, Jobs, Claims (claims from imported papers), Paper vs ChemDFT,
  Settings.
- A calculation needs a saved structure version. In the Workspace, open Calculation setup, review
  the settings, then approve the job; nothing runs without the researcher's explicit approval.
  Jobs shows the queue and the status of compute jobs. Finished calculations appear in Results.
- The AI box can answer questions here (Ask, read-only). When a message looks like a calculation
  request, a "Plan this as a calculation" choice appears under the input; the researcher chooses
  it, and the proposal still needs explicit approval before anything runs.
- Rules for you: explain WHERE to click, in short plain steps, naming only the buttons and sections
  listed above and relevant to the current page. Never claim a button exists on the current page if
  it does not (e.g. "Import structure file" is on Guided Home or Advanced Workbench, not on the 3D
  Structure view). Do not claim you started, imported, created or changed anything: you cannot. If
  something is not listed here, say plainly that you do not know of such a feature or that it is not
  available. Do not state any scientific value, citation or result in this kind of reply.
[END APP GUIDE]
"""

_OBJECTS = (
    r"(?:molecule|molecules|structure|structures|compound|compounds|file|files|dataset|datasets|"
    r"coordinates|xyz|sdf|cif|mol file|geometry|geometries)"
)
_ACTION = r"(?:import|upload|draw|build|add|load|open|create|insert|bring in|put in)"

_WORKFLOW_PATTERNS = (
    # "i want to import molecule", "import a molecule", "can i upload a file", "draw a molecule"
    re.compile(rf"\b{_ACTION}\b[\w\s,'\-]{{0,30}}\b{_OBJECTS}\b"),
    re.compile(r"\bhow (do|can|should|would) (i|we)\b"),
    re.compile(r"\bhow to\b"),
    re.compile(r"\bwhere (do|can|should|is|are) (i|we|the|a)\b"),
    re.compile(r"\bwhere to\b"),
    re.compile(r"\bwhat (does|do) (the |this |that )?[\w&\- ]{1,30}(button|tab|menu|section|page|mode|panel)\b[\w\s]{0,10}\b(do|mean|for)\b"),
    re.compile(r"\b(what|which) (is|are) (the )?(guided|advanced workbench|workbench|navigator)\b"),
    re.compile(r"\b(start|set up|setup|run|submit|create|launch) (a |an |my |the )?(new )?(calculation|job|simulation)\b"),
    re.compile(r"\bwhat can i do\b|\bwhat can i do here\b|\bwhere (do i|should i) (start|begin)\b|\bgetting started\b|\bget started\b"),
    re.compile(r"\b(navigate|find the|go to|open the) (jobs|results|compare|claims|settings|workspace|overview)\b"),
    # Russian / Azerbaijani (cheap, conservative)
    re.compile(r"(импортир|загрузить|загрузи|добавить|нарисов)[\w\s]{0,20}(молекул|структур|файл)"),
    re.compile(r"\bкак (мне |можно |я )?(импортировать|загрузить|добавить|нарисовать|запустить)\b"),
    re.compile(r"\b(molekul|struktur|fayl)\w*\s+(idxal|yüklə|əlavə)|\bnecə (idxal|yüklə|əlavə|çək|başla)\w*"),
)

# Anything that asks for a value, a citation, a result, an authority or a verification, or that
# points at the paper, stays on the cited / evidence path. This is deliberately broad.
_EVIDENCE_GUARD_TERMS = (
    "paper", "document", "article", "pdf", "reported", "according to", "the text", "page ",
    "figure", "table", "doi", "citation", "cite", "source", "quote",
    "value", "energy", "number", "result", "authority", "verified", "verification", "validated",
    "homo", "lumo", "gap", "frequency", "frequencies", "spectrum", "spectra", "dipole", "charge of",
    "bond length", "angle", "claim", "says", "mention", "what does the", "selected",
)


def is_workflow_howto_request(question: str) -> bool:
    """True for a workflow / how-to / action-intent message that is not a science question."""
    text = question.casefold().strip()
    if not text:
        return False
    if any(term in text for term in _EVIDENCE_GUARD_TERMS) and not re.search(
        r"\bwhat (does|do) (the |this |that )?[\w&\- ]{1,30}(button|tab|menu|section|page|mode|panel)\b", text
    ):
        return False
    if (
        is_structure_inspection_request(question)
        or is_current_view_request(question)
        or is_next_steps_request(question)
        or is_calculation_inspection_request(question)
        or is_thermochemistry_request(question)
        or is_ir_request(question)
        or is_raman_request(question)
        or is_tddft_request(question)
    ):
        return False
    return any(p.search(text) for p in _WORKFLOW_PATTERNS)
