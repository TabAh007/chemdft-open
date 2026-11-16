from __future__ import annotations

import math
import re
from typing import Any

from chemdft_api.contracts.scientific import (
    CoordinateSystem,
    CoordinateUnit,
    DiagnosticSeverity,
    StructureDiagnosticCode,
    StructureKind,
)
from chemdft_api.errors import ScientificValidationFailed
from chemdft_api.scientific.structures import (
    CanonicalStructureCandidate,
    StructureSourceFormat,
    atomic_number_for_symbol,
    diagnostic,
    validate_canonical_candidate,
)
from pymatgen.core import __version__ as pymatgen_version
from pymatgen.io.cif import CifParser, CifWriter

ADAPTER_NAME = "chemdft.pymatgen.periodic"
ADAPTER_VERSION = "1.0.0"


def extract_cif_citation(text: str, parser: CifParser | None = None) -> dict[str, Any] | None:
    """Extracts bibliographic reference fields from a CIF structure.

    Checks _journal_name_full, _journal_year, _journal_volume, _journal_page_first,
    _publ_author_name, _publ_section_title, _database_code_COD, _cod_database_code,
    _chemical_name_mineral, _journal_paper_doi.
    """
    block: dict[str, Any] = {}
    if parser and hasattr(parser, "_cif") and getattr(parser._cif, "data", None):
        block = next(iter(parser._cif.data.values())).data if parser._cif.data else {}

    def get_val(key: str) -> str | None:
        val = block.get(key)
        if val is None:
            pattern = re.compile(
                rf"^\s*{re.escape(key)}\s+([^\r\n]+)",
                re.MULTILINE | re.IGNORECASE,
            )
            m = pattern.search(text)
            if m:
                val = m.group(1).strip().strip("'\"")
        if isinstance(val, list):
            return ", ".join(str(v).strip().strip("'\"") for v in val)
        return str(val).strip().strip("'\"") if val is not None else None

    authors = get_val("_publ_author_name")
    title = get_val("_publ_section_title")
    if title:
        title = " ".join(title.split())
    journal = get_val("_journal_name_full")
    year = get_val("_journal_year")
    volume = get_val("_journal_volume")
    page_first = get_val("_journal_page_first")
    page_last = get_val("_journal_page_last")
    doi = get_val("_journal_paper_doi")
    cod = get_val("_cod_database_code") or get_val("_database_code_COD")
    mineral = get_val("_chemical_name_mineral")

    if not any([authors, title, journal, year, volume, page_first, doi, cod, mineral]):
        return None

    pages = f"{page_first}-{page_last}" if page_first and page_last else (page_first or "")

    parts = []
    if authors:
        parts.append(authors)
    if year:
        parts.append(f"({year}).")
    if title:
        parts.append(f"{title}.")
    if journal:
        j_part = journal
        if volume:
            j_part += f", {volume}"
        if pages:
            j_part += f", {pages}"
        parts.append(f"{j_part}.")
    if doi:
        parts.append(f"https://doi.org/{doi}")
    extras = []
    if cod:
        extras.append(f"COD {cod}")
    if mineral:
        extras.append(mineral)
    if extras:
        extras_str = ", ".join(extras)
        parts.append(f"({extras_str})")

    formatted = " ".join(parts).strip()
    return {
        "authors": authors,
        "title": title,
        "journal": journal,
        "year": year,
        "volume": volume,
        "page_first": page_first,
        "page_last": page_last,
        "doi": doi,
        "cod_id": cod,
        "mineral_name": mineral,
        "formatted": formatted,
    }


def parse_cif(data: bytes, *, selection_index: int = 0) -> CanonicalStructureCandidate:
    text = _decode_text(data)
    if text.lower().count("data_") > 25:
        raise ScientificValidationFailed("CIF exceeds the Phase 3 data block limit.")
    try:
        parser = CifParser.from_str(text, check_cif=True)
        structures = parser.parse_structures(primitive=False)
    except (ValueError, KeyError, IndexError, TypeError, AttributeError) as error:
        # pymatgen signals a malformed file with assorted builtin errors. Report it as the invalid
        # input it is; the file is neither repaired nor interpreted and no parser detail is echoed.
        raise ScientificValidationFailed(
            "CIF could not be parsed as a crystal structure."
        ) from error
    if not structures:
        raise ScientificValidationFailed("CIF did not contain a parseable structure.")
    if selection_index >= len(structures):
        raise ScientificValidationFailed("Requested CIF structure does not exist.")
    structure = structures[selection_index]
    if len(structure) > 10_000:
        raise ScientificValidationFailed("CIF exceeds the Phase 3 site limit.")

    atoms = []
    diagnostics = []
    for index, site in enumerate(structure.sites):
        if len(site.species) != 1:
            diagnostics.append(
                diagnostic(
                    DiagnosticSeverity.WARNING,
                    StructureDiagnosticCode.DISORDERED_SITE,
                    "Site contains more than one species; dominant species is represented.",
                    atom_index=index,
                )
            )
        species_items = tuple(site.species.items())
        species, occupancy = max(species_items, key=lambda item: float(item[1]))
        element = species.symbol
        atomic_number = atomic_number_for_symbol(element)
        if occupancy < 1:
            diagnostics.append(
                diagnostic(
                    DiagnosticSeverity.WARNING,
                    StructureDiagnosticCode.PARTIAL_OCCUPANCY,
                    "Site occupancy is partial and preserved.",
                    atom_index=index,
                )
            )
        x, y, z = (float(value) for value in site.frac_coords)
        if any(not math.isfinite(value) for value in (x, y, z)):
            raise ScientificValidationFailed("CIF fractional coordinates must be finite.")
        atoms.append(
            {
                "index": index,
                "atomic_number": atomic_number,
                "element": element,
                "x": x,
                "y": y,
                "z": z,
                "isotope": None,
                "formal_charge": None,
                "label": site.label,
                "occupancy": float(occupancy),
            }
        )

    lattice = structure.lattice
    cell = {
        "unit": CoordinateUnit.ANGSTROM,
        "a": float(lattice.a),
        "b": float(lattice.b),
        "c": float(lattice.c),
        "alpha": float(lattice.alpha),
        "beta": float(lattice.beta),
        "gamma": float(lattice.gamma),
        "lattice_vectors": tuple(tuple(float(value) for value in row) for row in lattice.matrix),
        "periodic_dimensions": (True, True, True),
    }
    cif_source_reference = extract_cif_citation(text, parser)
    candidate = CanonicalStructureCandidate(
        name=structure.formula or f"CIF structure {selection_index + 1}",
        kind=StructureKind.PERIODIC,
        coordinates={
            "structure_version_id": "00000000-0000-4000-8000-000000000000",
            "coordinate_system": CoordinateSystem.FRACTIONAL,
            "unit": CoordinateUnit.ANGSTROM,
            "dimensionality": 3,
            "atom_ordering": "AS_LISTED",
            "source": None,
            "atoms": atoms,
            "bonds": [],
        },
        periodic_cell=cell,
        overall_charge=0,
        multiplicity=1,
        source_format=StructureSourceFormat.CIF,
        parser_name="pymatgen",
        parser_version=pymatgen_version,
        adapter_name=ADAPTER_NAME,
        adapter_version=ADAPTER_VERSION,
        diagnostics=tuple(diagnostics),
        source_reference=cif_source_reference,
    )
    validate_canonical_candidate(candidate)
    return candidate


def export_cif(candidate: CanonicalStructureCandidate) -> bytes:
    from pymatgen.core import Lattice, Structure

    if candidate.periodic_cell is None:
        raise ScientificValidationFailed("Only periodic structures can be exported as CIF.")
    lattice = Lattice(candidate.periodic_cell["lattice_vectors"])
    species = [atom["element"] for atom in candidate.atoms]
    coords = [[atom["x"], atom["y"], atom["z"]] for atom in candidate.atoms]
    occupancies = [atom.get("occupancy") or 1 for atom in candidate.atoms]
    structure = Structure(
        lattice,
        species,
        coords,
        coords_are_cartesian=False,
        site_properties={"occupancy": occupancies},
    )
    return str(CifWriter(structure)).encode("utf-8")


def _decode_text(data: bytes) -> str:
    if len(data) > 10 * 1024 * 1024:
        raise ScientificValidationFailed("Structure source exceeds parser size limit.")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ScientificValidationFailed("CIF source must be UTF-8 text.") from error
    if any(len(line) > 20_000 for line in text.splitlines()):
        raise ScientificValidationFailed("CIF contains an overlong line.")
    return text
