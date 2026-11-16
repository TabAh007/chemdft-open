#!/usr/bin/env python3
"""Saved SYNTHETIC recognition proposal for the guarded B4 browser stack. No inference.

Reuse production B3 fixture safety checks, then attach the current figure/engine identity to
exercise real B4's idempotent saved-proposal path. The warnings retain the synthetic provenance.
"""
import contextlib
import hashlib
import io
import json

from create_b3_e2e_fixture import main as seed_b3


def main():
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        seed_b3()  # validates disposable test storage before writing anything
    fixture = json.loads(output.getvalue())
    from chemdft_api.database import SessionLocal
    from chemdft_api.scientific_models import CandidateRepresentationRecord, StructureCandidateRecord
    from chemdft_api.scientific.molecular_recognition.engine import DecimerSubprocessEngine
    from fastapi.testclient import TestClient
    from chemdft_api.main import app
    with SessionLocal() as session, TestClient(app) as client:
        candidate = session.get(StructureCandidateRecord, fixture['candidate_id'])
        proposal = session.get(CandidateRepresentationRecord, fixture['original_id'])
        figure = client.get(f"/v1/projects/{candidate.project_id}/structure-candidates/{candidate.id}/figure")
        figure.raise_for_status()
        engine = DecimerSubprocessEngine
        payload = {**proposal.payload_json,
            'recognition_engine': engine.engine_name, 'engine_version': engine.engine_version,
            'figure_sha256': hashlib.sha256(figure.content).hexdigest(),
            'source_document_id': candidate.source_document_id,
            'diagnostics': ['SYNTHETIC SAVED PROPOSAL — NO DECIMER INFERENCE']}
        # Representation history is immutable, including in this test fixture.
        common = dict(project_id=candidate.project_id, candidate_id=candidate.id,
                      representation_origin='IMAGE_RECONSTRUCTION', provenance_class=proposal.provenance_class,
                      method=engine.engine_name, method_version=engine.engine_version,
                      approximation='UNVERIFIED_PROPOSAL', validation_state='PARSEABLE', created_by=proposal.created_by)
        saved = CandidateRepresentationRecord(**common, revision=4, representation_type='SMILES', payload_json=payload)
        session.add(saved)
        session.flush()
        drawing = CandidateRepresentationRecord(**common, revision=5, representation_type='MOL_BLOCK',
                      source_representation_id=saved.id, payload_json={'mol_block': fixture['mol_block']})
        session.add(drawing)
        session.commit()
        fixture['original_id'] = saved.id
        fixture['drawing_id'] = drawing.id
        fixture['document_id'] = candidate.source_document_id
    print(json.dumps(fixture))


if __name__ == '__main__':
    main()
