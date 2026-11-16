# ruff: noqa: E501
"""The citation block of the exports: the calculation citation (APA + BibTeX) and the ChemDFT software citation.

One definition of the TEXT lives in the web app (apps/web/src/lib/citation.ts and calculation-citation.ts, which the Cite panel
shows). The exporters cannot call TypeScript, so this module is the Python builder of the same text, and
``tests/fixtures/contracts/citation_parity.json`` is the shared golden record: ``apps/web/tests/citation-parity.test.ts`` and
``tests/test_citation_block.py`` both build every case from the same facts and must produce the same expected text.
Change the wording in ONE place and the other side's parity test fails until it follows.

The software metadata (title, version, authors, ORCID, website URL, licence, DOI) is read from ``data/software_citation.json``,
which the web app imports too. A DOI is printed only when that file carries one. Missing facts stay missing: nothing is invented.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .contracts.scientific import StructureKind
from .scientific_models import (
    CalculationInputRecord,
    CalculationResultRecord,
    ComputeJobRecord,
    ProvenanceRecordRow,
    ScientificArtifactRecord,
    StructureRecord,
    StructureVersionRecord,
)

SOFTWARE_CITATION_PATH = Path(__file__).resolve().parent / "data" / "software_citation.json"
THIRD_PARTY_CITATIONS_PATH = (
    Path(__file__).resolve().parent / "data" / "third_party_citations.json"
)
SITE_URL = "https://chemdft.com"
NO_DOI_NOTE = "No DOI yet and no public link: this is a private record in ChemDFT, identified by the calculation ID in the citation."
SOFTWARE_NO_DOI_NOTE = "ChemDFT has no DOI yet."
ZENODO_SNAPSHOT_NOTE = "The Zenodo record is an archival snapshot of the open-core parts only; proprietary components are not included."

TASK_LABEL = {
    "ENERGY": "Single-point energy",
    "GEOMETRY_OPTIMIZATION": "Geometry optimization",
    "FREQUENCY": "Vibrational frequencies",
    "ORBITAL": "Molecular orbitals",
    "TDDFT": "TDDFT excited states",
    "THERMOCHEMISTRY": "Thermochemistry",
    "CONFORMER_SEARCH": "Conformer search",
    "PERIODIC_ENERGY": "Periodic single-point energy",
}


def software_metadata() -> dict[str, Any]:
    return json.loads(SOFTWARE_CITATION_PATH.read_text(encoding="utf-8"))


def _doi_url(doi: str) -> str:
    return f"https://doi.org/{doi}"


# ---------------------------------------------------------------- software citation (mirror of apps/web/src/lib/citation.ts)


def software_apa(meta: dict[str, Any] | None = None) -> str:
    meta = meta or software_metadata()
    primary = meta["authors"][0] if meta["authors"] else None
    author = f"{primary['family_names']}, {primary['given_names']}" if primary else meta["title"]
    orcid = primary.get("orcid") if primary else None
    doi = f" {_doi_url(meta['doi'])}" if meta.get("doi") else ""
    suffix = f" (ORCID: {orcid})" if orcid else ""
    return f"{author}. ({meta['date_released'][:4]}). {meta['title']} (Version {meta['version']}) [Computer software]. {meta['url']}{doi}{suffix}"


def software_bibtex(meta: dict[str, Any] | None = None) -> str:
    meta = meta or software_metadata()
    author = " and ".join(f"{a['family_names']}, {a['given_names']}" for a in meta["authors"])
    orcid = next((a["orcid"] for a in meta["authors"] if a.get("orcid")), None)
    lines = [
        "@software{chemdft,",
        f"  author = {{{author}}},",
        f"  title = {{{meta['title']}}},",
        f"  version = {{{meta['version']}}},",
        f"  year = {{{meta['date_released'][:4]}}},",
    ]
    if meta.get("doi"):
        lines.append(f"  doi = {{{meta['doi']}}},")
    lines.append(f"  url = {{{meta['url']}}},")
    if orcid:
        lines.append(f"  note = {{ORCID: {orcid}}}")
    lines.append("}")
    return "\n".join(lines)


def _find_newest_archived_version(meta: dict[str, Any]) -> str | None:
    versions: list[str] = []
    for key, value in meta.items():
        if key.startswith("snapshot_") and key.endswith("_version_doi") and isinstance(value, str) and value:
            v_str = key[len("snapshot_") : -len("_version_doi")].replace("_", ".")
            versions.append(v_str)
    if not versions:
        return None

    def v_key(v: str) -> tuple[int, ...]:
        return tuple(int(p) for p in v.split(".") if p.isdigit())

    versions.sort(key=v_key)
    return versions[-1]


def version_precision_note(
    version: str | None = None,
    meta: dict[str, Any] | None = None,
) -> str | None:
    """Statement clarifying version precision when an app version has no archived Zenodo version DOI."""
    meta = meta or software_metadata()
    v = version or meta.get("version", "")
    v_key = f"snapshot_{v.replace('.', '_')}_version_doi"
    if meta.get(v_key):
        return None
    concept_doi = meta.get("doi")
    if concept_doi:
        newest = _find_newest_archived_version(meta)
        newest_suffix = f" (newest archived version: {newest})" if newest else ""
        return (
            f"Version {v} has no archived Zenodo version DOI yet; "
            f"citing the all-versions concept DOI {concept_doi}{newest_suffix}"
        )
    return None


# ---------------------------------------------------------------- calculation citation (mirror of calculation-citation.ts)


@dataclass(frozen=True)
class CalculationFacts:
    calculation_id: str
    job_id: str | None
    year: int | None
    task: str
    method: str
    basis: str | None
    input_sha256: str
    engine_name: str | None
    engine_version: str | None
    app_version: str
    software_doi: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CalculationFacts:
        return cls(
            calculation_id=data["calculationId"],
            job_id=data.get("jobId"),
            year=data.get("year"),
            task=data["task"],
            method=data["method"],
            basis=data.get("basis"),
            input_sha256=data["inputSha256"],
            engine_name=data.get("engineName"),
            engine_version=data.get("engineVersion"),
            app_version=data["appVersion"],
            software_doi=data.get("softwareDoi"),
        )


def _bib_escape(value: str) -> str:
    return re.sub(r"([&%$#_{}])", r"\\\1", value)


def citation_title(facts: CalculationFacts) -> str:
    level = f"{facts.method}/{facts.basis}" if facts.basis else facts.method
    return f"ChemDFT calculation {facts.calculation_id}: {facts.task.lower()} at {level}"


def note_lines(facts: CalculationFacts) -> list[str]:
    lines = [f"Calculation {facts.calculation_id}"]
    if facts.job_id:
        lines.append(f"job {facts.job_id}")
    lines.append(f"input SHA-256 {facts.input_sha256}")
    if facts.engine_name:
        lines.append(f"{facts.engine_name} {facts.engine_version}")
    lines.append(f"ChemDFT {facts.app_version}")
    if facts.software_doi:
        lines.append(f"software DOI {_doi_url(facts.software_doi)}")
    return lines


def calculation_apa(facts: CalculationFacts) -> str:
    year = facts.year if facts.year is not None else "n.d."
    return (
        f"ChemDFT. ({year}). {citation_title(facts)} [Computational chemistry calculation record]. "
        f"ChemDFT (Version {facts.app_version}). {SITE_URL} ({'; '.join(note_lines(facts)[:3])})"
    )


def calculation_bibtex(facts: CalculationFacts) -> str:
    key = facts.calculation_id.replace("-", "")[:12]
    lines = [f"@misc{{chemdft_calculation_{key},", "  organization = {ChemDFT},", f"  title = {{{_bib_escape(citation_title(facts))}}},"]
    if facts.year is not None:
        lines.append(f"  year = {{{facts.year}}},")
    lines.append(f"  howpublished = {{ChemDFT {facts.app_version}, {SITE_URL}}},")
    lines.append(f"  note = {{{_bib_escape('; '.join(note_lines(facts)))}}}")
    lines.append("}")
    return "\n".join(lines)


def methods_paragraph(facts: CalculationFacts) -> str:
    level = (
        f"the {facts.method} method with the {facts.basis} basis set"
        if facts.basis
        else f"the {facts.method} method"
    )
    structure = f"an immutable structure input with input SHA-256 {facts.input_sha256}"
    engine = f"{facts.engine_name} {facts.engine_version}" if facts.engine_name else "not recorded"
    job_part = f" (job {facts.job_id})" if facts.job_id else ""
    return (
        f"The {facts.task.lower()} calculation used {level} on {structure}. "
        f"It was run with {engine} as ChemDFT {facts.app_version} calculation "
        f"{facts.calculation_id}{job_part}. "
        "All values are the ones ChemDFT stored from the engine; none were edited. "
        "The ChemDFT citation and the engine references below should be cited with this calculation."
    )


# ---------------------------------------------------------------- facts from the stored records


def _display(value: Any) -> str | None:
    if isinstance(value, dict):
        text = value.get("display_name") or value.get("identifier")
        return str(text) if text else None
    return None


def project_calculation_facts(session: Session, project_id: str) -> list[CalculationFacts]:
    """One entry per calculation of the project that has a published result (its newest), oldest calculation first.

    Everything comes from the stored records; a fact the record does not carry stays missing (no engine line, no job line).
    """
    results = session.scalars(
        select(CalculationResultRecord)
        .where(CalculationResultRecord.project_id == project_id)
        .order_by(CalculationResultRecord.created_at.asc(), CalculationResultRecord.id.asc())
    ).all()
    newest: dict[str, CalculationResultRecord] = {}
    for record in results:
        newest[record.calculation_id] = record
    facts: list[CalculationFacts] = []
    app_version = software_metadata()["version"]
    for calculation_id, record in newest.items():
        calc_input = session.scalar(
            select(CalculationInputRecord).where(
                CalculationInputRecord.id == record.calculation_input_id,
                CalculationInputRecord.project_id == project_id,
            )
        )
        if calc_input is None:
            continue
        spec = calc_input.specification_json or {}
        method = _display(spec.get("method"))
        if not method:
            continue
        artifact = session.scalar(
            select(ScientificArtifactRecord).where(
                ScientificArtifactRecord.id == calc_input.normalized_input_artifact_id,
                ScientificArtifactRecord.project_id == project_id,
            )
        )
        if artifact is None:
            continue
        job = session.scalar(
            select(ComputeJobRecord)
            .where(ComputeJobRecord.project_id == project_id, ComputeJobRecord.calculation_id == calculation_id)
            .order_by(ComputeJobRecord.created_at.desc())
        )
        producer = record.producer_software_json or {}
        created: datetime = record.created_at
        task = str(spec.get("task_type", ""))
        facts.append(
            CalculationFacts(
                calculation_id=calculation_id,
                job_id=job.id if job else None,
                year=created.year,
                task=TASK_LABEL.get(task, task),
                method=method,
                basis=_display(spec.get("basis")),
                input_sha256=artifact.sha256,
                engine_name=str(producer["name"]) if producer.get("name") else None,
                engine_version=str(producer["version"]) if producer.get("version") else None,
                app_version=app_version,
                software_doi=software_metadata().get("doi"),
            )
        )
    return facts


def third_party_citations() -> dict[str, Any]:
    return json.loads(THIRD_PARTY_CITATIONS_PATH.read_text(encoding="utf-8"))


QE_LIBRARY_KEYS = {
    "gbrv": "gbrv",
    "pslibrary-0": "pslibrary0",
    "pslibrary-1": "pslibrary1",
    "jth": "jth",
    "spms": "spms",
    "sg15": "sg15",
    "pseudodojo": "pseudodojo",
    "tw14": "tw14",
}


def qe_citation_keys(payload: dict[str, Any]) -> list[str]:
    """Registry keys that a Quantum ESPRESSO periodic result obliges the researcher to cite (see third_party_citations.json)."""
    keys = ["qe", "qe2009", "qe2020", "pbe", "sssp_library", "prandini2018"]
    if payload.get("u_effective_ev"):
        keys += ["dudarev1998", "timrov2020"]
        if payload.get("used_default_u"):
            keys.append("jain2011")
    if payload.get("local_magnetic_moments"):
        keys.append("lowdin1950")
    for library in sorted(set((payload.get("pseudopotential_libraries") or {}).values())):
        if library in QE_LIBRARY_KEYS:
            keys.append(QE_LIBRARY_KEYS[library])
    return keys


def detect_project_tools(session: Session, project_id: str) -> list[str]:
    """Detects third-party scientific tools actually used in a project."""
    tools: list[str] = []

    structures = session.scalars(
        select(StructureRecord).where(StructureRecord.project_id == project_id)
    ).all()
    for s in structures:
        if (s.kind == StructureKind.PERIODIC or str(s.kind) == "PERIODIC") and "pymatgen" not in tools:
            tools.append("pymatgen")

    versions = session.scalars(
        select(StructureVersionRecord).where(StructureVersionRecord.project_id == project_id)
    ).all()
    for v in versions:
        if v.periodic_cell_json and "pymatgen" not in tools:
            tools.append("pymatgen")
        rep = v.representation_json or {}
        if rep.get("cif_source_reference") and "pymatgen" not in tools:
            tools.append("pymatgen")
        prov_id = v.provenance_record_id
        if prov_id:
            prov = session.get(ProvenanceRecordRow, prov_id)
            if prov and prov.parameters_json:
                for p in prov.parameters_json:
                    if isinstance(p, dict):
                        if (
                            p.get("key") == "format"
                            and str(p.get("value")).upper() == "CIF"
                            and "pymatgen" not in tools
                        ):
                            tools.append("pymatgen")
                        if (
                            p.get("key") == "parser"
                            and "pymatgen" in str(p.get("value")).lower()
                            and "pymatgen" not in tools
                        ):
                            tools.append("pymatgen")
                        if (
                            p.get("key") == "parser"
                            and "rdkit" in str(p.get("value")).lower()
                            and "rdkit" not in tools
                        ):
                            tools.append("rdkit")

    results = session.scalars(
        select(CalculationResultRecord).where(CalculationResultRecord.project_id == project_id)
    ).all()
    for r in results:
        producer = r.producer_software_json or {}
        p_name = str(producer.get("name", "")).lower()
        if "pyscf" in p_name and "pyscf" not in tools:
            tools.append("pyscf")
        if "xtb" in p_name and "xtb" not in tools:
            tools.append("xtb")
        if "crest" in p_name and "crest" not in tools:
            tools.append("crest")
        if "geometric" in p_name and "geometric" not in tools:
            tools.append("geometric")
        if ("dftd4" in p_name or "d4" in p_name) and "dftd4" not in tools:
            tools.append("dftd4")

        payload = r.payload_json or {}
        if payload.get("engine") == "qe":
            for key in qe_citation_keys(payload):
                if key not in tools:
                    tools.append(key)

    calc_inputs = session.scalars(
        select(CalculationInputRecord).where(CalculationInputRecord.project_id == project_id)
    ).all()
    for ci in calc_inputs:
        spec = ci.specification_json or {}
        eng = (spec.get("engine_preference") or {}).get("engine", "").lower()
        if eng == "pyscf" and "pyscf" not in tools:
            tools.append("pyscf")
        if eng == "xtb" and "xtb" not in tools:
            tools.append("xtb")
        if eng == "crest" and "crest" not in tools:
            tools.append("crest")
        if (
            spec.get("task_type") == "GEOMETRY_OPTIMIZATION"
            and eng == "pyscf"
            and "geometric" not in tools
        ):
            tools.append("geometric")
        if (spec.get("dispersion") or "d4" in str(spec).lower()) and "dftd4" not in tools:
            tools.append("dftd4")

    if structures:
        if "three" not in tools:
            tools.append("three")
        if (
            any(s.kind != StructureKind.PERIODIC and str(s.kind) != "PERIODIC" for s in structures)
            and "rdkit" not in tools
        ):
            tools.append("rdkit")

    return tools


# ---------------------------------------------------------------- the block, as text and as data


def citation_block(
    facts: list[CalculationFacts],
    meta: dict[str, Any] | None = None,
    summary_only: bool = False,
    tools_used: list[str] | set[str] | None = None,
) -> dict[str, Any]:
    meta = meta or software_metadata()
    notes = [NO_DOI_NOTE] if facts else []
    if meta.get("doi"):
        notes.append(ZENODO_SNAPSHOT_NOTE)
    else:
        notes.append(SOFTWARE_NO_DOI_NOTE)
    if summary_only and len(facts) > 1:
        displayed_facts = facts[:1]
        notes.append(f"{len(facts)} calculations; full list in the archive.")
    else:
        displayed_facts = facts

    result: dict[str, Any] = {
        "calculations": [
            {
                "calculation_id": f.calculation_id,
                "apa": calculation_apa(f),
                "bibtex": calculation_bibtex(f),
            }
            for f in displayed_facts
        ],
        "software": {
            "apa": software_apa(meta),
            "bibtex": software_bibtex(meta),
            "doi": meta.get("doi"),
        },
        "notes": notes,
    }

    if tools_used:
        registry = third_party_citations()
        tools_list = []
        for t in tools_used:
            key = str(t).lower()
            if key in registry and key not in [item["key"] for item in tools_list]:
                tools_list.append({"key": key, **registry[key]})
        result["also_cite"] = {
            "tools": tools_list,
            "reminder": "If you imported a structure from a paper or database, cite the original source.",
        }

    return result


def citation_block_text(block: dict[str, Any]) -> str:
    """Plain text for the archive README (and any text surface)."""
    lines = ["How to cite", "-----------"]
    if block["calculations"]:
        lines.append("The calculations in this export (APA, then BibTeX):")
        for item in block["calculations"]:
            lines += ["", item["apa"], "", item["bibtex"]]
        lines.append("")
    lines += ["ChemDFT software (APA, then BibTeX):", "", block["software"]["apa"], "", block["software"]["bibtex"], ""]
    if block.get("also_cite") and block["also_cite"].get("tools"):
        lines += [
            "Also cite:",
            "The following third-party scientific tools were used in this project:",
        ]
        for t in block["also_cite"]["tools"]:
            lines += ["", f"{t['name']} ({t.get('version', '')}):", t["apa"], "", t["bibtex"]]
        lines.append("")
        lines.append(block["also_cite"]["reminder"])
        lines.append("")
    lines += [f"Note: {note}" for note in block["notes"]]
    return "\n".join(lines)
