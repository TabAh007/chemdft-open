"""Evaluation-only retrieval policies and abstention diagnostics.

Scores here are ranking signals, never calibrated confidence probabilities.
"""

from __future__ import annotations

import hashlib
import math
import re
import unicodedata
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

RRF_K = 60
EXACT_BOOST_MAX_SEMANTIC_RANK = 10
EXACT_BOOST_RANKS = 1

_DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:a-z0-9]+", re.IGNORECASE)
_NUMBER_UNIT_RE = re.compile(
    r"(?<![\w.])[-+]?\d+(?:\.\d+)?\s*(?:°\s*[cC]|[kK]|[mM][eE][vV]|[eE][vV]|"
    r"[gG][pP][aA]|[mM][pP][aA]|[kK][jJ](?:\s*/\s*[mM][oO][lL])?|"
    r"[kK][cC][aA][lL](?:\s*/\s*[mM][oO][lL])?|[aAÅÅ]|%|[nN][mM]|[µμuU][mM]|"
    r"[mM][iI][nN]|[hH]|[bB][aA][rR])\b"
)
_FORMULA_RE = re.compile(r"(?<![A-Za-z])(?:[A-Z][a-z]?\d*|\(|\)\d*)+(?![A-Za-z])")
_ELEMENTS = frozenset(
    "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn "
    "Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce "
    "Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At "
    "Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn "
    "Nh Fl Mc Lv Ts Og".split()
)
_METHOD_TERMS = frozenset(
    {
        "b3lyp",
        "pbe",
        "pbe0",
        "m06-2x",
        "m06l",
        "scan",
        "r2scan",
        "hf",
        "mp2",
        "ccsd(t)",
        "def2-svp",
        "def2-tzvp",
        "6-31g(d)",
        "6-311++g(d,p)",
        "cc-pvdz",
        "cc-pvtz",
        "sto-3g",
    }
)


def _normalize(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def _formula_tokens(text: str) -> set[str]:
    found: set[str] = set()
    for candidate in _FORMULA_RE.findall(text):
        index = 0
        element_count = 0
        has_explicit_count = False
        valid = True

        def parse_group(nested: bool = False) -> bool:
            nonlocal index, element_count, has_explicit_count
            while index < len(candidate):
                if candidate[index] == ")":
                    return nested
                if candidate[index] == "(":
                    index += 1
                    if not parse_group(nested=True) or index >= len(candidate):
                        return False
                    index += 1
                    if index < len(candidate) and candidate[index].isdigit():
                        has_explicit_count = True
                        while index < len(candidate) and candidate[index].isdigit():
                            index += 1
                    continue
                match = re.match(r"[A-Z][a-z]?", candidate[index:])
                if not match or match.group() not in _ELEMENTS:
                    return False
                element_count += 1
                index += len(match.group())
                if index < len(candidate) and candidate[index].isdigit():
                    has_explicit_count = True
                    while index < len(candidate) and candidate[index].isdigit():
                        index += 1
            return not nested

        valid = parse_group()
        if valid and index == len(candidate) and (element_count > 1 or has_explicit_count):
            found.add(candidate)
    return found


def exact_match_signals(query: str, passage: str) -> dict[str, Any]:
    """Return explicit token matches, preserving chemistry formula case."""
    query_dois = {value.rstrip(".,;:)").casefold() for value in _DOI_RE.findall(query)}
    passage_dois = {value.rstrip(".,;:)").casefold() for value in _DOI_RE.findall(passage)}
    query_formulas = _formula_tokens(query)
    passage_formulas = _formula_tokens(passage)
    query_values = {_normalize(value) for value in _NUMBER_UNIT_RE.findall(query)}
    passage_values = {_normalize(value) for value in _NUMBER_UNIT_RE.findall(passage)}
    query_normalized = _normalize(query)
    passage_normalized = _normalize(passage)
    methods = {
        term
        for term in _METHOD_TERMS
        if re.search(rf"(?<![\w]){re.escape(term)}(?![\w])", query_normalized)
    }
    method_hits = {
        term
        for term in methods
        if re.search(rf"(?<![\w]){re.escape(term)}(?![\w])", passage_normalized)
    }
    return {
        "doi_matches": sorted(query_dois & passage_dois),
        "formula_matches": sorted(query_formulas & passage_formulas),
        "numeric_unit_matches": sorted(query_values & passage_values),
        "method_matches": sorted(method_hits),
        "exact_token_overlap": bool(
            (query_dois & passage_dois)
            or (query_formulas & passage_formulas)
            or (query_values & passage_values)
            or method_hits
        ),
    }


def rank_by_score(scores: Mapping[str, float]) -> list[str]:
    """Stable descending ranking with identifier tie-breaks."""
    return sorted(scores, key=lambda item: (-float(scores[item]), item))


def reciprocal_rank_fusion(
    semantic_ranking: Sequence[str], lexical_ranking: Sequence[str], *, k: int = RRF_K
) -> tuple[list[str], dict[str, float]]:
    """Fuse two rank lists without comparing their incompatible score scales."""
    if k <= 0:
        raise ValueError("RRF k must be positive.")
    scores: dict[str, float] = {}
    for ranking in (semantic_ranking, lexical_ranking):
        seen: set[str] = set()
        for rank, item_id in enumerate(ranking, start=1):
            if item_id in seen:
                continue
            seen.add(item_id)
            scores[item_id] = scores.get(item_id, 0.0) + 1.0 / (k + rank)
    return sorted(scores, key=lambda item: (-scores[item], item)), scores


def semantic_with_exact_boost(
    query: str,
    semantic_ranking: Sequence[str],
    passages: Mapping[str, str],
    *,
    max_semantic_rank: int = EXACT_BOOST_MAX_SEMANTIC_RANK,
    boost_ranks: int = EXACT_BOOST_RANKS,
) -> tuple[list[str], dict[str, dict[str, Any]]]:
    """Nudge exact-token candidates within the semantic top-k, never route away from it."""
    if max_semantic_rank < 1 or boost_ranks < 0:
        raise ValueError("Exact-boost rank parameters are invalid.")
    original_rank = {item_id: rank for rank, item_id in enumerate(semantic_ranking, start=1)}
    signals = {
        item_id: exact_match_signals(query, passages[item_id]) for item_id in semantic_ranking
    }
    effective_rank = {
        item_id: max(1, rank - boost_ranks)
        if rank <= max_semantic_rank and signals[item_id]["exact_token_overlap"]
        else rank
        for item_id, rank in original_rank.items()
    }
    reranked = sorted(
        semantic_ranking,
        key=lambda item: (
            effective_rank[item],
            not signals[item]["exact_token_overlap"],
            original_rank[item],
        ),
    )
    return reranked, signals


def abstention_signals(
    semantic_scores: Mapping[str, float],
    lexical_scores: Mapping[str, float],
    document_by_id: Mapping[str, str],
    passages: Mapping[str, str],
    query: str,
) -> dict[str, float | int | bool | str | None]:
    """Collect uncalibrated retrieval diagnostics for later abstention analysis."""
    semantic_order = rank_by_score(semantic_scores)
    lexical_order = rank_by_score(lexical_scores)
    if not semantic_order:
        return {
            "top1_dense_score": None,
            "top1_top2_margin": None,
            "top1_top5_spread": None,
            "top1_lexical_score": None,
            "top1_lexical_rank": None,
            "semantic_lexical_agreement": False,
            "top5_document_diversity": 0.0,
            "top1_exact_token_overlap": False,
        }
    sem_values = [float(semantic_scores[item]) for item in semantic_order]
    top_id = semantic_order[0]
    lexical_rank = {item: rank for rank, item in enumerate(lexical_order, start=1)}
    documents = [document_by_id[item] for item in semantic_order[:5] if item in document_by_id]
    exact = exact_match_signals(query, passages[top_id]) if top_id in passages else {}
    return {
        "top1_dense_score": sem_values[0],
        "top1_top2_margin": sem_values[0] - sem_values[1] if len(sem_values) > 1 else None,
        "top1_top5_spread": sem_values[0] - sem_values[min(4, len(sem_values) - 1)],
        "top1_lexical_score": float(lexical_scores[top_id]) if top_id in lexical_scores else None,
        "top1_lexical_rank": lexical_rank.get(top_id),
        "semantic_lexical_agreement": bool(lexical_order and lexical_order[0] == top_id),
        "top5_document_diversity": len(set(documents)) / len(documents) if documents else 0.0,
        "top1_exact_token_overlap": bool(exact.get("exact_token_overlap", False)),
    }


def binary_auc(labels: Sequence[bool], scores: Sequence[float]) -> float | None:
    """Pairwise AUROC; returns None when either class is absent."""
    if len(labels) != len(scores) or not labels:
        raise ValueError("Labels and scores must be non-empty and equal length.")
    positives = [score for label, score in zip(labels, scores, strict=True) if label]
    negatives = [score for label, score in zip(labels, scores, strict=True) if not label]
    if not positives or not negatives:
        return None
    wins = sum(
        1.0 if positive > negative else 0.5 if positive == negative else 0.0
        for positive in positives
        for negative in negatives
    )
    return wins / (len(positives) * len(negatives))


def average_precision(labels: Sequence[bool], scores: Sequence[float]) -> float | None:
    """Binary average precision; returns None when there are no positives."""
    if len(labels) != len(scores) or not labels:
        raise ValueError("Labels and scores must be non-empty and equal length.")
    positives = sum(labels)
    if not positives:
        return None
    order = sorted(range(len(scores)), key=lambda index: (-scores[index], index))
    hits = 0
    total = 0.0
    for rank, index in enumerate(order, start=1):
        if labels[index]:
            hits += 1
            total += hits / rank
    return total / positives


def threshold_metrics(
    labels: Sequence[bool], scores: Sequence[float], thresholds: Sequence[float]
) -> list[dict[str, float | int]]:
    """Report candidate signal cutoffs; no threshold is selected or calibrated."""
    if len(labels) != len(scores) or not labels:
        raise ValueError("Labels and scores must be non-empty and equal length.")
    answerable = sum(labels)
    no_answer = len(labels) - answerable
    rows = []
    for threshold in thresholds:
        predicted_answerable = [score >= threshold for score in scores]
        true_positive = sum(
            label and predicted
            for label, predicted in zip(labels, predicted_answerable, strict=True)
        )
        false_positive = sum(
            not label and predicted
            for label, predicted in zip(labels, predicted_answerable, strict=True)
        )
        true_negative = no_answer - false_positive
        accepted = true_positive + false_positive
        rows.append(
            {
                "threshold": float(threshold),
                "true_positive": true_positive,
                "false_positive": false_positive,
                "true_negative": true_negative,
                "false_answer_rate": false_positive / no_answer if no_answer else math.nan,
                "no_answer_recall": true_negative / no_answer if no_answer else math.nan,
                "accepted_answer_precision": true_positive / accepted if accepted else math.nan,
                "abstention_rate": sum(not predicted for predicted in predicted_answerable)
                / len(labels),
                "answerable_recall": true_positive / answerable if answerable else math.nan,
            }
        )
    return rows


def split_isolated(
    records: Sequence[Mapping[str, Any]], *, holdout_fraction: float = 0.25, seed: int = 20260924
) -> tuple[list[Mapping[str, Any]], list[Mapping[str, Any]]]:
    """Deterministically balance marginal strata without splitting leakage groups."""
    if not 0.1 <= holdout_fraction <= 0.5:
        raise ValueError("Holdout fraction must be between 0.10 and 0.50.")
    leakage_groups: dict[str, list[Mapping[str, Any]]] = {}
    seen_ids: set[str] = set()
    for record in records:
        query_id = record.get("query_id")
        if not query_id:
            raise ValueError("Every split record requires a query_id.")
        if query_id in seen_ids:
            raise ValueError(f"Duplicate query_id in split input: {query_id}.")
        seen_ids.add(query_id)
        leakage_id = str(record.get("leakage_group_id") or query_id)
        leakage_groups.setdefault(leakage_id, []).append(record)

    group_features: dict[str, Counter[str]] = {}
    total_features: Counter[str] = Counter()
    for leakage_id, members in leakage_groups.items():
        answerability = {bool(member.get("no_answer")) for member in members}
        if len(answerability) != 1:
            raise ValueError(f"Leakage group {leakage_id!r} mixes answerability.")
        features: Counter[str] = Counter()
        for member in members:
            is_no_answer = bool(member.get("no_answer"))
            query_class = str(member.get("query_class", "unknown"))
            language = str(member.get("language", "unknown"))
            features[f"answerability:{'no_answer' if is_no_answer else 'answerable'}"] += 1
            features[f"class:{query_class}"] += 1
            features[f"language:{language}"] += 1
            features[
                f"answerability_class:{'no_answer' if is_no_answer else 'answerable'}:{query_class}"
            ] += 1
        group_features[leakage_id] = features
        total_features.update(features)

    target_size = round(len(records) * holdout_fraction)
    chosen_groups: set[str] = set()
    selected_features: Counter[str] = Counter()
    selected_size = 0
    feature_group_counts = Counter(
        feature for features in group_features.values() for feature in features
    )

    def coverage_penalty(features: Counter[str]) -> float:
        penalty = 0.0
        for feature, total in total_features.items():
            if not feature.startswith(("answerability:", "class:", "language:")):
                continue
            if total < 2 or feature_group_counts[feature] < 2:
                continue
            if features[feature] == 0 or features[feature] == total:
                penalty += 10.0
        return penalty

    def balance_cost(candidate_features: Counter[str], candidate_size: int) -> float:
        size_error = (candidate_size - target_size) / max(len(records), 1)
        cost = size_error * size_error
        for feature, total in total_features.items():
            target = total * holdout_fraction
            selected = selected_features[feature] + candidate_features[feature]
            deviation = (selected - target) / max(total, 1)
            cost += deviation * deviation
        candidate_counts = selected_features + candidate_features
        cost += coverage_penalty(candidate_counts)
        return cost

    while selected_size < target_size:
        remaining = target_size - selected_size
        candidates = [
            group_id
            for group_id, members in leakage_groups.items()
            if group_id not in chosen_groups and len(members) <= remaining
        ]
        if not candidates:
            raise ValueError("Leakage-group sizes cannot produce the requested split size.")
        chosen = min(
            candidates,
            key=lambda group_id: (
                balance_cost(group_features[group_id], len(leakage_groups[group_id])),
                hashlib.sha256(f"{seed}:{group_id}".encode()).hexdigest(),
            ),
        )
        chosen_groups.add(chosen)
        selected_size += len(leakage_groups[chosen])
        selected_features.update(group_features[chosen])

    def objective(features: Counter[str], size: int) -> float:
        size_error = (size - target_size) / max(len(records), 1)
        cost = size_error * size_error
        for feature, total in total_features.items():
            target = total * holdout_fraction
            deviation = (features[feature] - target) / max(total, 1)
            cost += deviation * deviation
        cost += coverage_penalty(features)
        return cost

    # Greedy selection gets close to the multidimensional targets. Same-size
    # swaps then recover rare strata (for example a single identifier query)
    # without changing the exact partition size or splitting leakage groups.
    while True:
        best_swap: tuple[float, str, str] | None = None
        current_cost = objective(selected_features, selected_size)
        for selected_group in sorted(chosen_groups):
            for replacement in sorted(set(leakage_groups) - chosen_groups):
                if len(leakage_groups[selected_group]) != len(leakage_groups[replacement]):
                    continue
                candidate_features = selected_features.copy()
                candidate_features.subtract(group_features[selected_group])
                candidate_features.update(group_features[replacement])
                candidate_cost = objective(candidate_features, selected_size)
                swap = (candidate_cost, selected_group, replacement)
                if candidate_cost + 1e-12 < current_cost and (
                    best_swap is None or swap < best_swap
                ):
                    best_swap = swap
        if best_swap is None:
            break
        _, selected_group, replacement = best_swap
        chosen_groups.remove(selected_group)
        chosen_groups.add(replacement)
        selected_features.subtract(group_features[selected_group])
        selected_features.update(group_features[replacement])

    holdout = [member for group_id in chosen_groups for member in leakage_groups[group_id]]
    development = [
        member
        for group_id, members in leakage_groups.items()
        if group_id not in chosen_groups
        for member in members
    ]
    dev_ids = {record["query_id"] for record in development}
    holdout_ids = {record["query_id"] for record in holdout}
    if dev_ids & holdout_ids or dev_ids | holdout_ids != {record["query_id"] for record in records}:
        raise AssertionError("Development/holdout split isolation failed.")
    return sorted(development, key=lambda item: item["query_id"]), sorted(
        holdout, key=lambda item: item["query_id"]
    )
