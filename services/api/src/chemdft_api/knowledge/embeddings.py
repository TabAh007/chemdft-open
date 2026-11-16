from __future__ import annotations

import hashlib
import math
import re
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class Embedding:
    vector: tuple[float, ...]
    provider: str
    model: str
    dimension: int
    normalized: bool
    usage: int
    metadata: dict[str, str]


class EmbeddingGateway(Protocol):
    provider: str
    model: str
    dimension: int

    def embed_documents(self, texts: list[str]) -> list[Embedding]: ...

    def embed_query(self, text: str) -> Embedding: ...


class DeterministicFakeEmbeddingGateway:
    """Offline, deterministic hashed-token embeddings for CI and local SQLite."""

    provider = "fake"
    model = "deterministic-hash-v1"

    def __init__(self, dimension: int = 64) -> None:
        if dimension < 8:
            raise ValueError("Embedding dimension must be at least 8.")
        self.dimension = dimension

    def _embed(self, text: str) -> Embedding:
        vector = [0.0] * self.dimension
        tokens = re.findall(r"[\w\u0370-\u03ff][\w\u0370-\u03ff./+\-]*", text.casefold())
        for token in tokens:
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            index = int.from_bytes(digest[:4], "big") % self.dimension
            sign = 1.0 if digest[4] & 1 else -1.0
            vector[index] += sign
        norm = math.sqrt(sum(value * value for value in vector))
        if norm:
            vector = [value / norm for value in vector]
        return Embedding(
            vector=tuple(vector),
            provider=self.provider,
            model=self.model,
            dimension=self.dimension,
            normalized=True,
            usage=len(tokens),
            metadata={"policy_version": "fake-v1"},
        )

    def embed_documents(self, texts: list[str]) -> list[Embedding]:
        return [self._embed(text) for text in texts]

    def embed_query(self, text: str) -> Embedding:
        return self._embed(text)


def cosine_similarity(left: tuple[float, ...], right: tuple[float, ...]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    return max(0.0, min(1.0, sum(a * b for a, b in zip(left, right, strict=True))))
