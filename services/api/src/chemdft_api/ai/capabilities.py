"""Authoritative capabilities and boundaries for the ChemDFT AI Scientist.

Generated from the real product tool tables and planning profiles:
- ENERGY_TOOLS (planning_profiles.py)
- AI_READ_TOOLS, AI_WRITE_TOOLS, AI_BOUNDED_WRITE_TOOLS (tool_policy.py)
- Structure measurements (structure_measure.py)
- Cited evidence grounding path
"""

from __future__ import annotations

from .planning_profiles import ENERGY_TOOLS, PERIODIC_ENERGY_TOOLS, STRUCTURE_EDIT_TOOLS
from .tool_policy import AI_BOUNDED_WRITE_TOOLS, AI_PLANNING_WRITE_TOOLS, AI_WRITE_TOOLS

# Authoritative verification against runtime tool registrations
assert "calculation.submit" in ENERGY_TOOLS
assert "calculation.submit" in PERIODIC_ENERGY_TOOLS
assert "structure.edit.propose" in STRUCTURE_EDIT_TOOLS
assert "structure.edit.propose" in (AI_WRITE_TOOLS | AI_PLANNING_WRITE_TOOLS)
assert "molecule.draft.create" in AI_BOUNDED_WRITE_TOOLS
assert "document.figures.extract" in AI_BOUNDED_WRITE_TOOLS

# Human-readable capabilities statement generated from authoritative tool constants
CAN_CAPABILITIES = (
    "answer questions about project records with citations",
    (
        "report the computed structure measurements "
        "(dimensions, angles, volume, distances, coordination)"
    ),
    (
        "prepare a molecular PySCF single-point energy proposal for approval "
        "(supported molecular methods: Hartree-Fock (HF), DFT (B3LYP, PBE); "
        "molecules only, saved version, editable project)"
    ),
    (
        "prepare a periodic calculation proposal for approval "
        "(supported periodic engines: Quantum ESPRESSO, PySCF periodic; "
        "crystals only, saved version, editable project)"
    ),
    (
        "propose structure edits for approval "
        "(add, remove, move atom, replace element; creates a new unverified version, "
        "parent remains immutable)"
    ),
    "general planner: find/draft structures and extract document figures",
)

CANNOT_CAPABILITIES = (
    "modify committed structure versions directly (committed versions are immutable; "
    "edits create a new version)",
    "run anything or submit calculations without approval (user approves, engines compute)",
    "invent Hubbard U values, k-meshes, cutoffs, or magnetic ordering "
    "(must be specified or copied from a previous succeeded calculation)",
    "anything outside this project/app",
)

AI_CAPABILITIES_SUMMARY = (
    "CAN:\n"
    + "\n".join(f"- {c}" for c in CAN_CAPABILITIES)
    + "\n\nCANNOT:\n"
    + "\n".join(f"- {c}" for c in CANNOT_CAPABILITIES)
)

AI_CAPABILITIES_POLICY = f"""\
SYSTEM CAPABILITIES AND BOUNDARIES:
{AI_CAPABILITIES_SUMMARY}

RULES ON CAPABILITIES AND REFUSALS:
- Users may ask anything. If the app can do it, say so and say how.
- If the AI cannot do it, say plainly "I can't do that here" and name the app feature that can:
  * To edit or add atoms: the structure editor.
  * To configure or run calculations (including periodic calculations): the Calculation panel.
  * To inspect or measure distances interactively: the Distance/Measure tool in the 3D viewer.
- Never promise future abilities.
- Answer the user's question first.
- Do NOT repeat the project summary (e.g. structure/calculation/document counts) unless asked.
- Do NOT include a capabilities list unless the user explicitly asks what you can do
  or you are refusing a request you cannot fulfill.
- Keep replies short and concise.
"""
