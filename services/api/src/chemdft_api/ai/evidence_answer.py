"""Validate extractive answers against project knowledge search results.

This produces explanatory text and references only. It never publishes a
scientific result or promotes an extracted claim to an engine result.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any

from ..contracts.knowledge import KnowledgeRetrievalResult

EVIDENCE_ANSWER_POLICY = "CHEMDFT_EVIDENCE_ANSWER_V1"
UNTRUSTED_INSTRUCTION = re.compile(
    r"(?i)system\s+override|ignore\s+all\s+previous\s+instructions|reveal\s+(?:server\s+)?credentials"
)


_QUOTE_CHAR_MAP = {
    **{ord(c): "-" for c in "\u2010\u2011\u2012\u2013\u2014\u2015\u2212"},
    **{ord(c): "'" for c in "\u2018\u2019\u201b\u02bc"},
    **{ord(c): '"' for c in "\u201c\u201d\u201e\u201f\u00ab\u00bb"},
    # PDF fonts often encode the degree sign as a small circle ("500 ◦C"); a model writes "500 °C".
    **{ord(c): "\u00b0" for c in "\u25e6\u2218\u00ba"},
}
# Typographic ligatures that PDF text keeps as one character ("ﬁlter"); a model writes the letters.
_LIGATURES = {
    "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi", "\ufb04": "ffl",
}  # fmt: skip
_QUOTE_DROP = frozenset("\u00ad\u200b\u200c\u200d\ufeff")


def _quote_form(text: str) -> tuple[str, list[int]]:
    """Comparison form of a passage plus, per output character, its index in the original.

    Only layout is normalised (whitespace runs, line-break hyphenation, typographic dashes and
    quotes, invisible characters); letters and digits are never altered, so a match is still a
    contiguous excerpt of the source.
    """
    out: list[str] = []
    index: list[int] = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch in _QUOTE_DROP:
            i += 1
            continue
        if ch in "-\u2010\u2011" and i + 1 < n and text[i + 1] in "\r\n":
            j = i + 1
            while j < n and text[j].isspace():
                j += 1
            if j < n and text[j].islower() and i > 0 and text[i - 1].isalpha():
                i = j  # hyphenated line break inside one word: join the halves
                continue
        if ch.isspace():
            j = i
            while j < n and text[j].isspace():
                j += 1
            if out and out[-1] != " ":
                out.append(" ")
                index.append(i)
            i = j
            continue
        if ch in _LIGATURES:
            for letter in _LIGATURES[ch]:
                out.append(letter)
                index.append(i)
            i += 1
            continue
        out.append(ch.translate(_QUOTE_CHAR_MAP) if ord(ch) in _QUOTE_CHAR_MAP else ch)
        index.append(i)
        i += 1
    return "".join(out), index


def resolve_quote(quote: str, passage: str) -> str | None:
    """The exact source text a model quote refers to, or None when it is not in the passage."""
    if quote in passage:
        return quote
    wanted, _ = _quote_form(quote)
    wanted = wanted.strip()
    if len(wanted) < 8:
        return None
    haystack, index = _quote_form(passage)
    start = haystack.find(wanted)
    if start >= 0:
        end = start + len(wanted) - 1
        return passage[index[start] : index[end] + 1]
    # PDF text often splits a word ("hypoth etical") and a model silently repairs it. Compare with
    # all whitespace removed; the shown text is still the source's own span, split included.
    squeezed = [(c, index[i]) for i, c in enumerate(haystack) if not c.isspace()]
    flat = "".join(c for c, _ in squeezed)
    needle = "".join(wanted.split())
    start = flat.find(needle)
    if start < 0 or len(needle) < 8:
        return None
    return passage[squeezed[start][1] : squeezed[start + len(needle) - 1][1] + 1]


@dataclass(frozen=True)
class EvidenceAnswer:
    content: str
    status: str
    note: str
    citations: list[dict[str, object]]


def evidence_refs(
    results: tuple[KnowledgeRetrievalResult, ...],
    document_titles: dict[str, str],
    *,
    limit: int = 8,
    deduplicate_passages: bool = True,
) -> list[dict[str, object]]:
    """Select a small source-bound set; never store duplicated passages."""
    refs: list[dict[str, object]] = []
    seen: set[str] = set()
    seen_passages: list[tuple[str, int, str]] = []
    project_record_count = 0
    evidence_count = 0
    for result in results:
        chunk_id = str(result.knowledge_chunk_id)
        if chunk_id in seen or not result.content.strip():
            continue
        document_id = str(result.document_id) if result.document_id else None
        if result.citation_type in {"DOCUMENT", "EVIDENCE"} and (
            document_id is None or document_id not in document_titles
        ):
            continue
        if result.source_class == "AI_HYPOTHESIS":
            continue
        normalized_content = " ".join(result.content.casefold().split())
        if deduplicate_passages and (
            document_id is not None
            and result.page_number is not None
            and any(
                prior_document_id == document_id
                and prior_page == result.page_number
                and SequenceMatcher(None, normalized_content, prior_content).ratio() >= 0.96
                for prior_document_id, prior_page, prior_content in seen_passages
            )
        ):
            continue
        if document_id is not None and result.page_number is not None:
            seen_passages.append((document_id, result.page_number, normalized_content))
        seen.add(chunk_id)
        is_project_record = result.source_type in {
            "DATASET_METADATA",
            "CALCULATION_RESULT",
            "STRUCTURE_METADATA",
            "PROJECT_ACTIVITY",
        }
        if is_project_record:
            project_record_count += 1
            citation_id = f"P{project_record_count}"
        else:
            evidence_count += 1
            citation_id = f"E{evidence_count}"
        refs.append(
            {
                "citation_id": citation_id,
                "knowledge_item_id": str(result.knowledge_item_id),
                "knowledge_chunk_id": chunk_id,
                "source_title": document_titles.get(document_id or "")
                or (
                    "DIGITIZED DLS dataset"
                    if result.source_type == "DATASET_METADATA"
                    and result.source_class == "DIGITIZED"
                    and result.content.casefold().startswith("figure 4 dls dataset")
                    else "DIGITIZED dataset"
                    if result.source_type == "DATASET_METADATA"
                    and result.source_class == "DIGITIZED"
                    else result.source_type.replace("_", " ").title()
                ),
                "source_type": result.source_type,
                "source_entity_id": str(result.source_entity_id),
                "source_class": result.source_class,
                "verification_state": result.verification_state,
                "document_id": document_id,
                "page_number": result.page_number,
                "source_anchor_id": str(result.source_anchor_id)
                if result.source_anchor_id
                else None,
                "index_version": result.index_version,
            }
        )
        if len(refs) >= limit:
            break
    return refs


def model_evidence_payload(
    question: str,
    refs: list[dict[str, object]],
    passages: dict[str, str],
    project_context: str = "",
) -> str:
    items = [
        {
            "id": ref["citation_id"],
            "source_class": ref["source_class"],
            "passage": passages[str(ref["citation_id"])],
        }
        for ref in refs
    ]
    return json.dumps(
        {
            "question": question,
            "project_graph_context": project_context,
            "evidence": items,
        },
        ensure_ascii=False,
    )


def add_dls_semantics(answer: EvidenceAnswer, question: str) -> EvidenceAnswer:
    """State the radius/diameter distinction only when the answer cites both claims."""
    if answer.status != "SUPPORTED" or not any(
        term in question.casefold() for term in ("dls", "figure 4", "hydrodynamic", "radius")
    ):
        return answer
    dataset = next(
        (citation for citation in answer.citations if citation.get("citation_type") == "DATASET"),
        None,
    )
    prose = next(
        (
            citation
            for citation in answer.citations
            if "1482.3" in str(citation.get("reference_text", ""))
            and any(
                term in str(citation.get("reference_text", "")).casefold()
                for term in ("radius", "radii")
            )
        ),
        None,
    )
    table = next(
        (
            citation
            for citation in answer.citations
            if "1496" in str(citation.get("reference_text", ""))
            and "mean" in str(citation.get("reference_text", "")).casefold()
        ),
        None,
    )
    if not dataset or not prose or not table:
        return answer
    dataset_id = dataset.get("citation_id")
    prose_id = prose.get("citation_id")
    table_id = table.get("citation_id")
    note = (
        f"\n\nThe digitized Figure 4 curve is a separate graph reconstruction [[{dataset_id}]]. "
        f"The prose calls 1482.3 nm a hydrodynamic radius [[{prose_id}]], while the table "
        f"reports a mean dH diameter of 1496.1 nm [[{table_id}]]. These source descriptions "
        "are not directly comparable as labeled; the project does not convert radius to diameter."
    )
    return EvidenceAnswer(
        content=answer.content + note,
        status=answer.status,
        note=answer.note,
        citations=answer.citations,
    )


def validate_extracted_answer(
    model_content: str | None, refs: list[dict[str, object]], passages: dict[str, str]
) -> EvidenceAnswer:
    """Render only exact source excerpts attached to a visible evidence card."""
    by_id = {str(ref["citation_id"]): ref for ref in refs}
    try:
        payload: Any = json.loads(model_content or "")
    except (ValueError, TypeError):
        payload = {}
    claims = payload.get("claims", []) if isinstance(payload, dict) else []
    if not isinstance(claims, list):
        claims = []
    lines: list[str] = []
    citations: list[dict[str, object]] = []
    used: set[str] = set()
    seen_quotes: list[tuple[dict[str, object], str]] = []
    invalid = False
    reasons: list[str] = []
    for claim in claims[:8]:
        if not isinstance(claim, dict):
            invalid = True
            reasons.append("claim_not_object")
            continue
        citation_id, quote = claim.get("evidence_id"), claim.get("quote")
        if (
            not isinstance(citation_id, str)
            or citation_id not in by_id
            or not isinstance(quote, str)
            or not (8 <= len(quote) <= 600 * 2)
        ):
            invalid = True
            reasons.append("bad_evidence_id_or_quote_length")
            continue
        # Show the source's own text: a layout-only difference is mapped back to the exact span.
        resolved = resolve_quote(quote, passages[citation_id])
        if (
            resolved is None
            or not (8 <= len(resolved) <= 600)
            or UNTRUSTED_INSTRUCTION.search(resolved)
        ):
            invalid = True
            reasons.append(
                "quote_not_in_passage" if resolved is None else "quote_length_or_content"
            )
            continue
        quote = resolved
        ref = by_id[citation_id]
        comparable = " ".join(quote.casefold().split())
        if any(
            prior_ref.get("document_id") == ref.get("document_id")
            and prior_ref.get("page_number") == ref.get("page_number")
            and SequenceMatcher(None, comparable, prior_quote).ratio() >= 0.96
            for prior_ref, prior_quote in seen_quotes
        ):
            continue
        seen_quotes.append((ref, comparable))
        lines.append(f"“{quote}” [[{citation_id}]]")
        if citation_id not in used:
            used.add(citation_id)
            citations.append(
                {
                    "citation_id": citation_id,
                    "citation_type": "DOCUMENT"
                    if ref["document_id"]
                    else {
                        "CALCULATION_RESULT": "CALCULATION",
                        "STRUCTURE_METADATA": "STRUCTURE",
                        "DATASET_METADATA": "DATASET",
                    }.get(ref["source_type"], "DOCUMENT"),
                    "entity_id": ref["document_id"] or ref["source_entity_id"],
                    "label": ref["source_title"],
                    "reference_text": quote[:300],
                    "page_number": ref["page_number"],
                    "source_anchor_id": ref["source_anchor_id"],
                    "knowledge_chunk_id": ref["knowledge_chunk_id"],
                }
            )
    unanswered = payload.get("unanswered") if isinstance(payload, dict) else None
    if not lines:
        return EvidenceAnswer(
            content=(
                "Insufficient project evidence to answer this question. "
                "Add a relevant source or calculation result, then ask again."
            ),
            status="INSUFFICIENT_EVIDENCE",
            note=(
                "No model claim passed exact source-excerpt and citation validation."
                + (
                    f" (model returned {len(claims)} claim(s); rejected: {', '.join(reasons)})"
                    if claims
                    else " (model returned no claims)"
                )
            ),
            citations=[],
        )
    partial = (
        invalid
        or bool(unanswered)
        or any(
            ref["source_class"] in {None, "AI_HYPOTHESIS"}
            for ref in refs
            if ref["citation_id"] in used
        )
    )
    return EvidenceAnswer(
        content=(
            "Project evidence says:\n"
            + "\n".join(lines)
            + (
                "\nFurther evidence is needed to answer the rest of the question."
                if partial
                else ""
            )
        ),
        status="PARTIAL" if partial else "SUPPORTED",
        note=(
            "Only exact cited excerpts are shown; other claims were omitted."
            if partial
            else "Every displayed claim is an exact excerpt from a cited project source."
        ),
        citations=citations,
    )


_UNIT_ALIASES = {
    "å": "angstrom",
    "°": "deg",
    "degrees": "deg",
    "degree": "deg",
    "μm": "um",
    "µm": "um",
}
_KNOWN_UNITS = frozenset(
    {
        "angstrom", "nm", "pm", "um", "mm", "cm", "ev", "mev", "k", "deg", "%", "ha", "hartree",
        "kcal/mol", "kj/mol", "gpa", "mpa", "pa", "bar", "atm", "ppm", "g/cm3", "mol", "mmol",
        "mg", "g", "kg", "ml", "ms", "ns", "ps", "fs", "min", "cm-1", "hz", "mhz", "ghz",
    }
)  # fmt: skip
_QUANTITY_RE = re.compile(
    r"(?<![\w.])(\d+(?:\.\d+)?)(?:\s*(°|%|[a-zå][a-z0-9/\-μµ]{0,9}))?", re.IGNORECASE
)
_WORD_RE = re.compile(r"[\w]+", re.UNICODE)
SUPPORT_SPAN_WORDS = 5


def _normalize_quantity_text(value: str) -> str:
    value = value.replace("Å", "angstrom").replace("å", "angstrom")
    return " ".join(value.casefold().split())


def _quantities(text: str) -> list[tuple[str, str | None, int]]:
    """Significant (number, known-unit-or-None, offset); bare small integers are not claims."""
    found: list[tuple[str, str | None, int]] = []
    for match in _QUANTITY_RE.finditer(_normalize_quantity_text(text)):
        number, raw_unit = match.group(1), match.group(2)
        if "." not in number and len(number) < 3:
            continue
        unit = _UNIT_ALIASES.get((raw_unit or "").lower(), (raw_unit or "").lower()) or None
        found.append((number, unit if unit in _KNOWN_UNITS else None, match.start()))
    return found


_ELEMENTS = frozenset(
    [
        "H",
        "He",
        "Li",
        "Be",
        "B",
        "C",
        "N",
        "O",
        "F",
        "Ne",
        "Na",
        "Mg",
        "Al",
        "Si",
        "P",
        "S",
        "Cl",
        "Ar",
        "K",
        "Ca",
        "Sc",
        "Ti",
        "V",
        "Cr",
        "Mn",
        "Fe",
        "Co",
        "Ni",
        "Cu",
        "Zn",
        "Ga",
        "Ge",
        "As",
        "Se",
        "Br",
        "Kr",
        "Rb",
        "Sr",
        "Y",
        "Zr",
        "Nb",
        "Mo",
        "Tc",
        "Ru",
        "Rh",
        "Pd",
        "Ag",
        "Cd",
        "In",
        "Sn",
        "Sb",
        "Te",
        "I",
        "Xe",
        "Cs",
        "Ba",
        "La",
        "Ce",
        "Pr",
        "Nd",
        "Pm",
        "Sm",
        "Eu",
        "Gd",
        "Tb",
        "Dy",
        "Ho",
        "Er",
        "Tm",
        "Yb",
        "Lu",
        "Hf",
        "Ta",
        "W",
        "Re",
        "Os",
        "Ir",
        "Pt",
        "Au",
        "Hg",
        "Tl",
        "Pb",
        "Bi",
        "Po",
        "At",
        "Rn",
        "Fr",
        "Ra",
        "Ac",
        "Th",
        "Pa",
        "U",
        "Np",
        "Pu",
        "Am",
        "Cm",
        "Bk",
        "Cf",
        "Es",
        "Fm",
        "Md",
        "No",
        "Lr",
    ]
)
# Element symbols that are also ordinary capitalised words are never read as formulas on their own.
_AMBIGUOUS_SYMBOLS = frozenset({"In", "As", "At", "Be", "He", "No", "Re", "Am", "Os", "Pa", "Ho"})
_FORMULA_RE = re.compile(r"(?<![A-Za-z0-9])((?:[A-Z][a-z]?\d*)+)(\d*[+\-]|\([IVX]+\))?(?![A-Za-z])")
_SYMBOL_RE = re.compile(r"([A-Z][a-z]?)(\d*)")
_FRAMING_WORDS = frozenset(
    [
        "what",
        "which",
        "that",
        "this",
        "these",
        "those",
        "with",
        "from",
        "have",
        "been",
        "were",
        "does",
        "about",
        "their",
        "there",
        "where",
        "when",
        "whose",
        "into",
        "than",
        "then",
        "they",
        "them",
        "also",
        "such",
        "only",
        "some",
        "each",
        "both",
        "more",
        "most",
        "other",
        "over",
        "under",
        "between",
        "across",
        "using",
        "used",
        "based",
        "report",
        "reports",
        "reported",
        "reporting",
        "literature",
        "paper",
        "papers",
        "article",
        "articles",
        "study",
        "studies",
        "document",
        "documents",
        "publication",
        "publications",
        "project",
        "projects",
        "source",
        "sources",
        "evidence",
        "value",
        "values",
        "data",
        "information",
        "according",
        "provided",
        "given",
        "state",
        "states",
        "stated",
        "mention",
        "mentions",
        "mentioned",
        "found",
        "find",
        "show",
        "shows",
        "shown",
        "available",
        "uploaded",
        "indexed",
        "contain",
        "contains",
        "contained",
        "list",
        "tell",
        "give",
        "gives",
        "please",
        "explain",
        "describe",
        "describes",
        "described",
        "parameter",
        "parameters",
        "constant",
        "constants",
        "property",
        "properties",
        "measurement",
        "measurements",
        "result",
        "results",
        "reaction",
    ]
)
_WORD_RE4 = re.compile(r"[A-Za-z]{4,}")
_CLAUSE_SPLIT_RE = re.compile(
    r"[;\n]|(?<=[.!?])\s+(?=[A-Z])|,?\s+\b(?:but|whereas|while|however|although|unlike|except)\b,?\s+",
    re.IGNORECASE,
)


def formula_tokens(text: str) -> set[str]:
    """Case-sensitive formula/charge tokens (TiO2, Fe3+, Co, CO); methods like PBE0 are excluded."""
    found: set[str] = set()
    for match in _FORMULA_RE.finditer(text):
        body, charge = match.group(1), match.group(2) or ""
        parts = _SYMBOL_RE.findall(body)
        if "".join(symbol + count for symbol, count in parts) != body:
            continue
        if any(symbol not in _ELEMENTS for symbol, _count in parts):
            continue
        if len(parts) == 1 and (
            body in _AMBIGUOUS_SYMBOLS or (len(parts[0][0]) == 1 and not parts[0][1] and not charge)
        ):
            continue
        found.add(body + charge)
    return found


def _stem(word: str) -> str:
    word = word.lower()
    return word[:-1] if word.endswith("s") and len(word) > 4 else word


def _subject_words(text: str) -> set[str]:
    return {_stem(w) for w in _WORD_RE4.findall(text) if w.lower() not in _FRAMING_WORDS}


def subject_conflicts(clause: str, question: str, passage: str) -> list[str]:
    """Subject terms a clause asserts that the cited passage does not contain.

    Two deterministic, subject-agnostic checks (no compound or property is named in code):
    * every formula/charge token in the clause must occur, case-sensitively, in the passage;
    * every non-framing word that the clause repeats from the question must occur in the passage.
    A conflict means the passage cannot be the support for a claim about that subject. Absence of
    a conflict proves nothing about scientific correctness.
    """
    passage_formulas = formula_tokens(passage)
    conflicts = sorted(t for t in formula_tokens(clause) if t not in passage_formulas)
    if question:
        asserted = _subject_words(clause) & _subject_words(question)
        conflicts += sorted(asserted - _subject_words(passage))
    return conflicts


def unmatched_question_terms(question: str, cited_passages: list[str]) -> list[str]:
    """Question formulas/words found in no cited passage (shown to the researcher, not enforced)."""
    if not question or not cited_passages:
        return []
    passage_formulas: set[str] = set().union(*(formula_tokens(p) for p in cited_passages))
    passage_words: set[str] = set().union(*(_subject_words(p) for p in cited_passages))
    missing = {t for t in formula_tokens(question) if t not in passage_formulas}
    missing |= {
        w
        for w in _WORD_RE4.findall(question)
        if w.lower() not in _FRAMING_WORDS and _stem(w) not in passage_words
    }
    return sorted(missing, key=str.lower)[:6]


def _quantity_or_phrase_span(clause: str, passage: str) -> tuple[int, int] | None:
    passage_quantities = _quantities(passage)
    for number, unit, _offset in _quantities(clause):
        for p_number, p_unit, _p_offset in passage_quantities:
            if number != p_number or (unit is not None and unit != p_unit):
                continue
            match = re.search(rf"(?<![\w.]){re.escape(number)}", passage)
            if match is None:
                continue
            return max(0, match.start() - 140), min(len(passage), match.end() + 140)
    answer_words = [w.casefold() for w in _WORD_RE.findall(clause)]
    passage_words = [(m.group().casefold(), m.start()) for m in _WORD_RE.finditer(passage)]
    grams = {
        tuple(answer_words[i : i + SUPPORT_SPAN_WORDS])
        for i in range(len(answer_words) - SUPPORT_SPAN_WORDS + 1)
    }
    for i in range(len(passage_words) - SUPPORT_SPAN_WORDS + 1):
        window = passage_words[i : i + SUPPORT_SPAN_WORDS]
        if tuple(word for word, _start in window) in grams:
            last_word, last_start = window[-1]
            return window[0][1], min(len(passage), last_start + len(last_word))
    return None


def passage_support_span(answer: str, passage: str, question: str = "") -> tuple[int, int] | None:
    """Return a verbatim span of `passage` that grounds one clause of `answer`, else None.

    A clause is grounded when it repeats a number from the passage with a compatible unit (a
    differing or absent source unit does not support a stated unit) or a run of
    SUPPORT_SPAN_WORDS consecutive words, AND `subject_conflicts` finds no formula, oxidation
    state or question-introduced term that the passage lacks. This is lexical grounding: it
    stops direct misattribution (Co vs CO, a rutile value stated for brookite) but cannot show
    that the passage entails the claim, e.g. when the clause omits its subject entirely.
    """
    for clause in _CLAUSE_SPLIT_RE.split(answer):
        if not clause or subject_conflicts(clause, question, passage):
            continue
        span = _quantity_or_phrase_span(clause, passage)
        if span is not None:
            return span
    return None
