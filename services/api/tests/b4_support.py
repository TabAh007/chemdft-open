"""Shared B4 test support.

``stub_decimer`` replaces ONLY the DECIMER model boundary
(`DecimerSubprocessEngine.recognize_diagram`) with a deterministic stand-in that returns a real
`MolecularRecognitionProposal` for a chosen SMILES, validated by the real RDKit validation code. Everything else (candidate row locking,
representation persistence, reuse rules, tool registry, AI guard, run lifecycle) is the
production path.

This is a test fixture, not a scientific recognition result: it never demonstrates that DECIMER can
read a figure.
"""

from __future__ import annotations

import hashlib
import time

from chemdft_api.scientific.molecular_recognition.contracts import MolecularRecognitionProposal
from chemdft_api.scientific.molecular_recognition.engine import (
    DecimerSubprocessEngine,
    _provenance_fields,
)
from chemdft_api.scientific.molecular_recognition.validation import (
    validate_molecular_graph_proposal,
)


def stub_decimer(monkeypatch, smiles: str = "CCO", calls: list | None = None):
    calls = calls if calls is not None else []

    def fake(self, image_bytes: bytes, metadata=None) -> MolecularRecognitionProposal:
        calls.append(hashlib.sha256(image_bytes).hexdigest())
        meta = metadata or {}
        started = time.perf_counter()
        validation = validate_molecular_graph_proposal(
            raw_smiles=smiles,
            engine_diagnostics=["test stand-in for the DECIMER model"],
            category_hint="",
        )
        return MolecularRecognitionProposal(
            **_provenance_fields(meta),
            figure_sha256=hashlib.sha256(image_bytes).hexdigest(),
            recognition_engine=self.engine_name,
            engine_version=self.engine_version,
            raw_model_output=smiles,
            proposed_smiles=smiles,
            canonical_isomeric_smiles=validation.canonical_isomeric_smiles,
            formula=validation.formula,
            formal_charge=validation.formal_charge,
            heavy_atom_count=validation.heavy_atom_count,
            elements=validation.elements,
            has_stereochemistry=validation.has_stereochemistry,
            confidence=None,
            status=validation.status,
            is_scientifically_verified=False,
            validation_warnings=tuple(validation.warnings),
            diagnostics=validation.diagnostics,
            unresolved_ambiguities=validation.ambiguities,
            runtime_ms=(time.perf_counter() - started) * 1000,
        )

    monkeypatch.setattr(DecimerSubprocessEngine, "recognize_diagram", fake)
    return calls
