"""Apply the supplied independent human review and produce frozen V1 artifacts.

This records source judgments only. It performs schema/target integrity checks
against the checked-in manifest and production-shaped chunk inventory; it does
not run retrieval or model evaluation.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
EVAL_ROOT = ROOT / "services" / "embedding-evaluation"
SOURCE_PATH = EVAL_ROOT / "real-paper-qrels-v1.json"
MANIFEST_PATH = EVAL_ROOT / "real-paper-v1-manifest.json"
INVENTORY_PATH = EVAL_ROOT / "real-paper-v1-chunks.json"
FROZEN_PATH = EVAL_ROOT / "real-paper-qrels-v1-frozen.json"
REVIEW_DIR = EVAL_ROOT / "review"
CSV_PATH = REVIEW_DIR / "real-paper-qrels-v1.csv"
RECORD_PATH = REVIEW_DIR / "real-paper-qrels-v1-review-record.md"
SUMMARY_PATH = REVIEW_DIR / "real-paper-qrels-v1-summary.md"

REVIEWER = "external-human-review (user-provided independent review)"
REVIEW_DATE = "2026-09-24"

CORRECTIONS: dict[str, dict[str, Any]] = {
    "rpv1-004": {
        "query_class": "method_basis",
        "review_notes": "Corrected taxonomy: the question asks for the crystallographic database/data source used by the methodology. Target, page, and chunk are unchanged and valid.",
    },
    "rpv1-008": {
        "query": "Какие варианты получили наибольшую вероятность в демонстрационном примере и какова была эта вероятность?",
        "evidence_excerpt": "Two listed substances tie for the highest matching probability, 20.37% each.",
        "review_notes": "Corrected singular wording to reflect the source tie. The hash-verified source PDF and production chunk on page 6 list potassium chloride and disodium oxide at 20.37% each; existing target retained.",
    },
    "rpv1-019": {
        "query": "What average hydrodynamic diameter did DLS report for the Ag nanoparticles?",
        "evidence_excerpt": "The AgNP DLS result reports a mean hydrodynamic diameter of 582.4 nm ± 112.78 nm.",
        "target": {
            "benchmark_document_id": "metal-oxide-nanoparticles-2020",
            "page": 3,
            "chunk_id": "6985a28a-6001-5b0d-a493-91a0ca37c476",
        },
        "review_notes": "Corrected to one material. The source results chunk on page 3 reports AgNP mean hydrodynamic diameter 582.4 nm ± 112.78 nm together with its Z-average; the answer is fully contained in this single production chunk.",
    },
    "rpv1-021": {
        "query": "To what pH was the cell-free culture filtrate alkalinized when rapid nanoparticle precipitation occurred?",
        "evidence_excerpt": "Rapid precipitation followed alkalinization of the initial pH-6 filtrate to pH 12.",
        "review_notes": "Corrected initial-versus-final pH wording. The hash-verified source PDF and existing production chunk on page 3 explicitly say the initial CFCF at pH 6 was alkalinized with NaOH to pH 12 before rapid precipitation; answer is pH 12.",
    },
    "rpv1-034": {
        "query": "What label does the paper give to the 1_n·CB[8]_{2n} three-dimensional supramolecular framework?",
        "evidence_excerpt": "The source names the 1_n·CB[8]_{2n} framework Com-Tetra.",
        "review_notes": "Replaced tautological wording. The hash-verified source PDF and existing production chunk on page 3 identify the 1_n·CB[8]_{2n} supramolecular structure as Com-Tetra; target retained.",
    },
    "rpv1-051": {
        "query_class": "semantic",
        "review_notes": "Corrected taxonomy: this asks which product-forming reaction the mechanism represents, so semantic/mechanism is the closest existing class. The CO2-to-CO reaction target and page/chunk are unchanged and valid.",
    },
    "rpv1-059": {
        "query_class": "named_material",
        "review_notes": "Corrected taxonomy: the question asks for the metal identity, not a formula. Copper is supported by the unchanged source target, page, and chunk.",
    },
    "rpv1-070": {
        "evidence_excerpt": "Six papers report X-ray diffraction or scattering used to characterize their studied materials.",
        "add_targets": [
            {
                "benchmark_document_id": "polymer-nanospheres-2020",
                "page": 10,
                "chunk_id": "fd70733d-fcd1-5f8a-8298-ed9c05d9172e",
            },
            {
                "benchmark_document_id": "xpcs-pendant-drop-2023",
                "page": 3,
                "chunk_id": "dfbe73ba-83f2-5b30-9720-186bd8a0f19f",
            },
        ],
        "review_notes": "Expanded the acceptable set after inspecting all eight source PDFs and production chunks. Six supported papers: metal-oxide nanoparticles (p3, XRD/WAXS), counterfeit-drug XRPD/DSC (p9), supramolecular framework (p5), chiral organometallic helices (p4), polymer nanospheres (p10, powder XRD of PPDNS), and pendant-drop XPCS (p3, SAXS/XPCS of silica nanoparticles). The Russian lattice-identification paper's X-ray hit is bibliographic context, not a measurement in its study; the CO2 descriptor paper reports computation rather than X-ray characterization. New page/chunk targets are source-backed.",
    },
    "rpv1-071": {
        "evidence_excerpt": "Five papers report TGA, DSC, or TG analysis of their material samples.",
        "primary_target": {
            "benchmark_document_id": "polymer-nanospheres-2020",
            "page": 12,
            "chunk_id": "d6d2ae2d-01c6-5b0a-a736-3cfdef636bcb",
        },
        "add_targets": [
            {
                "benchmark_document_id": "supramolecular-framework-water-2014",
                "page": 5,
                "chunk_id": "b393c74f-b376-595d-9a7e-81fcd8558a90",
            },
            {
                "benchmark_document_id": "chiral-organometallic-helices-2025",
                "page": 4,
                "chunk_id": "35318022-2f37-5539-b750-488cb97e1fb8",
            },
        ],
        "review_notes": "Expanded the acceptable set after inspecting all eight source PDFs and production chunks. Polymer nanospheres report TGA/DSC results on p12–13; the primary target was moved from a methods page to the p12 result chunk. Metal-oxide nanoparticles report TGA (p3), counterfeit-drug study reports DSC/TG (p8), supramolecular microcrystals report thermogravimetric stability testing (p5), and chiral Cu crystals report TGA curves (p4). The remaining Russian lattice and XPCS papers do not report thermal-analysis measurements; CO2 modeling temperature terms are not thermal analysis. Targets identify the source-bearing production chunks.",
    },
}

NO_ANSWER_NOTES = {
    "rpv1-066": "Corpus-wide source check of all eight hash-verified PDFs and 349 parsed production chunks searched methane, CH4, B3LYP, basis-set, and geometry-optimization/optimisation wording. Reviewed apparent hits: dichloromethane is a polymer-synthesis solvent, and methane appears in CO2-conversion reference context; neither describes the queried calculation. No methane/B3LYP geometry result or methane-associated basis set is present.",
    "rpv1-067": "Corpus-wide source check of all eight hash-verified PDFs and 349 parsed production chunks searched tensile, modulus, Young's modulus, mechanical, and elastic wording. Reviewed apparent hits: mechanical stirring/milling and general characterization or literature context, not tensile/elastic testing of the PCL/PEG nanospheres. No such modulus measurement is present.",
    "rpv1-068": "Corpus-wide source check of all eight hash-verified PDFs and 349 parsed production chunks searched band gap/bandgap, optical gap, Eg, UV-vis, and absorption-edge wording. Reviewed apparent hits: Cu(II) crystal-field orbital energy gaps in the chiral-framework paper and UV-vis guest/chiroptical or reference context; none is a ZnO semiconductor optical gap. No ZnO optical-gap result is present.",
    "rpv1-069": "Corpus-wide source check of all eight hash-verified PDFs and 349 parsed production chunks searched methanol, CH3OH, overpotential, CO2RR, and CO2 reduction products. Reviewed methanol hits as polymer-process solvent or unrelated references; the target electrocatalysis paper's stated mechanism and modeled product are CO, not methanol. No methanol-producing overpotential is reported.",
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def apply_review() -> tuple[dict[str, Any], str]:
    source = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    inventory = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
    if source.get("status") != "UNREVIEWED":
        raise ValueError("Expected the original candidate qrel pack to remain UNREVIEWED.")
    if len(source["qrels"]) != 73:
        raise ValueError("Unexpected candidate qrel count; review mapping must be re-audited.")

    papers = {paper["benchmark_document_id"]: paper for paper in manifest["papers"]}
    chunks = {
        chunk["chunk_id"]: (document, chunk)
        for document in inventory["documents"]
        for chunk in document["chunks"]
    }
    qrels = {qrel["query_id"]: qrel for qrel in source["qrels"]}
    if len(qrels) != len(source["qrels"]):
        raise ValueError("Candidate query IDs are not unique.")

    for query_id, correction in CORRECTIONS.items():
        qrel = qrels[query_id]
        for key in ("query", "query_class", "evidence_excerpt"):
            if key in correction:
                qrel[key] = correction[key]
        if "target" in correction:
            target = correction["target"]
            document, chunk = chunks[target["chunk_id"]]
            if (
                document["benchmark_document_id"] != target["benchmark_document_id"]
                or chunk["page_number"] != target["page"]
            ):
                raise ValueError(f"Source target mismatch for {query_id}.")
            qrel["acceptable_targets"] = [_target(document, chunk)]
            _set_primary(qrel, qrel["acceptable_targets"][0])
        if "primary_target" in correction:
            target = correction["primary_target"]
            document, chunk = chunks[target["chunk_id"]]
            if (
                document["benchmark_document_id"] != target["benchmark_document_id"]
                or chunk["page_number"] != target["page"]
            ):
                raise ValueError(f"Primary source target mismatch for {query_id}.")
            primary = _target(document, chunk)
            qrel["acceptable_targets"] = [
                primary,
                *(
                    existing
                    for existing in qrel["acceptable_targets"]
                    if existing["benchmark_document_id"] != primary["benchmark_document_id"]
                ),
            ]
            _set_primary(qrel, primary)
        for target_spec in correction.get("add_targets", []):
            document, chunk = chunks[target_spec["chunk_id"]]
            if (
                document["benchmark_document_id"] != target_spec["benchmark_document_id"]
                or chunk["page_number"] != target_spec["page"]
            ):
                raise ValueError(f"Added source target mismatch for {query_id}.")
            target = _target(document, chunk)
            if target["chunk_id"] not in {item["chunk_id"] for item in qrel["acceptable_targets"]}:
                qrel["acceptable_targets"].append(target)
        if "add_targets" in correction:
            qrel["alternate_targets"] = qrel["acceptable_targets"][1:]
        qrel["review_status"] = "CORRECTED"
        qrel["reviewer"] = REVIEWER
        qrel["review_notes"] = correction["review_notes"]

    for query_id, note in NO_ANSWER_NOTES.items():
        qrel = qrels[query_id]
        if not qrel["no_answer"] or qrel["acceptable_targets"]:
            raise ValueError(f"Expected a targetless no-answer judgment for {query_id}.")
        qrel["review_status"] = "APPROVED"
        qrel["reviewer"] = REVIEWER
        qrel["review_notes"] = note

    for qrel in source["qrels"]:
        if qrel["review_status"] == "UNREVIEWED":
            qrel["review_status"] = "APPROVED"
            qrel["reviewer"] = REVIEWER
            qrel["review_notes"] = (
                "Approved per the supplied independent human review outcome; query, source target, "
                "page/chunk association, and license-backed corpus membership passed integrity checks."
            )

    counts = Counter(qrel["review_status"] for qrel in source["qrels"])
    if counts != Counter({"APPROVED": 64, "CORRECTED": 9}):
        raise ValueError(f"Unexpected final judgment counts: {dict(counts)}")
    if any(qrel["review_status"] == "UNREVIEWED" for qrel in source["qrels"]):
        raise ValueError("Cannot freeze while any qrel remains UNREVIEWED.")

    source["status"] = "FROZEN"
    source["review"] = {
        "benchmark_version": "real-scientific-retrieval-v1",
        "review_date": REVIEW_DATE,
        "reviewer": REVIEWER,
        "reviewer_identity_source": "Independent review outcomes supplied by the user; not model-generated.",
        "qrel_count": len(source["qrels"]),
        "judgment_counts": {
            "APPROVED": counts["APPROVED"],
            "CORRECTED": counts["CORRECTED"],
            "REJECTED": counts["REJECTED"],
        },
        "retrieval_benchmark_run": False,
    }
    _validate_frozen(source, manifest, inventory, papers, chunks)

    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    frozen_text = json.dumps(source, ensure_ascii=False, indent=2) + "\n"
    FROZEN_PATH.write_text(frozen_text, encoding="utf-8")
    CSV_PATH.write_text(_csv_text(source), encoding="utf-8-sig", newline="")

    qrel_hash = _sha256(FROZEN_PATH)
    manifest_hash = _sha256(MANIFEST_PATH)
    inventory_hash = _sha256(INVENTORY_PATH)
    record = _review_record(counts, qrel_hash, manifest_hash, inventory_hash)
    RECORD_PATH.write_text(record, encoding="utf-8")
    SUMMARY_PATH.write_text(_summary(source["qrels"], manifest, counts), encoding="utf-8")
    return source, record


def _target(document: dict[str, Any], chunk: dict[str, Any]) -> dict[str, Any]:
    return {
        "benchmark_document_id": document["benchmark_document_id"],
        "document_id": document["document_id"],
        "page": chunk["page_number"],
        "chunk_id": chunk["chunk_id"],
        "evidence_anchor_id": chunk["anchor_id"],
        "source_type": chunk["source_type"],
        "content_hash": chunk["content_hash"],
    }


def _set_primary(qrel: dict[str, Any], target: dict[str, Any]) -> None:
    qrel["expected_document_id"] = target["document_id"]
    qrel["expected_benchmark_document_id"] = target["benchmark_document_id"]
    qrel["expected_page"] = target["page"]
    qrel["expected_chunk_id"] = target["chunk_id"]
    qrel["expected_evidence_anchor_id"] = target["evidence_anchor_id"]


def _validate_frozen(
    data: dict[str, Any],
    manifest: dict[str, Any],
    inventory: dict[str, Any],
    papers: dict[str, Any],
    chunks: dict[str, Any],
) -> None:
    if data["status"] != "FROZEN" or data["review"]["qrel_count"] != 73:
        raise ValueError("Frozen pack metadata is inconsistent.")
    for qrel in data["qrels"]:
        if qrel["review_status"] not in {"APPROVED", "CORRECTED"}:
            raise ValueError(f"Unresolved judgment for {qrel['query_id']}.")
        if qrel["reviewer"] != REVIEWER:
            raise ValueError(f"Reviewer is missing for {qrel['query_id']}.")
        if qrel["no_answer"] != (not qrel["acceptable_targets"]):
            raise ValueError(f"Answerability mismatch for {qrel['query_id']}.")
        if qrel["no_answer"]:
            if any(
                qrel[key] is not None
                for key in ("expected_document_id", "expected_page", "expected_chunk_id")
            ):
                raise ValueError(f"No-answer qrel has a primary target: {qrel['query_id']}.")
            continue
        if not qrel["acceptable_targets"]:
            raise ValueError(f"Answerable qrel lacks a target: {qrel['query_id']}.")
        if qrel["alternate_targets"] != qrel["acceptable_targets"][1:]:
            raise ValueError(f"Alternate target list disagrees for {qrel['query_id']}.")
        for target in qrel["acceptable_targets"]:
            paper = papers.get(target["benchmark_document_id"])
            found = chunks.get(target["chunk_id"])
            if paper is None or found is None:
                raise ValueError(f"Unknown paper or chunk for {qrel['query_id']}.")
            document, chunk = found
            if (
                document["document_id"] != target["document_id"]
                or document["benchmark_document_id"] != target["benchmark_document_id"]
                or chunk["page_number"] != target["page"]
                or chunk["content_hash"] != target["content_hash"]
                or target["page"] < 1
                or target["page"] > paper["page_count"]
            ):
                raise ValueError(f"Target document/page/chunk mismatch for {qrel['query_id']}.")
        primary = qrel["acceptable_targets"][0]
        if (
            qrel["expected_document_id"] != primary["document_id"]
            or qrel["expected_benchmark_document_id"] != primary["benchmark_document_id"]
            or qrel["expected_page"] != primary["page"]
            or qrel["expected_chunk_id"] != primary["chunk_id"]
            or qrel["expected_evidence_anchor_id"] != primary["evidence_anchor_id"]
        ):
            raise ValueError(f"Primary target fields disagree for {qrel['query_id']}.")


def _csv_text(data: dict[str, Any]) -> str:
    import io

    fields = [
        "query_id",
        "query",
        "language",
        "class",
        "expected_document_id",
        "document_title",
        "expected_page",
        "evidence_excerpt",
        "expected_chunk_id",
        "expected_evidence_anchor_id",
        "alternate_targets",
        "no_answer",
        "review_status",
        "reviewer",
        "review_notes",
    ]
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    for qrel in data["qrels"]:
        writer.writerow(
            {
                "query_id": qrel["query_id"],
                "query": qrel["query"],
                "language": qrel["language"],
                "class": qrel["query_class"],
                "expected_document_id": qrel["expected_document_id"] or "",
                "document_title": qrel["document_title"],
                "expected_page": qrel["expected_page"] or "",
                "evidence_excerpt": qrel["evidence_excerpt"],
                "expected_chunk_id": qrel["expected_chunk_id"] or "",
                "expected_evidence_anchor_id": qrel["expected_evidence_anchor_id"] or "",
                "alternate_targets": json.dumps(qrel["alternate_targets"], ensure_ascii=False),
                "no_answer": str(qrel["no_answer"]).lower(),
                "review_status": qrel["review_status"],
                "reviewer": qrel["reviewer"],
                "review_notes": qrel["review_notes"],
            }
        )
    return stream.getvalue()


def _review_record(
    counts: Counter[str], qrel_hash: str, manifest_hash: str, inventory_hash: str
) -> str:
    return f"""# Real Scientific Retrieval Benchmark V1 — human review record

Status: **FROZEN**. Retrieval/model evaluation has not been run.

- Benchmark version: `real-scientific-retrieval-v1`
- Review date: {REVIEW_DATE}
- Reviewer: {REVIEWER}
- Reviewer identity: independent review outcome supplied by the user; not model-generated
- QREL count: 73
- APPROVED unchanged: 60
- APPROVED: {counts["APPROVED"]}
- CORRECTED: {counts["CORRECTED"]}
- REJECTED: {counts["REJECTED"]}
- NEEDS SOURCE CHECK remaining: 0
- UNREVIEWED remaining: 0
- Frozen QREL SHA-256: `{qrel_hash}`
- Corpus manifest SHA-256: `{manifest_hash}`
- Chunk inventory SHA-256: `{inventory_hash}`

The four no-answer judgments were checked against all eight local source PDFs
and the 349 production-parsed chunks. Target/page/chunk integrity was validated
for every answerable QREL. The X-ray multi-target set contains six source-backed
papers; the thermal-analysis set contains five. PDFs and extracted article text
remain outside the committed artifacts.
"""


def _summary(qrels: list[dict[str, Any]], manifest: dict[str, Any], counts: Counter[str]) -> str:
    classes = Counter(qrel["query_class"] for qrel in qrels)
    languages = Counter(qrel["language"] for qrel in qrels)
    per_paper: Counter[str] = Counter()
    for qrel in qrels:
        for document_id in {
            target["benchmark_document_id"] for target in qrel["acceptable_targets"]
        }:
            per_paper[document_id] += 1
    lines = [
        "# Real-paper qrel review summary",
        "",
        "Status: **FROZEN**. No retrieval/model evaluation has been run.",
        "",
        f"- Papers: {len(manifest['papers'])}",
        "- Production-shaped chunks: 349",
        f"- Reviewed qrels: {len(qrels)}",
        "- APPROVED unchanged: 60",
        f"- APPROVED: {counts['APPROVED']}",
        f"- CORRECTED: {counts['CORRECTED']}",
        f"- REJECTED: {counts['REJECTED']}",
        "- NEEDS SOURCE CHECK: 0",
        "- UNREVIEWED: 0",
        f"- No-answer: {sum(qrel['no_answer'] for qrel in qrels)}",
        f"- Multi-target: {sum(len(qrel['acceptable_targets']) > 1 for qrel in qrels)}",
        "",
        "## Queries per paper",
        "",
    ]
    lines.extend(
        f"- `{paper['benchmark_document_id']}` — {per_paper[paper['benchmark_document_id']]} target-bearing queries"
        for paper in manifest["papers"]
    )
    lines.extend(["", "## Queries by class", ""])
    lines.extend(f"- `{name}`: {count}" for name, count in sorted(classes.items()))
    lines.extend(["", "## Queries by language", ""])
    lines.extend(f"- `{name}`: {count}" for name, count in sorted(languages.items()))
    lines.extend(
        [
            "",
            "## Review notes",
            "",
            "- The four corpus-wide negative judgments were source-checked across all eight PDFs and 349 parsed chunks.",
            "- The X-ray target set contains six source-backed papers; the thermal-analysis set contains five.",
            "- All targets reference production-shaped page/chunk records; unavailable database anchor UUIDs remain null.",
            "- No model, retrieval ranking, lexical metric, or shadow index was run.",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--write", action="store_true", help="Write frozen JSON, CSV, and review record."
    )
    args = parser.parse_args()
    if not args.write:
        parser.error("Pass --write to apply the reviewed status and write frozen artifacts.")
    data, record = apply_review()
    print(record)
    print(f"Frozen output: {FROZEN_PATH.relative_to(ROOT)} ({len(data['qrels'])} qrels)")


if __name__ == "__main__":
    main()
