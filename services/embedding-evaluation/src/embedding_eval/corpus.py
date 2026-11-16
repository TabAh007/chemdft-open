"""Hand-authored synthetic multi-paper benchmark; no paper text is redistributed."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass


@dataclass(frozen=True)
class Document:
    id: str
    source_id: str
    title: str
    page: int
    language: str
    evidence_type: str
    text: str

    @property
    def source(self) -> str:
        return DOCUMENT_METADATA["source"]

    @property
    def license(self) -> str:
        return DOCUMENT_METADATA["license"]

    @property
    def sha256(self) -> str:
        return document_sha256(self)


@dataclass(frozen=True)
class Query:
    id: str
    text: str
    language: str
    category: str
    relevant_ids: tuple[str, ...]
    no_answer: bool = False
    relevant_document_ids: tuple[str, ...] = ()
    relevant_pages: tuple[int, ...] = ()


# Synthetic, project-authored, CC0 1.0. Each evidence item represents one page-level
# retrieval chunk. Evidence IDs are stable and are the only IDs in the gold judgments.
DOCUMENTS = (
    Document(
        "dft-ethanol",
        "paper-dft-01",
        "Synthetic DFT study of ethanol",
        1,
        "en",
        "METADATA",
        "Synthetic computational chemistry paper. DOI 10.5555/synth.dft.2026.001. The molecule ethanol has formula C2H6O.",
    ),
    Document(
        "dft-ethanol-method",
        "paper-dft-01",
        "Synthetic DFT study of ethanol",
        3,
        "en",
        "METHOD",
        "Ethanol geometry and dipole were calculated with B3LYP and the def2-SVP basis set; the optimized dipole moment is 1.72 D.",
    ),
    Document(
        "dft-ethanol-property",
        "paper-dft-01",
        "Synthetic DFT study of ethanol",
        5,
        "en",
        "PROPERTY",
        "The calculated C-O bond length is 1.431 angstrom. A harmonic O-H stretching frequency is 3762 cm-1.",
    ),
    Document(
        "dft-oxide",
        "paper-dft-02",
        "Synthetic plane-wave study of lithium iron phosphate",
        1,
        "en",
        "METHOD",
        "DOI 10.5555/synth.dft.2026.002. LiFePO4 cathode calculations used plane-wave PBE, a 520 eV cutoff, and a 4 x 4 x 6 k-point mesh.",
    ),
    Document(
        "dft-oxide-cell",
        "paper-dft-02",
        "Synthetic plane-wave study of lithium iron phosphate",
        4,
        "en",
        "CELL",
        "The relaxed orthorhombic LiFePO4 cell has a = 10.34 angstrom, b = 6.01 angstrom, and c = 4.69 angstrom.",
    ),
    Document(
        "dft-oxide-energy",
        "paper-dft-02",
        "Synthetic plane-wave study of lithium iron phosphate",
        6,
        "en",
        "PROPERTY",
        "The computed lithium migration barrier is 0.31 eV along the one-dimensional channel.",
    ),
    Document(
        "spectroscopy-co2",
        "paper-spec-03",
        "Synthetic infrared and Raman study of carbon dioxide",
        1,
        "en",
        "METADATA",
        "DOI 10.5555/synth.spec.2026.003. The gas-phase carbon dioxide molecule, CO2, was examined by infrared and Raman spectroscopy.",
    ),
    Document(
        "spectroscopy-co2-ir",
        "paper-spec-03",
        "Synthetic infrared and Raman study of carbon dioxide",
        3,
        "en",
        "SPECTRUM",
        "The strongest infrared asymmetric-stretch band occurs at 2349 cm-1; the symmetric stretch is Raman active near 1388 cm-1.",
    ),
    Document(
        "spectroscopy-co2-ru",
        "paper-spec-03",
        "Синтетическое ИК- и рамановское исследование диоксида углерода",
        4,
        "ru",
        "SPECTRUM",
        "В синтетическом примере для CO2 полоса асимметричного растяжения находится при 2349 см-1; симметричное колебание около 1388 см-1 активно в спектре комбинационного рассеяния.",
    ),
    Document(
        "crystal-batio3",
        "paper-xrd-04",
        "Synthetic diffraction study of barium titanate",
        1,
        "en",
        "METADATA",
        "DOI 10.5555/synth.xrd.2026.004. Powder X-ray diffraction was used to examine tetragonal barium titanate, BaTiO3.",
    ),
    Document(
        "crystal-batio3-cell",
        "paper-xrd-04",
        "Synthetic diffraction study of barium titanate",
        4,
        "en",
        "CELL",
        "At 300 K, the tetragonal BaTiO3 lattice parameters are a = b = 3.994 angstrom and c = 4.038 angstrom; all angles are 90 degrees.",
    ),
    Document(
        "crystal-batio3-peak",
        "paper-xrd-04",
        "Synthetic diffraction study of barium titanate",
        6,
        "en",
        "XRD",
        "The principal Cu K-alpha diffraction reflection is reported at 2theta = 31.52 degrees, with a secondary reflection at 45.18 degrees.",
    ),
    Document(
        "thermal-pla",
        "paper-thermal-05",
        "Synthetic thermogravimetric analysis of PLA",
        1,
        "en",
        "METADATA",
        "DOI 10.5555/synth.thermal.2026.005. Polylactic acid (PLA) was studied using thermogravimetric analysis under nitrogen.",
    ),
    Document(
        "thermal-pla-data",
        "paper-thermal-05",
        "Synthetic thermogravimetric analysis of PLA",
        5,
        "en",
        "THERMAL",
        "PLA has a 5 percent mass-loss temperature of 328 degrees C and a maximum decomposition-rate temperature of 371 degrees C.",
    ),
    Document(
        "thermal-pla-ru",
        "paper-thermal-05",
        "Синтетический термический анализ полилактида",
        6,
        "ru",
        "THERMAL",
        "Для PLA температура максимальной скорости разложения составляет 371 °C; потеря 5 процентов массы достигается при 328 °C.",
    ),
    Document(
        "nano-tio2",
        "paper-nano-06",
        "Synthetic nanoparticle dispersion study",
        1,
        "en",
        "METADATA",
        "DOI 10.5555/synth.nano.2026.006. Aqueous titanium dioxide nanoparticles (TiO2) were characterized by dynamic light scattering (DLS).",
    ),
    Document(
        "nano-tio2-dls",
        "paper-nano-06",
        "Synthetic nanoparticle dispersion study",
        4,
        "en",
        "DLS",
        "The TiO2 hydrodynamic diameter is 42 nm with a polydispersity index of 0.18; measurements were made at 25 degrees C.",
    ),
    Document(
        "nano-tio2-ru",
        "paper-nano-06",
        "Синтетическое исследование наночастиц",
        5,
        "ru",
        "DLS",
        "Методом динамического рассеяния света для TiO2 получен гидродинамический диаметр 42 нм и индекс полидисперсности 0,18.",
    ),
    Document(
        "catalysis-ni",
        "paper-cat-07",
        "Synthetic nickel catalyst kinetics study",
        1,
        "en",
        "METADATA",
        "DOI 10.5555/synth.cat.2026.007. A nickel-on-alumina catalyst, Ni/Al2O3, was tested for hydrogenation of ethene.",
    ),
    Document(
        "catalysis-ni-data",
        "paper-cat-07",
        "Synthetic nickel catalyst kinetics study",
        4,
        "en",
        "KINETICS",
        "At 210 degrees C the Ni/Al2O3 catalyst converts 84 percent of ethene; the apparent activation energy is 47 kJ/mol.",
    ),
    Document(
        "catalysis-ni-method",
        "paper-cat-07",
        "Synthetic nickel catalyst kinetics study",
        3,
        "en",
        "METHOD",
        "The catalyst was reduced in hydrogen at 400 degrees C before a differential-flow kinetic experiment.",
    ),
    Document(
        "electrochem-lfp",
        "paper-electro-08",
        "Synthetic electrochemical study of a lithium cell",
        1,
        "en",
        "METADATA",
        "DOI 10.5555/synth.electro.2026.008. A lithium iron phosphate, LiFePO4, half-cell was evaluated by galvanostatic cycling.",
    ),
    Document(
        "electrochem-lfp-data",
        "paper-electro-08",
        "Synthetic electrochemical study of a lithium cell",
        4,
        "en",
        "ELECTROCHEM",
        "The first-discharge specific capacity is 158 mAh/g at a C/10 rate; capacity retention after 100 cycles is 93 percent.",
    ),
    Document(
        "electrochem-lfp-ru",
        "paper-electro-08",
        "Синтетическое электрохимическое исследование литиевого элемента",
        5,
        "ru",
        "ELECTROCHEM",
        "Удельная емкость первого разряда LiFePO4 равна 158 мА·ч/г при скорости C/10; после 100 циклов сохраняется 93 процента емкости.",
    ),
    Document(
        "polymer-p3ht",
        "paper-poly-09",
        "Synthetic optical study of a conjugated polymer",
        1,
        "en",
        "METADATA",
        "DOI 10.5555/synth.poly.2026.009. Poly(3-hexylthiophene), P3HT, is a conjugated polymer used in organic electronics.",
    ),
    Document(
        "polymer-p3ht-data",
        "paper-poly-09",
        "Synthetic optical study of a conjugated polymer",
        4,
        "en",
        "OPTICAL",
        "The P3HT thin-film optical absorption onset corresponds to a band gap of 1.90 eV; annealing was performed at 150 degrees C.",
    ),
    Document(
        "polymer-p3ht-ru",
        "paper-poly-09",
        "Синтетическое исследование сопряженного полимера",
        5,
        "ru",
        "OPTICAL",
        "Для пленки P3HT оптическая ширина запрещенной зоны составляет 1,90 эВ; отжиг проводили при 150 °C.",
    ),
    Document(
        "molecule-caffeine",
        "paper-mol-10",
        "Synthetic molecular-property study of caffeine",
        1,
        "en",
        "METADATA",
        "DOI 10.5555/synth.mol.2026.010. Caffeine (C8H10N4O2) was used as a molecular-property example; its computed aqueous solubility is 21.7 g/L at 25 degrees C.",
    ),
    Document(
        "molecule-caffeine-method",
        "paper-mol-10",
        "Synthetic molecular-property study of caffeine",
        3,
        "en",
        "METHOD",
        "The caffeine conformer search used the MMFF94 force field, followed by a B3LYP/6-31G(d) single-point calculation.",
    ),
    Document(
        "molecule-caffeine-ru",
        "paper-mol-10",
        "Синтетический анализ свойств кофеина",
        4,
        "ru",
        "PROPERTY",
        "Для кофеина (C8H10N4O2) рассчитанная растворимость в воде при 25 °C равна 21,7 г/л.",
    ),
)

DOCUMENT_METADATA = {
    "source": "project-authored synthetic scientific evidence; not derived from published papers",
    "license": "CC0-1.0",
    "judge_source": "Codex evaluation-author hand-authored evidence and qrels; model-independent; not external-human reviewed",
}


def document_sha256(document: Document) -> str:
    payload = json.dumps(
        document.__dict__, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _query_rows(
    category: str, rows: tuple[tuple[str, str, str, tuple[str, ...]], ...]
) -> tuple[Query, ...]:
    docs_by_evidence = {item.id: item for item in DOCUMENTS}
    queries = []
    for index, (text, language, declared_document, gold) in enumerate(rows, 1):
        gold_documents = tuple(sorted({docs_by_evidence[item_id].source_id for item_id in gold}))
        gold_pages = tuple(sorted({docs_by_evidence[item_id].page for item_id in gold}))
        if gold and declared_document not in gold_documents:
            raise ValueError(f"Judgment source mismatch for {category}-{index:03}.")
        queries.append(
            Query(
                f"{category}-{index:03}",
                text,
                language,
                category,
                gold,
                not gold,
                gold_documents,
                gold_pages,
            )
        )
    return tuple(queries)


# Each row is (query text, query language, explanatory paper ID, exact gold evidence IDs).
# Golds are curated directly against the evidence IDs above, independently of model scores.
_GROUPS = {
    "exact_identifier": (
        ("10.5555/synth.dft.2026.001", "en", "paper-dft-01", ("dft-ethanol",)),
        ("DOI 10.5555/synth.dft.2026.002", "en", "paper-dft-02", ("dft-oxide",)),
        ("10.5555/synth.spec.2026.003", "en", "paper-spec-03", ("spectroscopy-co2",)),
        ("10.5555/synth.xrd.2026.004", "en", "paper-xrd-04", ("crystal-batio3",)),
        ("10.5555/synth.thermal.2026.005", "en", "paper-thermal-05", ("thermal-pla",)),
        ("10.5555/synth.nano.2026.006", "en", "paper-nano-06", ("nano-tio2",)),
        ("10.5555/synth.cat.2026.007", "en", "paper-cat-07", ("catalysis-ni",)),
        ("10.5555/synth.electro.2026.008", "en", "paper-electro-08", ("electrochem-lfp",)),
        ("10.5555/synth.poly.2026.009", "en", "paper-poly-09", ("polymer-p3ht",)),
        ("10.5555/synth.mol.2026.010", "en", "paper-mol-10", ("molecule-caffeine",)),
    ),
    "formula": (
        ("Формула этанола C2H6O", "ru", "paper-dft-01", ("dft-ethanol",)),
        ("Формула катодного материала LiFePO4", "ru", "paper-dft-02", ("dft-oxide",)),
        (
            "CO2 formula in the paper about инфракрасную спектроскопию",
            "cross_en_ru",
            "paper-spec-03",
            ("spectroscopy-co2",),
        ),
        ("BaTiO3 chemical formula", "en", "paper-xrd-04", ("crystal-batio3",)),
        ("PLA repeat material polylactic acid", "en", "paper-thermal-05", ("thermal-pla",)),
        ("TiO2 nanoparticles", "en", "paper-nano-06", ("nano-tio2",)),
        ("Ni/Al2O3 catalyst", "en", "paper-cat-07", ("catalysis-ni",)),
        ("LiFePO4 cell chemistry", "en", "paper-electro-08", ("electrochem-lfp",)),
        ("P3HT conjugated polymer", "en", "paper-poly-09", ("polymer-p3ht",)),
        ("C8H10N4O2 caffeine", "en", "paper-mol-10", ("molecule-caffeine",)),
    ),
    "numeric": (
        ("ethanol dipole moment 1.72 D", "en", "paper-dft-01", ("dft-ethanol-method",)),
        ("LiFePO4 migration barrier 0.31 eV", "en", "paper-dft-02", ("dft-oxide-energy",)),
        (
            "CO2 asymmetric stretch 2349 cm-1",
            "en",
            "paper-spec-03",
            ("spectroscopy-co2-ir", "spectroscopy-co2-ru"),
        ),
        ("BaTiO3 diffraction peak 31.52 degrees", "en", "paper-xrd-04", ("crystal-batio3-peak",)),
        (
            "PLA decomposition maximum 371 °C",
            "en",
            "paper-thermal-05",
            ("thermal-pla-data", "thermal-pla-ru"),
        ),
        ("TiO2 diameter 42 nm", "en", "paper-nano-06", ("nano-tio2-dls", "nano-tio2-ru")),
        (
            "nickel catalyst activation energy 47 kJ/mol",
            "en",
            "paper-cat-07",
            ("catalysis-ni-data",),
        ),
        (
            "LiFePO4 capacity 158 mAh/g",
            "en",
            "paper-electro-08",
            ("electrochem-lfp-data", "electrochem-lfp-ru"),
        ),
        ("P3HT band gap 1.90 eV", "en", "paper-poly-09", ("polymer-p3ht-data", "polymer-p3ht-ru")),
        (
            "Растворимость кофеина 21.7 г/л",
            "ru",
            "paper-mol-10",
            ("molecule-caffeine", "molecule-caffeine-ru"),
        ),
    ),
    "method_basis": (
        (
            "Какой функционал и базисный набор использовали для этанола?",
            "ru",
            "paper-dft-01",
            ("dft-ethanol-method",),
        ),
        ("PBE plane-wave cutoff for LiFePO4", "en", "paper-dft-02", ("dft-oxide",)),
        (
            "Какими спектроскопическими методами исследовали колебания CO2?",
            "ru",
            "paper-spec-03",
            ("spectroscopy-co2",),
        ),
        (
            "X-ray source used for the barium titanate scan",
            "en",
            "paper-xrd-04",
            ("crystal-batio3-peak",),
        ),
        (
            "Atmosphere used in the PLA thermogravimetric experiment",
            "en",
            "paper-thermal-05",
            ("thermal-pla",),
        ),
        ("Technique used to measure TiO2 particle size", "en", "paper-nano-06", ("nano-tio2",)),
        (
            "pretreatment before nickel catalyst kinetics",
            "en",
            "paper-cat-07",
            ("catalysis-ni-method",),
        ),
        ("How was the LiFePO4 cell cycled?", "en", "paper-electro-08", ("electrochem-lfp",)),
        ("polymer film annealing protocol", "en", "paper-poly-09", ("polymer-p3ht-data",)),
        (
            "Какое силовое поле и базис использовали для кофеина?",
            "ru",
            "paper-mol-10",
            ("molecule-caffeine-method",),
        ),
    ),
    "named_material": (
        (
            "ethanol geometry calculation",
            "en",
            "paper-dft-01",
            ("dft-ethanol", "dft-ethanol-property"),
        ),
        (
            "orthorhombic lithium iron phosphate crystal",
            "en",
            "paper-dft-02",
            ("dft-oxide", "dft-oxide-cell"),
        ),
        (
            "carbon dioxide Raman active symmetric vibration",
            "en",
            "paper-spec-03",
            ("spectroscopy-co2-ir",),
        ),
        (
            "тетрагональная структура кристалла титаната бария",
            "ru",
            "paper-xrd-04",
            ("crystal-batio3", "crystal-batio3-cell"),
        ),
        (
            "polylactic acid mass-loss experiment",
            "en",
            "paper-thermal-05",
            ("thermal-pla", "thermal-pla-data"),
        ),
        (
            "водная дисперсия наночастиц диоксида титана",
            "ru",
            "paper-nano-06",
            ("nano-tio2", "nano-tio2-dls"),
        ),
        (
            "ethene hydrogenation over supported nickel",
            "en",
            "paper-cat-07",
            ("catalysis-ni", "catalysis-ni-data"),
        ),
        (
            "lithium iron phosphate half-cell",
            "en",
            "paper-electro-08",
            ("electrochem-lfp", "electrochem-lfp-data"),
        ),
        (
            "organic electronic P3HT thin film",
            "en",
            "paper-poly-09",
            ("polymer-p3ht", "polymer-p3ht-data"),
        ),
        ("свойства молекулы кофеина в воде", "ru", "paper-mol-10", ("molecule-caffeine",)),
    ),
    "semantic": (
        (
            "Какое молекулярное свойство рассчитали для этанола?",
            "ru",
            "paper-dft-01",
            ("dft-ethanol-method", "dft-ethanol-property"),
        ),
        (
            "How difficult is lithium transport through the phosphate channel?",
            "en",
            "paper-dft-02",
            ("dft-oxide-energy",),
        ),
        (
            "Какое колебание углекислого газа дает наиболее сильную полосу ИК?",
            "ru",
            "paper-spec-03",
            ("spectroscopy-co2-ir",),
        ),
        (
            "What symmetry and dimensions describe the room-temperature titanate cell?",
            "en",
            "paper-xrd-04",
            ("crystal-batio3-cell",),
        ),
        (
            "At what point does the polymer lose mass fastest on heating?",
            "en",
            "paper-thermal-05",
            ("thermal-pla-data",),
        ),
        (
            "Насколько широкое распределение размеров наночастиц измерено?",
            "ru",
            "paper-nano-06",
            ("nano-tio2-dls",),
        ),
        (
            "How energetic is the rate-limiting catalytic process?",
            "en",
            "paper-cat-07",
            ("catalysis-ni-data",),
        ),
        (
            "How much charge can the fresh cathode deliver?",
            "en",
            "paper-electro-08",
            ("electrochem-lfp-data",),
        ),
        (
            "What photon-energy onset is inferred for the conjugated film?",
            "en",
            "paper-poly-09",
            ("polymer-p3ht-data",),
        ),
        (
            "Насколько хорошо кофеин растворяется в воде?",
            "ru",
            "paper-mol-10",
            ("molecule-caffeine",),
        ),
    ),
    "paraphrase": (
        (
            "Каков дипольный момент оптимизированного этанола?",
            "ru",
            "paper-dft-01",
            ("dft-ethanol-method",),
        ),
        (
            "Energy needed for an ion to hop in the olivine host",
            "en",
            "paper-dft-02",
            ("dft-oxide-energy",),
        ),
        (
            "Частота интенсивной антисимметричной полосы растяжения CO2",
            "ru",
            "paper-spec-03",
            ("spectroscopy-co2-ir",),
        ),
        (
            "Lengths of the perpendicular axes in the tetragonal ferroelectric",
            "en",
            "paper-xrd-04",
            ("crystal-batio3-cell",),
        ),
        (
            "Temperature corresponding to the derivative mass-loss maximum",
            "en",
            "paper-thermal-05",
            ("thermal-pla-data",),
        ),
        (
            "Средний гидродинамический размер частиц в суспензии",
            "ru",
            "paper-nano-06",
            ("nano-tio2-dls",),
        ),
        (
            "Activation enthalpy for the supported-metal reaction",
            "en",
            "paper-cat-07",
            ("catalysis-ni-data",),
        ),
        (
            "Initial gravimetric energy storage of the cathode",
            "en",
            "paper-electro-08",
            ("electrochem-lfp-data",),
        ),
        (
            "Optical gap extracted from the polymer absorption edge",
            "en",
            "paper-poly-09",
            ("polymer-p3ht-data",),
        ),
        (
            "Количество вещества-алкалоида, растворяющееся в воде",
            "ru",
            "paper-mol-10",
            ("molecule-caffeine",),
        ),
    ),
    "multilingual": (
        (
            "При какой частоте наблюдается сильнейшая полоса растяжения CO2?",
            "ru",
            "paper-spec-03",
            ("spectroscopy-co2-ir", "spectroscopy-co2-ru"),
        ),
        (
            "What are the lattice constants of титанат бария?",
            "cross_en_ru",
            "paper-xrd-04",
            ("crystal-batio3-cell",),
        ),
        (
            "Температура максимальной скорости потери массы PLA?",
            "ru",
            "paper-thermal-05",
            ("thermal-pla-data", "thermal-pla-ru"),
        ),
        (
            "What is the средний диаметр наночастиц TiO2?",
            "cross_en_ru",
            "paper-nano-06",
            ("nano-tio2-dls", "nano-tio2-ru"),
        ),
        (
            "Какова энергия активации hydrogenation на Ni/Al2O3?",
            "cross_ru_en",
            "paper-cat-07",
            ("catalysis-ni-data",),
        ),
        (
            "Удельная емкость lithium iron phosphate при C/10?",
            "cross_ru_en",
            "paper-electro-08",
            ("electrochem-lfp-data", "electrochem-lfp-ru"),
        ),
        (
            "Band gap пленки сопряженного полимера P3HT",
            "cross_en_ru",
            "paper-poly-09",
            ("polymer-p3ht-data", "polymer-p3ht-ru"),
        ),
        (
            "Растворимость caffeine in water at 25 degrees",
            "cross_ru_en",
            "paper-mol-10",
            ("molecule-caffeine", "molecule-caffeine-ru"),
        ),
        ("ethanol дипольный момент", "cross_en_ru", "paper-dft-01", ("dft-ethanol-method",)),
        (
            "Барьер миграции лития в olivine phosphate",
            "cross_ru_en",
            "paper-dft-02",
            ("dft-oxide-energy",),
        ),
    ),
    "ambiguous": (
        ("cell parameters for lithium iron phosphate", "en", "paper-dft-02", ("dft-oxide-cell",)),
        ("cell parameters for barium titanate", "en", "paper-xrd-04", ("crystal-batio3-cell",)),
        (
            "peak position of carbon dioxide vibration",
            "en",
            "paper-spec-03",
            ("spectroscopy-co2-ir",),
        ),
        ("diffraction peak position for titanate", "en", "paper-xrd-04", ("crystal-batio3-peak",)),
        (
            "temperature of nickel experiment",
            "en",
            "paper-cat-07",
            ("catalysis-ni-data", "catalysis-ni-method"),
        ),
        ("temperature in polymer study", "en", "paper-poly-09", ("polymer-p3ht-data",)),
        ("size of caffeine", "en", "paper-mol-10", ()),
        ("capacity of the phosphate material", "en", "paper-electro-08", ("electrochem-lfp-data",)),
        ("energy of ethanol", "en", "paper-dft-01", ()),
        ("mass change of oxide", "en", "paper-thermal-05", ()),
    ),
    "noisy_partial": (
        ("eth dip 1.72 D", "en", "paper-dft-01", ("dft-ethanol-method",)),
        ("барьер LiFePO4 .31 ev", "ru", "paper-dft-02", ("dft-oxide-energy",)),
        ("CO2 asym stretch 2349", "en", "paper-spec-03", ("spectroscopy-co2-ir",)),
        ("BaTiO3 cell c 4.038 A", "en", "paper-xrd-04", ("crystal-batio3-cell",)),
        ("PLA температура максимума 371C", "ru", "paper-thermal-05", ("thermal-pla-data",)),
        ("tio particle dia 42 nm", "en", "paper-nano-06", ("nano-tio2-dls",)),
        ("Ni alumina Ea 47 kJ/mol", "en", "paper-cat-07", ("catalysis-ni-data",)),
        ("LFP 158 mAh/g c10", "en", "paper-electro-08", ("electrochem-lfp-data",)),
        ("p3ht optical onset 1.90ev", "en", "paper-poly-09", ("polymer-p3ht-data",)),
        ("caff water solub 21.7", "en", "paper-mol-10", ("molecule-caffeine",)),
    ),
    "no_answer": (
        ("10.5555/synth.missing.999", "en", "", ()),
        ("What is the melting point of xenon tetrafluoride in this corpus?", "en", "", ()),
        ("Find the 88.888 nm particle size result", "en", "", ()),
        ("Does the dataset report a 9.99 eV gap for graphene?", "en", "", ()),
        ("Какова температура сверхпроводящего перехода ртути?", "ru", "", ()),
        ("Reported CAS 7732-18-5 for the catalyst", "en", "", ()),
        ("What is the crystal space group of sodium chloride here?", "en", "", ()),
        ("Find the Raman band at 9999 cm-1", "en", "", ()),
        ("How many cycles did a sodium sulfur cell retain?", "en", "", ()),
        ("Какова энергия активации для синтеза аммиака в этих документах?", "ru", "", ()),
    ),
}

QUERIES = tuple(
    query for category, rows in _GROUPS.items() for query in _query_rows(category, rows)
)


def validate_corpus() -> None:
    document_ids = {item.id for item in DOCUMENTS}
    assert len(document_ids) == len(DOCUMENTS)
    assert len({query.id for query in QUERIES}) == len(QUERIES)
    for query in QUERIES:
        assert query.no_answer == (not query.relevant_ids)
        assert set(query.relevant_ids) <= document_ids, query.id


validate_corpus()
