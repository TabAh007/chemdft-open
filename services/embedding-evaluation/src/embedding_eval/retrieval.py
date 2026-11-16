from __future__ import annotations

import re
import unicodedata

TOKEN_RE = re.compile(r"[\w\u0370-\u03ff][\w\u0370-\u03ff./+\-]*", re.UNICODE)


def normalize(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def query_tokens(query: str) -> set[str]:
    tokens = set(TOKEN_RE.findall(normalize(query)))
    if "lattice" in tokens and tokens & {"parameter", "parameters"}:
        tokens.update({"cell", "dimensions", "unit", "a", "b", "c", "alpha", "beta", "gamma"})
    if tokens & {"xrd", "diffraction", "diffractogram"}:
        tokens.update({"xrd", "diffraction", "diffractogram", "x-ray", "2θ", "2theta"})
    if tokens & {"peak", "peaks"}:
        tokens.update({"peak", "peaks", "position", "positions"})
    if tokens & {"2theta", "2θ"}:
        tokens.update({"2theta", "2θ", "diffraction", "peak"})
    return tokens


def lexical_score(query: str, text: str) -> float:
    tokens = query_tokens(query)
    if not tokens:
        return 0.0
    content = set(TOKEN_RE.findall(normalize(text)))
    score = len(tokens & content) / max(1, len(tokens))
    if normalize(query) and normalize(query) in normalize(text):
        score += 0.35
    return min(1.0, score)


def hybrid_score(lexical: float, semantic: float) -> float:
    return min(1.0, 0.65 * lexical + 0.35 * semantic)
