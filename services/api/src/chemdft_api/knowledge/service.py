from __future__ import annotations

import re
from collections.abc import Callable
from uuid import UUID

from sqlalchemy import case, or_, select
from sqlalchemy.orm import Session

from ..actions import authorize_project_access
from ..calculation_actions import get_calculation
from ..context import Identity
from ..contracts.knowledge import (
    KnowledgeIndexStatus,
    KnowledgeItemView,
    KnowledgeRetrievalResult,
    KnowledgeSearchInput,
    KnowledgeSearchOutput,
    ProjectMemoryCreateInput,
    ProjectMemoryListOutput,
    ProjectMemoryView,
)
from ..errors import ScientificReferenceNotFound
from ..knowledge_models import (
    KnowledgeChunkRecord,
    KnowledgeEmbeddingRecord,
    KnowledgeIndexJobRecord,
    KnowledgeIndexStateRecord,
    KnowledgeItemRecord,
    ProjectMemoryRecord,
)
from ..models import Project, new_id, utc_now
from ..project_access import ProjectCapability, require_capability
from ..scientific_actions import list_structures
from ..scientific_models import (
    CalculationRecord,
    EvidenceCandidateRecord,
    ExperimentalDatasetRecord,
    ExperimentRecord,
    ScientificDocumentRecord,
)
from .chunking import CHUNKER_VERSION, SourceChunk, normalize_text, scientific_document_chunks
from .embeddings import DeterministicFakeEmbeddingGateway, EmbeddingGateway, cosine_similarity
from .spectrum_text import spectrum_chunk_text
from .vector_index import vector_index_for_session

INDEX_VERSION = "knowledge-v1"
# Characters of a chunk a search result carries. PDF page text is one long chunk (up to 8000), and
# a smaller cap made text late on a page (e.g. "implemented in the WIEN2K code") unquotable.
RESULT_CONTENT_CHARS = 8000
_TOKEN_RE = re.compile(r"[\w\u0370-\u03ff][\w\u0370-\u03ff./+\-]*", re.UNICODE)


def _scientific_query_tokens(query: str) -> set[str]:
    tokens = set(_TOKEN_RE.findall(normalize_text(query)))
    if "lattice" in tokens and tokens & {"parameter", "parameters"}:
        tokens.update({"cell", "dimensions", "unit", "a", "b", "c", "alpha", "beta", "gamma"})
    if tokens & {"xrd", "diffraction", "diffractogram"}:
        tokens.update({"xrd", "diffraction", "diffractogram", "x-ray", "2θ", "2theta"})
    if "peak" in tokens or "peaks" in tokens:
        tokens.update({"peak", "peaks", "position", "positions"})
    if "2theta" in tokens or "2θ" in tokens:
        tokens.update({"2theta", "2θ", "diffraction", "peak"})
    return tokens


_LEXICAL_STOPWORDS = frozenset(
    {
        *("the", "of", "in", "on", "at", "to", "is", "are", "was", "were", "and", "or", "for"),
        *("with", "from", "this", "that", "these", "those", "what", "which", "does", "do", "did"),
        *("how", "why", "when", "where", "who", "whom", "its", "it", "as", "by", "an", "be"),
        *("been", "has", "have", "had", "not", "can"),
    }
)


def _lexical_terms(query_tokens: set[str], limit: int = 8) -> list[str]:
    """Deterministic SQL terms: identifier-like tokens (formulas, DOIs, methods) outrank words."""
    terms: set[str] = set()
    for token in query_tokens:
        term = token.rstrip(".,;:-/")
        if len(term) >= 2 and term not in _LEXICAL_STOPWORDS:
            terms.add(term)

    def priority(term: str) -> tuple[int, int, str]:
        identifier_like = any(ch.isdigit() or ch in "/+" for ch in term)
        return (0 if identifier_like else 1, -len(term), term)

    return sorted(terms, key=priority)[:limit]


class KnowledgeService:
    def __init__(
        self,
        session: Session,
        identity: Identity,
        gateway: EmbeddingGateway | None = None,
        *,
        batch_size: int = 64,
        heartbeat_callback: Callable[[], bool] | None = None,
    ) -> None:
        self.session = session
        self.identity = identity
        self.gateway = gateway or DeterministicFakeEmbeddingGateway()
        self.batch_size = batch_size
        self.heartbeat_callback = heartbeat_callback

    def _project(self, project_id: str, *, edit: bool = False) -> Project:
        project, member = authorize_project_access(self.session, self.identity, project_id)
        if edit:
            require_capability(member, ProjectCapability.WRITE)
        return project

    def _state(self, project_id: str) -> KnowledgeIndexStateRecord:
        row = self.session.scalar(
            select(KnowledgeIndexStateRecord).where(
                KnowledgeIndexStateRecord.project_id == project_id,
                KnowledgeIndexStateRecord.scope_type == "PROJECT",
                KnowledgeIndexStateRecord.scope_id == project_id,
                KnowledgeIndexStateRecord.index_version == INDEX_VERSION,
            )
        )
        if row is None:
            row = KnowledgeIndexStateRecord(
                id=new_id(),
                project_id=project_id,
                scope_type="PROJECT",
                scope_id=project_id,
                index_version=INDEX_VERSION,
                status="PENDING",
            )
            self.session.add(row)
            self.session.flush()
        return row

    def status(self, project_id: str) -> KnowledgeIndexStatus:
        project = self._project(project_id)
        row = self._state(project.id)
        return KnowledgeIndexStatus(
            project_id=UUID(project.id),
            status=row.status,
            index_version=row.index_version,
            chunk_count=row.chunk_count,
            diagnostic=row.diagnostic,
            updated_at=row.updated_at,
        )

    def enqueue_reindex(self, project_id: str) -> KnowledgeIndexStatus:
        """Persist an idempotent indexing request; embedding runs only in a worker."""
        project = self._project(project_id, edit=True)
        state = self._state(project.id)
        fingerprint = self._source_fingerprint(project.id)
        key = f"{project.id}:{fingerprint}:{INDEX_VERSION}"
        existing = self.session.scalar(
            select(KnowledgeIndexJobRecord).where(KnowledgeIndexJobRecord.idempotency_key == key)
        )
        if existing is None:
            self.session.add(
                KnowledgeIndexJobRecord(
                    id=new_id(),
                    project_id=project.id,
                    source_type="PROJECT",
                    source_entity_id=project.id,
                    source_revision=fingerprint,
                    index_version=INDEX_VERSION,
                    state="PENDING",
                    priority=0,
                    idempotency_key=key,
                    attempt_count=0,
                    max_attempts=3,
                )
            )
        elif existing.state == "FAILED" or (
            # The stored index was built from different content (e.g. an earlier chunker) than the
            # sources now produce, and the job that would rebuild it already succeeded once.
            existing.state == "SUCCEEDED" and state.active_generation not in (None, fingerprint)
        ):
            existing.state = "PENDING"
            existing.max_attempts = max(existing.max_attempts, existing.attempt_count + 3)
            existing.lease_id = None
            existing.lease_owner = None
            existing.issued_at = None
            existing.expires_at = None
            existing.heartbeat_at = None
            existing.last_error_code = None
            existing.diagnostic = None
            existing.updated_at = utc_now()
        if state.status != "READY" or state.chunk_count == 0:
            state.status = "PENDING"
        state.diagnostic = None
        state.updated_at = utc_now()
        self.session.commit()
        return self.status(project.id)

    def _source_fingerprint(self, project_id: str) -> str:
        import hashlib

        digest = hashlib.sha256()
        for source in self._source_chunks(project_id):
            digest.update(source.source_type.encode())
            digest.update(source.source_entity_id.encode())
            # SQLite drops timezone metadata while PostgreSQL preserves it;
            # normalize UTC's textual suffix so a worker does not create a
            # spurious second generation after a restart.
            revision = (source.source_revision or "").replace("+00:00", "")
            digest.update(revision.encode())
            digest.update(source.content_hash.encode())
        return digest.hexdigest()

    def _source_chunks(self, project_id: str) -> list[SourceChunk]:
        def stable_revision(value: object) -> str:
            return str(value).replace("+00:00", "")

        chunks: list[SourceChunk] = []
        documents = self.session.scalars(
            select(ScientificDocumentRecord).where(
                ScientificDocumentRecord.project_id == project_id
            )
        ).all()
        for document in documents:
            candidates = self.session.scalars(
                select(EvidenceCandidateRecord).where(
                    EvidenceCandidateRecord.project_id == project_id,
                    EvidenceCandidateRecord.document_id == document.id,
                )
            ).all()
            anchors = {}
            if candidates:
                from ..scientific_models import DocumentSourceAnchorRecord

                anchor_ids = [c.anchor_id for c in candidates if c.anchor_id]
                anchors = {
                    a.id: a
                    for a in self.session.scalars(
                        select(DocumentSourceAnchorRecord).where(
                            DocumentSourceAnchorRecord.id.in_(anchor_ids)
                        )
                    ).all()
                }
            for chunk in scientific_document_chunks(document, candidates):
                if chunk.evidence_id:
                    anchor = anchors.get(
                        next(
                            (c.anchor_id for c in candidates if str(c.id) == chunk.evidence_id),
                            None,
                        )
                    )
                    chunk = SourceChunk(
                        source_type=chunk.source_type,
                        source_entity_id=chunk.source_entity_id,
                        source_revision=chunk.source_revision,
                        content=chunk.content,
                        document_id=chunk.document_id,
                        page_number=anchor.page_number if anchor else chunk.page_number,
                        anchor_id=anchor.id if anchor else None,
                        evidence_id=chunk.evidence_id,
                        source_class=chunk.source_class,
                        verification_state=chunk.verification_state,
                        metadata=chunk.metadata,
                    )
                elif chunk.source_type == "DOCUMENT_TEXT" and chunk.page_number:
                    page_anchor = next(
                        (
                            anchors.get(candidate.anchor_id)
                            for candidate in candidates
                            if candidate.evidence_type == "DOCUMENT_TEXT"
                            and candidate.anchor_id in anchors
                            and anchors[candidate.anchor_id].page_number == chunk.page_number
                        ),
                        None,
                    )
                    if page_anchor:
                        chunk = SourceChunk(
                            source_type=chunk.source_type,
                            source_entity_id=chunk.source_entity_id,
                            source_revision=chunk.source_revision,
                            content=chunk.content,
                            document_id=chunk.document_id,
                            page_number=chunk.page_number,
                            anchor_id=page_anchor.id,
                            source_class=chunk.source_class,
                            verification_state=chunk.verification_state,
                            metadata=chunk.metadata,
                        )
                chunks.append(chunk)

        for summary in list_structures(self.session, self.identity, project_id):
            chunks.append(
                SourceChunk(
                    source_type="STRUCTURE_METADATA",
                    source_entity_id=str(summary.id),
                    source_revision=str(summary.latest_version_id),
                    content=(
                        f"Structure {summary.name}; kind {summary.kind}; "
                        f"atoms {summary.atom_count}; bonds {summary.bond_count}; "
                        f"latest version {summary.latest_revision}."
                    ),
                    source_class="EXTRACTED",
                    verification_state="UNVERIFIED",
                    metadata={"structure_id": str(summary.id)},
                )
            )

        for calculation in self.session.scalars(
            select(CalculationRecord).where(CalculationRecord.project_id == project_id)
        ).all():
            detail = get_calculation(self.session, self.identity, project_id, calculation.id)
            spec = detail.specification
            method = getattr(getattr(spec, "method", None), "identifier", "unknown")
            basis = getattr(getattr(spec, "basis", None), "identifier", "unknown")
            result = (
                "" if detail.result is None else f" result {detail.result.model_dump(mode='json')}"
            )
            chunks.append(
                SourceChunk(
                    source_type="CALCULATION_RESULT",
                    source_entity_id=str(calculation.id),
                    source_revision=stable_revision(calculation.updated_at),
                    content=(
                        f"Calculation {calculation.id}; method {method}; basis {basis}; "
                        f"state {calculation.state}.{result}"
                    ),
                    source_class="CALCULATED" if detail.result else None,
                    verification_state="VERIFIED" if detail.result else "UNVERIFIED",
                    metadata={"calculation_id": str(calculation.id)},
                )
            )

        datasets = self.session.scalars(
            select(ExperimentalDatasetRecord).where(
                ExperimentalDatasetRecord.project_id == project_id
            )
        ).all()
        for dataset in datasets:
            experiment = self.session.get(ExperimentRecord, dataset.experiment_id)
            session_data = next(
                (
                    step.get("xrd_digitization_session") or step.get("graph_digitization_session")
                    for step in dataset.processing_json or []
                    if isinstance(step, dict)
                    and (
                        isinstance(step.get("xrd_digitization_session"), dict)
                        or isinstance(step.get("graph_digitization_session"), dict)
                    )
                ),
                None,
            )
            if dataset.source_class == "DIGITIZED" and isinstance(session_data, dict):
                points = session_data.get("points") or []
                if "graph_digitization_session" in next(
                    (
                        step
                        for step in dataset.processing_json or []
                        if isinstance(step, dict) and "graph_digitization_session" in step
                    ),
                    {},
                ):
                    point_text = "; ".join(
                        f"{point['x_value']:.5g} nm diameter / q {point['y_value']:.5g}%"
                        for point in points
                        if isinstance(point, dict)
                        and isinstance(point.get("x_value"), (int, float))
                        and isinstance(point.get("y_value"), (int, float))
                    )
                    content = (
                        "Figure 4 DLS dataset is DIGITIZED, reconstructed from PDF page 7; "
                        "X is source-labeled Diameter (nm), logarithmic, and Y is q (%); "
                        "it is not raw instrument data, and extracted prose radius and table "
                        "diameter claims remain separate rather than equivalent without explicit "
                        "reconciliation. Stored points: " + point_text + ". "
                        "Extracted prose and table values remain separate; a hydrodynamic radius "
                        "is not equivalent to diameter without explicit reconciliation."
                    )
                else:
                    point_text = "; ".join(
                        f"{point['two_theta_degree']:.4f}° 2θ"
                        + (
                            f" / {point['intensity']:.2f} CPS"
                            if point.get("intensity") is not None
                            else " / intensity absent"
                        )
                        for point in points
                        if isinstance(point, dict)
                        and isinstance(point.get("two_theta_degree"), (int, float))
                    )
                    content = (
                        "Figure 3 XRD dataset is DIGITIZED, manually reconstructed "
                        "from PDF page 6; "
                        "it is not raw instrument data or experimental raw data. Stored points: "
                        f"{point_text}. Paper-reported textual peaks remain separate "
                        "EXTRACTED evidence."
                    )
            elif dataset.spectrum_json is not None:
                content = spectrum_chunk_text(
                    dataset.spectrum_json, dataset.point_count, dataset.state
                )
            else:
                content = (
                    f"Experimental dataset {experiment.name if experiment else dataset.id}; "
                    f"modality {experiment.modality if experiment else 'unknown'}; "
                    f"points {dataset.point_count}; state {dataset.state}."
                )
            chunks.append(
                SourceChunk(
                    source_type="DATASET_METADATA",
                    source_entity_id=str(dataset.id),
                    source_revision=stable_revision(dataset.created_at),
                    content=content,
                    source_class=dataset.source_class,
                    verification_state="VERIFIED" if dataset.state == "COMMITTED" else "UNVERIFIED",
                    metadata={"dataset_id": str(dataset.id)},
                )
            )

        for memory in self.session.scalars(
            select(ProjectMemoryRecord).where(ProjectMemoryRecord.project_id == project_id)
        ).all():
            chunks.append(
                SourceChunk(
                    source_type="PROJECT_ACTIVITY",
                    source_entity_id=str(memory.id),
                    source_revision=stable_revision(memory.created_at),
                    content=memory.content,
                    source_class=None,
                    verification_state=memory.confirmation_state,
                    metadata={"memory_type": memory.memory_type},
                )
            )
        return chunks

    def index_project(
        self, project_id: str, *, generation: str | None = None
    ) -> KnowledgeIndexStatus:
        project = self._project(project_id)
        state = self._state(project.id)
        generation = generation or self._source_fingerprint(project.id)
        state.status = "INDEXING"
        state.diagnostic = None
        self.session.flush()
        try:
            chunks = self._source_chunks(project.id)
            existing = {
                (
                    item.source_type,
                    item.source_entity_id,
                    item.source_revision,
                    item.content_hash,
                ): item
                for item in self.session.scalars(
                    select(KnowledgeItemRecord).where(KnowledgeItemRecord.project_id == project.id)
                ).all()
            }
            current_item_ids: set[str] = set()
            for source in chunks:
                item_key = (
                    source.source_type,
                    source.source_entity_id,
                    source.source_revision,
                    source.content_hash,
                )
                item = existing.get(item_key)
                if item is None:
                    item = KnowledgeItemRecord(
                        id=new_id(),
                        project_id=project.id,
                        source_type=source.source_type,
                        source_entity_id=source.source_entity_id,
                        source_revision=source.source_revision,
                        content_hash=source.content_hash,
                        document_id=source.document_id,
                        page_number=source.page_number,
                        anchor_id=source.anchor_id,
                        evidence_id=source.evidence_id,
                        source_class=source.source_class,
                        verification_state=source.verification_state,
                        content=source.content,
                        normalized_content=normalize_text(source.content),
                        chunker_version=CHUNKER_VERSION,
                    )
                    self.session.add(item)
                    self.session.flush()
                    chunk = KnowledgeChunkRecord(
                        id=new_id(),
                        project_id=project.id,
                        knowledge_item_id=item.id,
                        ordinal=0,
                        content=source.content,
                        content_hash=source.content_hash,
                        metadata_json={
                            **(source.metadata or {}),
                            "document_id": source.document_id,
                            "page_number": source.page_number,
                            "anchor_id": source.anchor_id,
                        },
                    )
                    self.session.add(chunk)
                current_item_ids.add(item.id)

            self.session.flush()
            all_chunks = self.session.scalars(
                select(KnowledgeChunkRecord).where(
                    KnowledgeChunkRecord.project_id == project.id,
                    KnowledgeChunkRecord.knowledge_item_id.in_(current_item_ids),
                )
            ).all()
            existing_embeddings = {
                row.chunk_id: row
                for row in self.session.scalars(
                    select(KnowledgeEmbeddingRecord).where(
                        KnowledgeEmbeddingRecord.project_id == project.id,
                        KnowledgeEmbeddingRecord.index_version == INDEX_VERSION,
                        KnowledgeEmbeddingRecord.embedding_model == self.gateway.model,
                        KnowledgeEmbeddingRecord.chunk_id.in_([chunk.id for chunk in all_chunks]),
                    )
                ).all()
            }
            to_embed = []
            for chunk in all_chunks:
                embedding = existing_embeddings.get(chunk.id)
                if embedding is not None and embedding.content_hash == chunk.content_hash:
                    # Identical immutable chunk content can safely reuse its vector
                    # in the newly built project generation.
                    embedding.generation = generation
                else:
                    to_embed.append(chunk)
            for offset in range(0, len(to_embed), self.batch_size):
                batch = to_embed[offset : offset + self.batch_size]
                embeddings = self.gateway.embed_documents([chunk.content for chunk in batch])
                for chunk, embedding in zip(batch, embeddings, strict=True):
                    if (
                        self.session.bind is not None
                        and self.session.bind.dialect.name == "postgresql"
                        and embedding.dimension != 64
                    ):
                        raise ValueError(
                            "PostgreSQL knowledge-v1 requires the configured 64-dimensional vector."
                        )
                    existing_embedding = existing_embeddings.get(chunk.id)
                    if existing_embedding is not None:
                        existing_embedding.provider = embedding.provider
                        existing_embedding.dimension = embedding.dimension
                        existing_embedding.normalized = embedding.normalized
                        existing_embedding.embedding_json = list(embedding.vector)
                        existing_embedding.embedding_vector = list(embedding.vector)
                        existing_embedding.content_hash = chunk.content_hash
                        existing_embedding.generation = generation
                    else:
                        self.session.add(
                            KnowledgeEmbeddingRecord(
                                id=new_id(),
                                project_id=project.id,
                                chunk_id=chunk.id,
                                index_version=INDEX_VERSION,
                                provider=embedding.provider,
                                embedding_model=embedding.model,
                                dimension=embedding.dimension,
                                normalized=embedding.normalized,
                                embedding_json=list(embedding.vector),
                                embedding_vector=list(embedding.vector),
                                content_hash=chunk.content_hash,
                                generation=generation,
                            )
                        )
                self.session.flush()
                if self.heartbeat_callback:
                    self.heartbeat_callback()
            state.status = "READY"
            state.chunk_count = len(all_chunks)
            state.active_generation = generation
            state.updated_at = utc_now()
            self.session.commit()
        except Exception as error:
            self.session.rollback()
            state = self._state(project.id)
            state.status = "FAILED"
            state.diagnostic = str(error)[:1000]
            self.session.commit()
        return self.status(project.id)

    def _lexical_candidates(
        self,
        project_id: str,
        generation: str | None,
        payload: KnowledgeSearchInput,
        query_tokens: set[str],
    ) -> list[tuple[KnowledgeItemRecord, KnowledgeChunkRecord, KnowledgeEmbeddingRecord]]:
        """Project-scoped substring candidates, ranked in SQL so truncation is deterministic."""
        weighted = []
        normalized_query = normalize_text(payload.query)
        if len(normalized_query) >= 3 and _TOKEN_RE.search(normalized_query):
            weighted.append(
                (
                    KnowledgeItemRecord.normalized_content.contains(
                        normalized_query, autoescape=True
                    ),
                    1000,
                )
            )
        for term in _lexical_terms(query_tokens):
            weighted.append(
                (KnowledgeItemRecord.normalized_content.contains(term, autoescape=True), 1)
            )
        if not weighted:
            return []
        filters = [
            KnowledgeItemRecord.project_id == project_id,
            KnowledgeChunkRecord.project_id == project_id,
            KnowledgeEmbeddingRecord.project_id == project_id,
            KnowledgeEmbeddingRecord.index_version == INDEX_VERSION,
            KnowledgeEmbeddingRecord.embedding_model == self.gateway.model,
        ]
        if generation:
            filters.append(KnowledgeEmbeddingRecord.generation == generation)
        if payload.filters.document_id:
            filters.append(KnowledgeItemRecord.document_id == str(payload.filters.document_id))
        if payload.filters.source_types:
            filters.append(KnowledgeItemRecord.source_type.in_(payload.filters.source_types))
        match_score = sum((case((predicate, weight), else_=0) for predicate, weight in weighted))
        statement = (
            select(KnowledgeItemRecord, KnowledgeChunkRecord, KnowledgeEmbeddingRecord)
            .join(
                KnowledgeChunkRecord,
                KnowledgeChunkRecord.knowledge_item_id == KnowledgeItemRecord.id,
            )
            .join(
                KnowledgeEmbeddingRecord,
                KnowledgeEmbeddingRecord.chunk_id == KnowledgeChunkRecord.id,
            )
            .where(*filters, or_(*(predicate for predicate, _weight in weighted)))
            .order_by(match_score.desc(), KnowledgeChunkRecord.id)
            .limit(max(payload.limit * 4, 50))
        )
        return [
            (item, chunk, embedding) for item, chunk, embedding in self.session.execute(statement)
        ]

    def search(self, project_id: str, payload: KnowledgeSearchInput) -> KnowledgeSearchOutput:
        project = self._project(project_id)
        state = self._state(project.id)
        if state.status != "READY":
            return KnowledgeSearchOutput(
                query=payload.query,
                results=(),
                index_version=INDEX_VERSION,
            )
        query_tokens = _scientific_query_tokens(payload.query)
        query_embedding = self.gateway.embed_query(payload.query)
        rows = list(
            vector_index_for_session(self.session).candidates(
                self.session,
                project_id=project.id,
                index_version=INDEX_VERSION,
                embedding_model=self.gateway.model,
                generation=state.active_generation,
                query_vector=query_embedding.vector,
                limit=max(payload.limit * 8, 100),
            )
        )
        # Independent lexical candidate retrieval before fusion (AS-0 Section 7): exact formulas,
        # method/basis identifiers and DOIs must not depend on the dense top-k cut-off.
        dense_chunk_ids = {chunk.id for _item, chunk, _emb, _sem in rows}
        for item, chunk, embedding in self._lexical_candidates(
            project.id, state.active_generation, payload, query_tokens
        ):
            if chunk.id in dense_chunk_ids:
                continue
            dense_chunk_ids.add(chunk.id)
            semantic_seed = (
                cosine_similarity(tuple(embedding.embedding_json), query_embedding.vector)
                if embedding.embedding_json
                else 0.0
            )
            rows.append((item, chunk, embedding, semantic_seed))
        document_metadata = {
            row.id: row
            for row in self.session.scalars(
                select(ScientificDocumentRecord).where(
                    ScientificDocumentRecord.project_id == project.id
                )
            ).all()
        }
        results: list[KnowledgeRetrievalResult] = []
        for item, chunk, embedding, native_semantic in rows:
            source_types = payload.filters.source_types
            if source_types and item.source_type not in source_types:
                continue
            if (
                payload.filters.source_classes
                and item.source_class not in payload.filters.source_classes
            ):
                continue
            if payload.filters.document_id and item.document_id != str(payload.filters.document_id):
                continue
            if payload.filters.structure_id and item.source_entity_id != str(
                payload.filters.structure_id
            ):
                continue
            if payload.filters.calculation_id and item.source_entity_id != str(
                payload.filters.calculation_id
            ):
                continue
            document = document_metadata.get(item.document_id) if item.document_id else None
            if payload.filters.year and (
                document is None or document.publication_year != payload.filters.year
            ):
                continue
            if payload.filters.doi and (document is None or document.doi != payload.filters.doi):
                continue
            lexical_tokens = set(_TOKEN_RE.findall(item.normalized_content))
            lexical = len(query_tokens & lexical_tokens) / max(1, len(query_tokens))
            if payload.query.casefold() in item.normalized_content:
                lexical = min(1.0, lexical + 0.35)
            semantic = (
                native_semantic
                if self.session.bind is not None and self.session.bind.dialect.name == "postgresql"
                else cosine_similarity(tuple(embedding.embedding_json), query_embedding.vector)
            )
            combined = min(1.0, 0.65 * lexical + 0.35 * semantic)
            if combined <= 0:
                continue
            citation_type = {
                "DOCUMENT_TEXT": "DOCUMENT",
                "DOCUMENT_EVIDENCE": "EVIDENCE",
                "CALCULATION_RESULT": "CALCULATION",
                "DATASET_METADATA": "DATASET",
                "STRUCTURE_METADATA": "STRUCTURE",
                "PROJECT_ACTIVITY": "PROJECT_NOTE",
            }.get(item.source_type, "DOCUMENT")
            results.append(
                KnowledgeRetrievalResult(
                    knowledge_item_id=UUID(item.id),
                    knowledge_chunk_id=UUID(chunk.id),
                    source_type=item.source_type,
                    source_entity_id=UUID(item.source_entity_id),
                    source_revision=item.source_revision,
                    content=chunk.content[:RESULT_CONTENT_CHARS],
                    lexical_score=lexical,
                    semantic_score=semantic,
                    combined_score=combined,
                    source_class=item.source_class,
                    verification_state=item.verification_state,
                    document_id=UUID(item.document_id) if item.document_id else None,
                    page_number=item.page_number,
                    source_anchor_id=UUID(item.anchor_id) if item.anchor_id else None,
                    citation_type=citation_type,
                    index_version=INDEX_VERSION,
                )
            )
        results.sort(
            key=lambda result: (
                -result.combined_score,
                str(result.knowledge_item_id),
                str(result.knowledge_chunk_id),
            )
        )
        return KnowledgeSearchOutput(
            query=payload.query,
            results=tuple(results[: payload.limit]),
            index_version=INDEX_VERSION,
        )

    def get_item(self, project_id: str, item_id: str) -> KnowledgeItemView:
        project = self._project(project_id)
        item = self.session.scalar(
            select(KnowledgeItemRecord).where(
                KnowledgeItemRecord.id == item_id, KnowledgeItemRecord.project_id == project.id
            )
        )
        if item is None:
            raise ScientificReferenceNotFound("Knowledge item does not exist.")
        return KnowledgeItemView(
            id=UUID(item.id),
            project_id=UUID(item.project_id),
            source_type=item.source_type,
            source_entity_id=UUID(item.source_entity_id),
            source_revision=item.source_revision,
            content_hash=item.content_hash,
            document_id=UUID(item.document_id) if item.document_id else None,
            page_number=item.page_number,
            source_anchor_id=UUID(item.anchor_id) if item.anchor_id else None,
            evidence_id=UUID(item.evidence_id) if item.evidence_id else None,
            source_class=item.source_class,
            verification_state=item.verification_state,
            content=item.content,
            chunker_version=item.chunker_version,
            created_at=item.created_at,
        )

    def create_memory(
        self, project_id: str, payload: ProjectMemoryCreateInput
    ) -> ProjectMemoryView:
        project = self._project(project_id, edit=True)
        row = ProjectMemoryRecord(
            id=new_id(),
            project_id=project.id,
            memory_type=payload.memory_type,
            content=payload.content,
            confirmation_state="CONFIRMED",
            created_by=self.identity.user_id,
            source_conversation_id=str(payload.source_conversation_id)
            if payload.source_conversation_id
            else None,
            source_links_json=list(payload.source_links),
        )
        self.session.add(row)
        state = self.session.scalar(
            select(KnowledgeIndexStateRecord).where(
                KnowledgeIndexStateRecord.project_id == project.id,
                KnowledgeIndexStateRecord.scope_type == "PROJECT",
                KnowledgeIndexStateRecord.scope_id == project.id,
                KnowledgeIndexStateRecord.index_version == INDEX_VERSION,
            )
        )
        if state is not None:
            state.status = "STALE"
        self.session.commit()
        self.enqueue_reindex(project.id)
        return self._memory_view(row)

    def list_memories(self, project_id: str) -> ProjectMemoryListOutput:
        project = self._project(project_id)
        rows = self.session.scalars(
            select(ProjectMemoryRecord)
            .where(ProjectMemoryRecord.project_id == project.id)
            .order_by(ProjectMemoryRecord.created_at.desc())
        ).all()
        return ProjectMemoryListOutput(memories=tuple(self._memory_view(row) for row in rows))

    @staticmethod
    def _memory_view(row: ProjectMemoryRecord) -> ProjectMemoryView:
        return ProjectMemoryView(
            id=UUID(row.id),
            project_id=UUID(row.project_id),
            memory_type=row.memory_type,
            content=row.content,
            confirmation_state="CONFIRMED",
            created_by=UUID(row.created_by),
            source_conversation_id=UUID(row.source_conversation_id)
            if row.source_conversation_id
            else None,
            created_at=row.created_at,
        )
