"""Build the source-backed, model-independent retrieval-policy review pack."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

from embedding_eval.policy_dev_corpus import DEFAULT_MANIFEST_PATH
from embedding_eval.source_locators import validate_target_integrity

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CORPUS = Path("/tmp/chemdft-retrieval-policy-dev-v1-corpus.json")
NEGATIVE_SOURCE = ROOT / "review/retrieval-policy-dev-v1-no-answer-review.csv"
CSV_OUTPUT = ROOT / "review/retrieval-policy-dev-v1-qrels-review.csv"
JSON_OUTPUT = ROOT / "review/retrieval-policy-dev-v1-qrels-review.json"


def _spec(
    chunk_id: str,
    query: str,
    query_class: str,
    excerpt: str,
    *,
    language: str = "en",
    leakage_group_id: str | None = None,
) -> dict[str, str | None]:
    return {
        "chunk_id": chunk_id,
        "query": query,
        "query_class": query_class,
        "language": language,
        "evidence_excerpt": excerpt,
        "leakage_group_id": leakage_group_id,
    }


ANSWERABLE_SPECS = (
    _spec(
        "pmc6538633-p00015-c7c275da17c5",
        "What permanent Catalysis-Hub publication identifier is assigned to the bimetallic-alloy dataset?",
        "identifier",
        "permanent link at https://www.catalysis-hub.org/publications/MamunHighT2019",
    ),
    _spec(
        "pmc6538633-p00003-5a2fdcc9953b",
        "Which stoichiometries are used for the L1₂ and L1₀ alloy structures?",
        "formula",
        "A 3 B and AB stoichiometries",
    ),
    _spec(
        "pmc6538633-p00003-5a2fdcc9953b",
        "How many bimetallic-alloy surfaces and pure-metal surfaces are included in the study?",
        "numeric_value",
        "1,998 bimetallic alloy and 37 pure metal surfaces",
    ),
    _spec(
        "pmc6538633-p00004-e9008d856dc2",
        "How many unique adsorbate/site/slab combinations are reported, including empty slabs?",
        "numeric_value",
        "96,015 unique surfaces, adsorbate and site combinations",
    ),
    _spec(
        "pmc6538633-p00004-e9008d856dc2",
        "Which atomic adsorbates were studied across all 2,035 surfaces?",
        "named_compound",
        "Atomic adsorption of H, C, N, O, and S",
    ),
    _spec(
        "pmc6538633-p00004-e9008d856dc2",
        "How many unique sites were sampled for A1, L1₂, and L1₀ surfaces, respectively?",
        "numeric_value",
        "number of sites are 4, 9, and 10 for the A 1 , L1 2 , and L1 0 surfaces respectively",
    ),
    _spec(
        "pmc6538633-p00010-054ca9fd325e",
        "Which gas-phase reference species are named for the adsorption-energy calculation?",
        "named_compound",
        "CH 4 (g), H 2 (g), N 2 (g), H 2 O(g) and H 2 S(g)",
    ),
    _spec(
        "pmc6538633-p00012-1a61c8e9488a",
        "Which electronic-structure code and exchange-correlation functional were used for the alloy calculations?",
        "method_basis",
        "performed in the Quantum Espresso (QE) electronic structure code 23 , using the BEEF-vdw",
    ),
    _spec(
        "pmc6538633-p00012-1a61c8e9488a",
        "Quantum Espresso 500 eV cutoff?",
        "noisy_partial",
        "a 500 eV plane-wave cutoff",
    ),
    _spec(
        "pmc6538633-p00012-1a61c8e9488a",
        "What Monkhorst-Pack grids were used for bulk and slab calculations?",
        "numeric_unit",
        "(12, 12, 12) for bulk and (6, 6, 1) for slab calculations",
    ),
    _spec(
        "pmc6538633-p00012-1a61c8e9488a",
        "For which alloying elements were spin-polarized calculations enabled?",
        "method_basis",
        "alloys containing Fe, Ni, Co, and Mn",
    ),
    _spec(
        "pmc10934912-p00007-d9acb2931569",
        "What is the mass composition of the CeZrPAl support oxide?",
        "formula",
        "composition of the materials is as follows: 74 wt.% Al 2 O 3 , 20 wt.% CeO 2 -ZrO 2 (Ce:Zr = 1:1, molar ratio), and 6 wt.% P 2 O 5",
        leakage_group_id="answer-ce-zr-ratio",
    ),
    _spec(
        "pmc10934912-p00007-d9acb2931569",
        "Для CeZrPAl какое молярное отношение Ce к Zr указано в составе?",
        "cross_language",
        "Ce:Zr = 1:1, molar ratio",
        language="ru",
        leakage_group_id="answer-ce-zr-ratio",
    ),
    _spec(
        "pmc10934912-p00007-d9acb2931569",
        "Which three preparation routes were compared for CeZrPAl composite oxides?",
        "method_basis",
        "sol–gel, impregnation, and mechanical mixing",
    ),
    _spec(
        "pmc10934912-p00008-6cd665641d6d",
        "At what pH was the sol–gel mixture adjusted during CeZrPAl preparation?",
        "experimental_condition",
        "adjust the pH to 6.5",
    ),
    _spec(
        "pmc10934912-p00008-6cd665641d6d",
        "For how long and at what temperature were fresh sol–gel CeZrPAl oxides calcined?",
        "numeric_unit",
        "calcined in a muffle furnace at 500 °C for 3 h",
    ),
    _spec(
        "pmc10934912-p00008-6cd665641d6d",
        "What additional thermal treatment defines the aged CeZrPAl-G-A support?",
        "experimental_condition",
        "1000 °C for 5 h",
    ),
    _spec(
        "pmc10934912-p00011-f99221dd4a6b",
        "Which P₂O₅ contents were prepared for the CeZrPAl support series?",
        "numeric_value",
        "0 wt.%, 2 wt.%, 6 wt.%, 10 wt.%",
    ),
    _spec(
        "pmc10934912-p00012-bf426050539b",
        "What palladium loading was used to prepare the Pd/CeZrPAl catalysts?",
        "numeric_unit",
        "1 wt.% Pd in catalysts",
    ),
    _spec(
        "pmc10934912-p00013-af3915a1e257",
        "At what temperature were the nitrogen adsorption–desorption measurements performed?",
        "experimental_condition",
        "adsorption–desorption at −196 °C",
    ),
    _spec(
        "pmc10934912-p00014-a0903ad77f54",
        "Какой диапазон 2θ и длина волны Cu Kα использовались при XRD?",
        "cross_language",
        "Cu Kα radiation source (λ = 1.5406 Å), scanning range of 2 θ = 20°–80°",
        language="ru",
    ),
    _spec(
        "pmc10934912-p00015-938f3195a922",
        "What C 1s binding energy was used as the XPS charge-correction standard?",
        "numeric_unit",
        "C1s (284.8 eV) as the standard",
    ),
    _spec(
        "pmc10934912-p00016-2918e22bbe9c",
        "At what excitation wavelength were the Raman spectra collected?",
        "numeric_unit",
        "excitation light source at 514.5 nm",
    ),
    _spec(
        "pmc10934912-p00021-d6c2d0adc15b",
        "Which 2θ peaks were assigned to the cubic CeₓZr₁₋ₓO₂ phase in fresh supports?",
        "numeric_value",
        "28.5°, 33.2°, 47.8°, 56.8°, and 76.8°",
    ),
    _spec(
        "pmc10934912-p00023-39d1a92c0e92",
        "Какие фазы оксида алюминия наблюдали после старения CeZrPAl?",
        "cross_language",
        "diffraction peaks of δ-Al 2 O 3 appear",
        language="ru",
    ),
    _spec(
        "pmc10934912-p00029-7396d38c8292",
        "How did surface Ce³⁺ percentages compare among sol–gel, impregnation, and mechanical mixing?",
        "numeric_value",
        "36.7%, 41.4%, and 30.3%, respectively",
    ),
    _spec(
        "pmc10934912-p00034-b49856c3c223",
        "How did the pore-size range change from fresh to aged CeZrPAl supports?",
        "numeric_unit",
        "range of pore sizes expands from 2–16 nm to 2–100 nm",
    ),
    _spec(
        "pmc10934912-p00035-405d14eff5b5",
        "Which fresh support preparation method produced the highest reported BET surface area, and what was it?",
        "numeric_unit",
        "sol–gel method have the highest specific surface area of 323 m 2",
    ),
    _spec(
        "pmc10934912-p00019-fcc756129833",
        "What reactor pressure and catalyst mass were used in the propane-oxidation test?",
        "experimental_condition",
        "atmospheric pressure",
    ),
    _spec(
        "pmc4335811-p00016-3e41b2601259",
        "How many chromium complexes were included in the experimental V2C XES series?",
        "numeric_value",
        "V2C XES data were obtained for 12 Cr complexes",
    ),
    _spec(
        "pmc4335811-p00016-3e41b2601259",
        "Which donor atoms were represented among the chromium-complex ligands?",
        "named_compound",
        "C, N, O, P, Cl, and S",
    ),
    _spec(
        "pmc4335811-p00017-e37fc897b46f",
        "How were the V2C XES peak maxima fitted?",
        "method_basis",
        "pseudo-Voigt least-squares fits",
    ),
    _spec(
        "pmc4335811-p00017-e37fc897b46f",
        "Какова средняя ошибка аппроксимации пиков до и после исключения ошибок выше 1.5 эВ?",
        "cross_language",
        "0.65 ± 0.13 eV",
        language="ru",
    ),
    _spec(
        "pmc4335811-p00019-9ba46744463f",
        "How many previously reported chromium compounds were added to extend the calculated spectral library?",
        "numeric_value",
        "an additional 90 previously reported Cr compounds",
    ),
    _spec(
        "pmc4335811-p00020-a4648b07cca5",
        "What coefficient of determination was reported for the experimental-versus-calculated V2C band-energy correlation?",
        "numeric_value",
        "R 2 = 0.99",
    ),
    _spec(
        "pmc4335811-p00020-a4648b07cca5",
        "What scalar correction was found for BP86/def2-TZVP-ZORA V2C calculations?",
        "numeric_unit",
        "66.0 ± 0.8 eV",
    ),
    _spec(
        "pmc4335811-p00021-2a23ea346240",
        "What mean absolute energy difference resulted from scalar-corrected BP86 data?",
        "numeric_unit",
        "0.68 ± 0.06 eV",
    ),
    _spec(
        "pmc4335811-p00020-a4648b07cca5",
        "Which density functional and basis set were used for the initial calculated chromium V2C energies?",
        "method_basis",
        "BP86 density functional and the scalar relativistically recontracted def2-TZVP basis set",
    ),
    _spec(
        "pmc4335811-p00024-8c5c58e2710f",
        "What is the reported accuracy scale of calculated Cr V2C XES energies relative to experiment?",
        "semantic",
        "within 0.5 eV of the experimental value",
    ),
    _spec(
        "pmc9396622-p00006-e51545106c8c",
        "At what isolated yield was cobalt complex 1 obtained?",
        "numeric_unit",
        "as a magenta-purple solid in 75% yield",
    ),
    _spec(
        "pmc9396622-p00006-e51545106c8c",
        "What τ₄ and τ₄′ values describe the geometry of cobalt complex 1?",
        "numeric_value",
        "τ 4 and τ 4 ′ values of 0.473 and 0.363",
    ),
    _spec(
        "pmc9396622-p00008-cf8f388cf844",
        "How many distinct redox waves were observed for complex 1?",
        "numeric_value",
        "four distinct redox waves",
    ),
    _spec(
        "pmc9396622-p00009-b7cacceb3b5c",
        "What τ₅ value was reported for the five-coordinate cobalt complex 2?",
        "numeric_value",
        "The τ 5 value for this complex is 0.605",
    ),
    _spec(
        "pmc9396622-p00010-9e054961e900",
        "Which g-values were measured by EPR for cobalt complex 1?",
        "numeric_value",
        "g -values of 2.02, 2.10, and 2.58",
        leakage_group_id="answer-complex1-epr-g",
    ),
    _spec(
        "pmc9396622-p00012-f23054ced671",
        "Каковы значения g в спектре ЭПР комплекса 2?",
        "cross_language",
        "g -values of 2.01, 2.11, and 2.61",
        language="ru",
    ),
    _spec(
        "pmc9396622-p00014-9eae837f6ba0",
        "At what temperature and over what time did complex 3 form from complex 2 and H₂?",
        "experimental_condition",
        "taking over 48 h for complete conversion at −25 ° C",
    ),
    _spec(
        "pmc9396622-p00016-99dac5c07197",
        "What N–D stretching frequency was observed for deuterated complex 3?",
        "numeric_unit",
        "N–D stretch in the deuterated samples around 2065 cm –1",
    ),
    _spec(
        "pmc9396622-p00018-24d6c9648427",
        "Under 1 atm H₂ at 23 °C with 1% complex 2, what conversion of 1-hexene to hexane was observed?",
        "numeric_unit",
        "79(6)% conversion to hexane with 1% catalyst loading of 2",
    ),
    _spec(
        "pmc9396622-p00018-24d6c9648427",
        "Каков выход гидрирования 3,3-диметилбутена катализатором 2?",
        "cross_language",
        "3,3-dimethylbutene is hydrogenated in 71(2)% yield",
        language="ru",
    ),
    _spec(
        "pmc9396622-p00019-b31a6f9451d6",
        "What yield was reported for α-methylstyrene hydrogenation with 2.5% catalyst loading?",
        "numeric_unit",
        "hydrogenated in only 28(1)% yield",
    ),
    _spec(
        "pmc9396622-p00023-2e41a7b5b563",
        "Which functional and element-specific basis sets were used for the mechanistic DFT calculations?",
        "method_basis",
        "using the O3LYP functional and basis sets of def2-SVP on H",
    ),
    _spec(
        "pmc9396622-p00010-9e054961e900",
        "What EPR evidence was reported for the electronic structure of complex 1?",
        "paraphrase",
        "EPR of 1 is rhombic",
    ),
    _spec(
        "pmc6222785-p00008-d7c6c3417dbd",
        "Which two chloroaluminate ionic liquids and two comparison non-chloroaluminate liquids were studied?",
        "named_compound",
        "[(C 2 H 5 ) 3 NH]Cl-AlCl 3",
    ),
    _spec(
        "pmc6222785-p00009-5c23423b41b7",
        "For a fixed cation, how does chlorometallate Lewis acidity rank across Al, Zn, and Cu?",
        "semantic",
        "decrease in the order of Al > Zn > Cu",
    ),
    _spec(
        "pmc6222785-p00009-5c23423b41b7",
        "What maximum surface electrostatic potential was reported for the [C₄mim]⁺ cation example?",
        "numeric_unit",
        "value of V s,max could reach to 48.275 kcal/mol",
        leakage_group_id="answer-il-vsmax-48",
    ),
    _spec(
        "pmc6222785-p00010-884a6c61b1b0",
        "What Vₛ,max values are compared for [C₄mim][Al₂Cl₇]⁻ and [C₄mim][AlCl₄]⁻?",
        "numeric_value",
        "52.596 vs. 48.275",
    ),
    _spec(
        "pmc6222785-p00012-de0220f46dbb",
        "Where were the basicity-related Vₛ,min and Īₛ,min sites located in the chlorometallate ions?",
        "semantic",
        "all around the Cl atom in the anions",
    ),
    _spec(
        "pmc6222785-p00014-f60f58357e9d",
        "How did adding CuCl affect the Lewis acidity of the [C₄mim] chloroaluminate liquid?",
        "semantic",
        "exhibited weaker acidity than that of [C 4 mim]Cl-AlCl 3",
    ),
    _spec(
        "pmc6222785-p00015-2a627324c5bd",
        "What did the Gutmann acceptor-number comparison indicate about the CuCl-containing triethylammonium liquid?",
        "semantic",
        "the acidity of [(C 2 H 5 ) 3 NH]Cl-AlCl 3 -CuCl is larger",
    ),
    _spec(
        "pmc6222785-p00026-858e8fc605f7",
        "Which distribution type was assigned to [(C₂H₅)₃NH]⁺[CuAlCl₅]⁻ by the Fukui analysis?",
        "named_compound",
        "showed a bifunctional distribution",
    ),
    _spec(
        "pmc6222785-p00032-1e64ed187f85",
        "Which density functional and dispersion correction are named for the ionic-liquid calculations?",
        "method_basis",
        "B3LYP/6-31++G**-gd3bj (DFT-D3)",
    ),
    _spec(
        "pmc12550025-p00009-99876369e16f",
        "What is the model architecture called, and which three modules does it contain?",
        "method_basis",
        "Conditional Variational Autoencoder (CVAE) integrated with property prediction",
    ),
    _spec(
        "pmc12550025-p00010-b7f741d4d4d9",
        "Which prediction metrics are reported in the CatDRX model comparison?",
        "method_basis",
        "root mean squared error (RMSE) and mean absolute error (MAE)",
    ),
    _spec(
        "pmc12550025-p00045-90294b8915f5",
        "How many reactions, unique reactant/product species, and distinct catalysts were selected for pre-training?",
        "numeric_value",
        "52,448 reactions",
    ),
    _spec(
        "pmc12550025-p00042-e219de79526a",
        "What reaction-data properties were required for each entry in the CatDRX acquisition criteria?",
        "semantic",
        "reactant(s), product, catalyst complexes, percent yield",
    ),
    _spec(
        "pmc12550025-p00049-8ad0d4c2e472",
        "What catalyst-matrix dimensions result from 100 nodes, 68 atom types, and 6 bond types?",
        "numeric_value",
        "total dimensionality of the matrix representation is 100 + (100 × 68) + (100 × 100 × 6) = 66900 dimensions",
    ),
    _spec(
        "pmc12550025-p00054-52974206986a",
        "Which neural architecture embeds reactants, reagents, and products for CatDRX conditions?",
        "method_basis",
        "independently embedded using a Graph Attention Network (GAT)",
    ),
    _spec(
        "pmc12550025-p00056-b0ac9f9786f8",
        "What three loss terms make up the CatDRX training objective?",
        "method_basis",
        "reconstruction loss and the Kullback-Leibler (KL) divergence loss and a regression loss",
    ),
    _spec(
        "pmc12550025-p00059-7ff18f11aa55",
        "What train/validation/test ratio was used for the pre-training dataset?",
        "numeric_value",
        "ratio of 90: 5: 5",
    ),
    _spec(
        "pmc6222785-p00009-5c23423b41b7",
        "По статье, какое значение Vₛ,max достигалось для [C₄mim]⁺?",
        "cross_language",
        "value of V s,max could reach to 48.275 kcal/mol",
        language="ru",
        leakage_group_id="answer-il-vsmax-48",
    ),
    _spec(
        "pmc9396622-p00010-9e054961e900",
        "Назовите три g-фактора, измеренных методом ЭПР для комплекса 1.",
        "cross_language",
        "g -values of 2.02, 2.10, and 2.58",
        language="ru",
        leakage_group_id="answer-complex1-epr-g",
    ),
)


NEGATIVE_CLASS_OVERRIDES = {
    "rpdev1-n001": ("formula", "negative-nacl-lattice"),
    "rpdev1-n002": ("numeric_value", None),
    "rpdev1-n003": ("numeric_value", "negative-zno-dls"),
    "rpdev1-n004": ("numeric_value", None),
    "rpdev1-n005": ("experimental_condition", None),
    "rpdev1-n006": ("named_material", None),
    "rpdev1-n007": ("numeric_value", None),
    "rpdev1-n008": ("named_compound", None),
    "rpdev1-n009": ("named_compound", None),
    "rpdev1-n010": ("named_compound", None),
    "rpdev1-n011": ("numeric_value", None),
    "rpdev1-n012": ("numeric_value", None),
    "rpdev1-n013": ("semantic", None),
    "rpdev1-n014": ("method_basis", None),
    "rpdev1-n015": ("method_basis", None),
    "rpdev1-n016": ("method_basis", None),
    "rpdev1-n017": ("method_basis", None),
    "rpdev1-n018": ("semantic", None),
    "rpdev1-n019": ("method_basis", None),
    "rpdev1-n020": ("semantic", "negative-chlorometallate-transport"),
    "rpdev1-n021": ("semantic", None),
    "rpdev1-n022": ("named_material", None),
    "rpdev1-n023": ("experimental_condition", None),
    "rpdev1-n024": ("experimental_condition", None),
    "rpdev1-n025": ("experimental_condition", None),
    "rpdev1-n026": ("formula", "negative-nacl-lattice"),
    "rpdev1-n027": ("numeric_value", "negative-zno-dls"),
    "rpdev1-n028": ("semantic", "negative-chlorometallate-transport"),
    "rpdev1-n029": ("named_compound", "negative-chlorometallate-transport"),
}

NEGATIVE_EXTRA = {
    "query_id": "rpdev1-n030",
    "query": "What Open Reaction Database accession identifies the exact 52,448-reaction pre-training subset used by CatDRX?",
    "query_class": "identifier",
    "language": "en",
    "negative_type": "identifier_not_reported",
    "proposed_label": "NO_ANSWER",
    "review_status": "UNREVIEWED",
    "reviewer": "",
    "review_decision": "",
    "review_notes": "",
    "assistant_recommendation": "CANDIDATE_NO_ANSWER",
    "assistant_review_notes": "Candidate checked against the full chunk text for ORD accession, accession number, pre-training identifier, and dataset ID terminology; no accession identifying this specific subset was located. Human review remains required.",
}


def _digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _target(chunk: dict[str, Any], document: dict[str, Any]) -> dict[str, Any]:
    return {
        "expected_document_id": document["document_id"],
        "expected_page": None,
        "expected_chunk_id": chunk["chunk_id"],
        "source_locator": chunk["source_locator"],
        "content_sha256": chunk["content_sha256"],
        "source_xml_sha256": document["source_xml_sha256"],
    }


def _read_negatives() -> list[dict[str, str]]:
    with NEGATIVE_SOURCE.open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream))
    rows.append(dict(NEGATIVE_EXTRA))
    for row in rows:
        query_class, leakage_group = NEGATIVE_CLASS_OVERRIDES.get(
            row["query_id"], (row["query_class"], None)
        )
        row["query_class"] = query_class
        row["leakage_group_id"] = leakage_group or ""
        row["no_answer"] = "true"
    return rows


def _build_qrels(corpus: dict[str, Any]) -> list[dict[str, Any]]:
    documents = {item["document_id"]: item for item in corpus["documents"]}
    chunks = {item["chunk_id"]: item for item in corpus["chunks"]}
    qrels: list[dict[str, Any]] = []
    for index, spec in enumerate(ANSWERABLE_SPECS, start=1):
        chunk_id = str(spec["chunk_id"])
        chunk = chunks.get(chunk_id)
        if chunk is None:
            raise ValueError(f"QREL target chunk does not exist: {chunk_id}")
        document = documents[chunk["document_id"]]
        target = _target(chunk, document)
        validate_target_integrity(
            target,
            documents,
            chunks,
            evidence_excerpt=str(spec["evidence_excerpt"]),
        )
        qrels.append(
            {
                "query_id": f"rpdev1-a{index:03d}",
                "query": spec["query"],
                "language": spec["language"],
                "query_class": spec["query_class"],
                "expected_document_id": document["document_id"],
                "document_title": document["title"],
                "expected_page": None,
                "expected_chunk_id": chunk_id,
                "source_locator": chunk["source_locator"],
                "acceptable_targets": [target],
                "alternate_targets": [],
                "evidence_excerpt": spec["evidence_excerpt"],
                "no_answer": False,
                "leakage_group_id": spec["leakage_group_id"],
                "review_status": "UNREVIEWED",
                "reviewer": None,
                "review_notes": "",
                "assistant_recommendation": "CANDIDATE_ANSWERABLE",
                "assistant_review_notes": (
                    "Authored from direct source paragraph inspection; target chunk content and XML hashes "
                    "validated. No retrieval rankings or model scores were consulted. Human review required."
                ),
            }
        )

    for row in _read_negatives():
        qrels.append(
            {
                "query_id": row["query_id"],
                "query": row["query"],
                "language": row["language"],
                "query_class": row["query_class"],
                "expected_document_id": None,
                "document_title": "",
                "expected_page": None,
                "expected_chunk_id": None,
                "source_locator": {"kind": "CORPUS_WIDE"},
                "acceptable_targets": [],
                "alternate_targets": [],
                "evidence_excerpt": "",
                "no_answer": True,
                "leakage_group_id": row["leakage_group_id"] or None,
                "review_status": "UNREVIEWED",
                "reviewer": None,
                "review_notes": "",
                "assistant_recommendation": row["assistant_recommendation"],
                "assistant_review_notes": row["assistant_review_notes"],
            }
        )
    qrels.sort(key=lambda row: row["query_id"])
    if len({row["query_id"] for row in qrels}) != len(qrels):
        raise ValueError("QREL query IDs must be unique.")
    if any(row["review_status"] != "UNREVIEWED" for row in qrels):
        raise ValueError("New candidate labels must remain UNREVIEWED.")
    return qrels


def _csv_rows(qrels: list[dict[str, Any]], corpus: dict[str, Any]) -> list[dict[str, str]]:
    documents = {item["document_id"]: item for item in corpus["documents"]}
    chunks = {item["chunk_id"]: item for item in corpus["chunks"]}
    rows = []
    for qrel in qrels:
        chunk = chunks.get(qrel["expected_chunk_id"])
        document = documents.get(qrel["expected_document_id"])
        locator = qrel["source_locator"]
        rows.append(
            {
                "query_id": qrel["query_id"],
                "query": qrel["query"],
                "language": qrel["language"],
                "class": qrel["query_class"],
                "document_title": qrel["document_title"],
                "source_kind": locator["kind"],
                "section": locator.get("section_path", ""),
                "paragraph_ordinal": str(locator.get("paragraph_ordinal", "")),
                "chunk_ordinal": str(locator.get("chunk_ordinal", "")),
                "xml_node_id": str(locator.get("xml_node_id") or ""),
                "expected_page": str(qrel["expected_page"] or ""),
                "expected_document_id": qrel["expected_document_id"] or "",
                "expected_chunk_id": qrel["expected_chunk_id"] or "",
                "evidence_excerpt": qrel["evidence_excerpt"],
                "alternate_targets": json.dumps(qrel["alternate_targets"], ensure_ascii=False),
                "no_answer": str(qrel["no_answer"]).lower(),
                "leakage_group_id": qrel["leakage_group_id"] or "",
                "review_status": qrel["review_status"],
                "reviewer": qrel["reviewer"] or "",
                "review_notes": qrel["review_notes"],
                "assistant_recommendation": qrel["assistant_recommendation"],
                "assistant_review_notes": qrel["assistant_review_notes"],
                "source_text_sha256": chunk["content_sha256"] if chunk else "",
                "source_xml_sha256": document["source_xml_sha256"] if document else "",
            }
        )
    return rows


def build(corpus_path: Path = DEFAULT_CORPUS) -> dict[str, Any]:
    corpus = _read_json(corpus_path)
    manifest = _read_json(DEFAULT_MANIFEST_PATH)
    if len(corpus["chunks"]) != manifest["chunk_count"]:
        raise ValueError("Local text companion and public chunk inventory disagree.")
    manifest_chunk_hashes = {
        item["chunk_id"]: item["content_sha256"] for item in manifest["chunks"]
    }
    for chunk in corpus["chunks"]:
        if manifest_chunk_hashes.get(chunk["chunk_id"]) != chunk["content_sha256"]:
            raise ValueError(f"Corpus source-text hash mismatch: {chunk['chunk_id']}")
    qrels = _build_qrels(corpus)
    chunk_inventory = json.dumps(
        manifest["chunks"], ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()
    return {
        "benchmark_id": "retrieval-policy-dev-v1",
        "status": "UNREVIEWED",
        "judgment_source": "assistant-authored direct source review; no model rankings; human review required",
        "review_gate": {"can_freeze": False, "unreviewed_count": len(qrels)},
        "corpus_manifest_sha256": _digest_bytes(DEFAULT_MANIFEST_PATH.read_bytes()),
        "chunk_inventory_sha256": _digest_bytes(chunk_inventory),
        "qrel_count": len(qrels),
        "query_class_distribution": dict(
            sorted(Counter(row["query_class"] for row in qrels).items())
        ),
        "language_distribution": dict(sorted(Counter(row["language"] for row in qrels).items())),
        "qrels": qrels,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    args = parser.parse_args()
    pack = build(args.corpus)
    JSON_OUTPUT.write_text(json.dumps(pack, ensure_ascii=False, sort_keys=True, indent=2) + "\n")
    rows = _csv_rows(pack["qrels"], _read_json(args.corpus))
    with CSV_OUTPUT.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(
        json.dumps(
            {
                "qrel_count": pack["qrel_count"],
                "answerable": sum(not row["no_answer"] for row in pack["qrels"]),
                "no_answer": sum(row["no_answer"] for row in pack["qrels"]),
                "unreviewed": pack["review_gate"]["unreviewed_count"],
                "csv": str(CSV_OUTPUT),
                "json": str(JSON_OUTPUT),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
