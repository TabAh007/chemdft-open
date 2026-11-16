# ruff: noqa: E501
"""Independent scientific checks of the five flagship AI-created drafts.

The identity table below is written from chemistry, not read back from the implementation.
"""

from __future__ import annotations

import pytest
from chemdft_api.contracts.geometry import GeometryCandidateManifest
from chemdft_api.geometry_eligibility import CANDIDATE_FORMAT
from chemdft_api.scientific_models import ProvenanceRecordRow, ScientificArtifactRecord
from rdkit import Chem
from rdkit.Chem import rdDetermineBonds
from rdkit.Chem.rdMolDescriptors import CalcMolFormula
from sqlalchemy import select
from test_ai_execution_durability import (
    Env,
    ScriptedGateway,
    _draft_call,
    _final_response,
    _tool_response,
)

# name -> (independently written SMILES, Hill formula, total atoms with H, heavy atoms)
FIVE = {
    "methane": ("C", "CH4", 5, 1),
    "ethane": ("CC", "C2H6", 8, 2),
    "benzene": ("c1ccccc1", "C6H6", 12, 6),
    "ethanol": ("CCO", "C2H6O", 9, 3),
    "acetone": ("CC(C)=O", "C3H6O", 10, 4),
}
BOND_RANGES = {  # Angstrom, generous but chemically meaningful bounds for single/double/aromatic
    frozenset({"C", "H"}): (0.95, 1.20),
    frozenset({"O", "H"}): (0.85, 1.10),
    frozenset({"C"}): (1.18, 1.56),
    frozenset({"C", "O"}): (1.15, 1.48),
}


def _skeleton(mol: Chem.Mol) -> Chem.Mol:
    rw = Chem.RWMol(mol)
    for bond in rw.GetBonds():
        bond.SetBondType(Chem.BondType.SINGLE)
        bond.SetIsAromatic(False)
    for atom in rw.GetAtoms():
        atom.SetIsAromatic(False)
        atom.SetNoImplicit(True)
        atom.SetNumExplicitHs(0)
    return rw.GetMol()


@pytest.fixture
def created(api):
    env = Env(api)
    run_id = env.make_run(prompt="Create methane, ethane, benzene, ethanol and acetone.")
    calls = tuple(_draft_call(name, smiles) for name, (smiles, *_rest) in FIVE.items())
    env.execute(run_id, ScriptedGateway([_tool_response(*calls), _final_response()]))
    return env, run_id


def test_five_flagship_drafts_are_scientifically_correct(created):
    env, run_id = created
    assert env.run_row(run_id).status == "SUCCEEDED"
    with env.sessions() as session:
        artifacts = session.scalars(
            select(ScientificArtifactRecord).where(
                ScientificArtifactRecord.project_id == env.project_id,
                ScientificArtifactRecord.format_identifier == CANDIDATE_FORMAT,
            )
        ).all()
        assert len(artifacts) == 5 and len({a.id for a in artifacts}) == 5
        seen_graphs = set()
        for artifact in artifacts:
            manifest = GeometryCandidateManifest.model_validate_json(
                env.store.get_bytes(artifact.storage_key, 10_000_000)
            )
            name = next(n for n, v in FIVE.items() if v[1] == manifest.formula)
            smiles, formula, total_atoms, heavy = FIVE[name]
            expected = Chem.MolFromSmiles(smiles)
            # identity: independent canonical graph + formula
            assert manifest.canonical_smiles == Chem.MolToSmiles(expected)
            assert manifest.formula == formula == CalcMolFormula(expected)
            seen_graphs.add(manifest.canonical_smiles)
            # classification: generated, never optimized / experimental
            assert manifest.geometry_class == "GENERATED_CONFORMER_NOT_OPTIMIZED"
            assert manifest.parent_structure_version is None
            assert manifest.generation_parameters["force_field_relaxation"] is False
            assert manifest.generation_method.startswith("RDKit") or "ETKDG" in str(
                manifest.generation_parameters["algorithm"]
            )
            atoms = manifest.coordinate_representation.coordinates.atoms
            assert len(atoms) == total_atoms == manifest.source_atom_count + manifest.explicit_hydrogen_count
            assert manifest.coordinate_representation.overall_charge == 0
            assert manifest.coordinate_representation.multiplicity == 1
            # a real 3D structure: not planar-collapsed, no overlapping atoms
            coords = [(a.x, a.y, a.z) for a in atoms]
            if total_atoms > 3 and name not in {"benzene"}:
                assert max(abs(c[2]) for c in coords) > 0.05
            for i, a in enumerate(coords):
                for j in range(i + 1, len(coords)):
                    dist = sum((p - q) ** 2 for p, q in zip(a, coords[j], strict=True)) ** 0.5
                    assert dist > 0.7, (name, i, j, dist)
            # 3D connectivity perceived from the coordinates equals the named molecule's graph
            xyz = f"{len(atoms)}\n\n" + "\n".join(
                f"{a.element} {a.x:.6f} {a.y:.6f} {a.z:.6f}" for a in atoms
            )
            geometry = Chem.MolFromXYZBlock(xyz)
            rdDetermineBonds.DetermineConnectivity(geometry)
            reference = _skeleton(Chem.AddHs(expected))
            assert geometry.GetNumBonds() == reference.GetNumBonds()
            assert geometry.HasSubstructMatch(_skeleton(geometry)) and _skeleton(geometry).HasSubstructMatch(reference)
            for bond in geometry.GetBonds():
                a, b = bond.GetBeginAtom().GetSymbol(), bond.GetEndAtom().GetSymbol()
                low, high = BOND_RANGES[frozenset({a, b})]
                p, q = geometry.GetConformer().GetAtomPosition(bond.GetBeginAtomIdx()), geometry.GetConformer().GetAtomPosition(bond.GetEndAtomIdx())
                assert low <= p.Distance(q) <= high, (name, a, b, p.Distance(q))
            # 2D depiction is a real, flat MOL block of the same graph
            drawing = session.get(ScientificArtifactRecord, str(manifest.source_drawing.artifact_id))
            block = env.store.get_bytes(drawing.storage_key, 1_000_000).decode()
            flat = Chem.MolFromMolBlock(block)
            assert Chem.MolToSmiles(flat) == Chem.MolToSmiles(expected)
            assert all(abs(flat.GetConformer().GetAtomPosition(i).z) < 1e-6 for i in range(flat.GetNumAtoms()))
            # provenance: AI hypothesis, unverified, software producer, no fabricated source
            prov = session.scalars(
                select(ProvenanceRecordRow).where(ProvenanceRecordRow.subject_id == artifact.id)
            ).one()
            assert (prov.source_class, prov.verification_state, prov.producer_kind) == (
                "AI_HYPOTHESIS", "UNVERIFIED", "SOFTWARE",
            )
            assert prov.producer_identifier == "chemdft.ai.molecule_creator"
            assert all(p["key"] != "doi" for p in prov.parameters_json)
        assert len(seen_graphs) == 5


def test_drafts_never_become_accepted_structures(created):
    env, _run = created
    from chemdft_api.scientific_models import StructureVersionRecord

    with env.sessions() as session:
        assert session.scalars(select(StructureVersionRecord)).all() == []


@pytest.mark.parametrize(
    "query, resolved, source",
    [
        ("Methane", True, "REVIEWED_CATALOGUE"),
        ("CCO", True, "EXPLICIT_SMILES"),
        ("xylene", False, None),
        ("butanol", False, None),
        ("2-butanol", False, None),
        ("C[C@H](O)CC", True, "EXPLICIT_SMILES"),
        ("CC(O)CC", False, None),  # unspecified stereocentre -> clarification, not a guess
        ("CO", False, None),  # carbon monoxide vs methanol SMILES
        ("C2H6O", False, None),  # a formula does not determine connectivity
        ("some invented compound", False, None),
    ],
)
def test_ambiguity_is_never_resolved_by_guessing(query, resolved, source):
    from chemdft_api.scientific.molecule_identity import resolve_molecule_identity

    result = resolve_molecule_identity(query)
    assert result.resolved is resolved
    if resolved:
        assert result.identity.identity_source == source
    else:
        assert result.clarification_required


def test_pubchem_cannot_be_enabled_by_model_arguments(api):
    env = Env(api)
    from uuid import UUID, uuid4

    from chemdft_api.tool_registry.catalog import build_application_tool_registry
    from chemdft_api.tool_registry.registry import ToolInvocationContext

    with env.sessions() as session:
        registry = build_application_tool_registry(session, env.store, env.settings)
        ctx = ToolInvocationContext(
            request_id=uuid4(), identity=env.identity, project_id=UUID(env.project_id),
            capabilities=frozenset({"project.read"}), approval_references=frozenset(), transport="test",
        )
        out = registry.invoke(
            "molecule.resolve", {"name": "aspirin", "allow_pubchem": True}, ctx
        )
    assert out.resolved is False and out.identity_source is None


def test_ai_drafts_are_listed_viewable_and_acceptable_only_by_a_researcher(created):
    """Regression: AI drafts used to be invisible to the candidate list and failed verification."""
    env, run_id = created
    client = env.client
    listing = client.get(f"/v1/projects/{env.project_id}/geometry-candidates")
    assert listing.status_code == 200, listing.text
    candidates = listing.json()["candidates"]
    assert len(candidates) == 5
    assert {c["state"] for c in candidates} == {"PENDING_ACCEPTANCE"}
    assert {c["manifest"]["geometry_class"] for c in candidates} == {
        "GENERATED_CONFORMER_NOT_OPTIMIZED"
    }
    detail = client.get(f"/v1/projects/{env.project_id}/geometry-candidates/{candidates[0]['id']}")
    assert detail.status_code == 200
    drawing = client.get(
        f"/v1/projects/{env.project_id}/geometry-candidates/{candidates[0]['id']}/drawing"
    )
    assert drawing.status_code == 200 and b"V2000" in drawing.content
    # Nothing was accepted by the AI run; a human accept records the AI origin.
    first = candidates[0]
    accepted = client.post(
        f"/v1/projects/{env.project_id}/geometry-candidates/{first['id']}/accept",
        json={
            "candidate_sha256": first["candidate_artifact"]["sha256"],
            "inspected_geometry": True,
            "understands_not_optimized": True,
        },
    )
    assert accepted.status_code in (200, 201), accepted.text
    with env.sessions() as session:
        rows = session.scalars(
            select(ProvenanceRecordRow).where(ProvenanceRecordRow.operation == "chemdft.geometry.accept")
        ).all()
        assert len(rows) == 1
        params = {p["key"]: p["value"] for p in rows[0].parameters_json}
        assert params["candidate_origin"] == "AI_HYPOTHESIS"
        assert params["geometry_class"] == "GENERATED_CONFORMER_NOT_OPTIMIZED"


def test_every_clarification_alternative_is_resolvable_so_the_answer_cannot_loop():
    from chemdft_api.scientific.molecule_identity import (
        _KNOWN_AMBIGUITIES,
        resolve_molecule_identity,
    )

    for key, ambiguity in _KNOWN_AMBIGUITIES.items():
        for alternative in ambiguity["alternatives"]:
            result = resolve_molecule_identity(alternative["name"])
            if result.resolved:
                assert result.identity.formula == alternative["formula"], alternative
                assert result.identity.canonical_isomeric_smiles == Chem.MolToSmiles(
                    Chem.MolFromSmiles(alternative["smiles"])
                )
            else:
                # Only a further stereochemistry question (2-butanol -> R/S) may follow, never a dead end.
                assert result.clarification_required and result.alternatives, (key, alternative)
    assert resolve_molecule_identity("para-xylene").identity.name == "p-xylene"
