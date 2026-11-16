"""Write the manually authored, unreviewed qrel JSON/CSV from Phase 9 chunks.

This script only selects source passages by explicit document/page/text patterns.
It does not import embedding models or calculate retrieval rankings.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
EVAL_ROOT = ROOT / "services" / "embedding-evaluation"
MANIFEST_PATH = EVAL_ROOT / "real-paper-v1-manifest.json"
INVENTORY_PATH = EVAL_ROOT / "real-paper-v1-chunks.json"
QREL_JSON_PATH = EVAL_ROOT / "real-paper-qrels-v1.json"
REVIEW_DIR = EVAL_ROOT / "review"
QREL_CSV_PATH = REVIEW_DIR / "real-paper-qrels-v1.csv"
SUMMARY_PATH = REVIEW_DIR / "real-paper-qrels-v1-summary.md"


def _q(
    query_id: str,
    query: str,
    language: str,
    query_class: str,
    excerpt: str,
    document_id: str | None = None,
    selector: str | None = None,
    page: int | None = None,
) -> dict[str, Any]:
    return {
        "query_id": query_id,
        "query": query,
        "language": language,
        "query_class": query_class,
        "excerpt": excerpt,
        "target_specs": (
            [{"document_id": document_id, "selector": selector, "page": page}]
            if document_id
            else []
        ),
        "no_answer": False,
    }


QREL_SPECS = [
    _q(
        "ru_doi",
        "Which DOI identifies the study on crystalline-grid recognition?",
        "en",
        "identifier",
        "The opening page identifies the article with its DOI and research title.",
        "ru-crystal-grid-2025",
        r"10\.60797/IRJ\.2025\.160s\.25",
        1,
    ),
    _q(
        "ru_formats",
        "Which two file formats are proposed as inputs for the lattice-recognition program?",
        "en",
        "method_basis",
        "The paper names CIF and XYZ as alternative coordinate or structure inputs.",
        "ru-crystal-grid-2025",
        r"CIF.*XYZ",
        2,
    ),
    _q(
        "ru_cell_fields",
        "Which database fields represent unit-cell edge lengths and angles?",
        "en",
        "table_derived",
        "The schema description lists three cell-length columns and three angular columns.",
        "ru-crystal-grid-2025",
        r"cell_length_a.*cell_length_b.*cell_length_c",
        5,
    ),
    _q(
        "ru_data_source",
        "Which open database was used as the source of known crystal records?",
        "en",
        "named_material",
        "The implementation section names the Crystallographic Open Database.",
        "ru-crystal-grid-2025",
        r"Crystallographic Open Database",
        5,
    ),
    _q(
        "ru_sample_size",
        "Approximately how many compounds were used in the application test?",
        "en",
        "numeric_value",
        "The discussion describes a test set of about thirty simple substances.",
        "ru-crystal-grid-2025",
        r"около 30 простейших веществ",
        6,
    ),
    _q(
        "ru_classifier_semantics",
        "How does the proposed system choose a likely lattice type from ion coordinates?",
        "en",
        "semantic",
        "The algorithm compares input ions with stored ion/material records and orders candidate matches by probability.",
        "ru-crystal-grid-2025",
        r"список наиболее вероятных типов кристаллических решеток",
        4,
    ),
    _q(
        "ru_figure_result",
        "In the displayed example, which lattice class was retained as the result?",
        "en",
        "figure_derived",
        "The output example reports several likely compounds and classifies their shared lattice as cubic.",
        "ru-crystal-grid-2025",
        r"все найденные вещества имеют кубическую кристаллическую решетку",
        6,
    ),
    _q(
        "ru_russian_result",
        "Какой из найденных вариантов получил наибольшую вероятность в демонстрационном примере?",
        "ru",
        "multilingual",
        "В примере приведены ранжированные вещества; верхние варианты имеют одинаковую максимальную вероятность.",
        "ru-crystal-grid-2025",
        r"potassium chloride \(20,37%\), disodium oxide \(20,37%\)",
        6,
    ),
    _q(
        "poly_doi",
        "Which DOI identifies the study of the Ac-NDGA nanostructured formulation?",
        "en",
        "identifier",
        "The article header contains the DOI and the title describing the nanostructured analog.",
        "polymer-nanospheres-2020",
        r"10\.1186/s12951-020-00628-z",
        1,
    ),
    _q(
        "poly_compound",
        "What abbreviation is used for the acetylated nordihydroguaiaretic-acid analog?",
        "en",
        "named_compound",
        "The article uses a short chemical name for the acetylated NDGA derivative.",
        "polymer-nanospheres-2020",
        r"Ac-NDGA",
        1,
    ),
    _q(
        "poly_mass",
        "What observed and calculated molecular masses are compared for Ac-NDGA?",
        "en",
        "numeric_value",
        "The mass-spectrometry discussion contrasts one observed mass with the calculated molecular mass.",
        "polymer-nanospheres-2020",
        r"MW 493\.21 \(obs\).*470\.52",
        6,
    ),
    _q(
        "poly_dls_method",
        "Which instrument technique was used to measure nanosphere size distribution and zeta potential?",
        "en",
        "method_basis",
        "The characterization procedure describes dynamic light scattering with a particle-size analyzer.",
        "polymer-nanospheres-2020",
        r"Dynamic Light Scattering Measurements",
        4,
    ),
    _q(
        "poly_dls_conditions",
        "What sample preparation was used before the nanosphere DLS measurement?",
        "en",
        "experimental_condition",
        "The procedure specifies a water suspension, sonication, and repeated instrument scans.",
        "polymer-nanospheres-2020",
        r"5 mg.*3 ml.*sonicator",
        4,
    ),
    _q(
        "poly_release",
        "What release fraction and time are reported in the abstract for the drug-loaded spheres?",
        "en",
        "numeric_value",
        "The abstract reports a release fraction at a stated six-hour time point.",
        "polymer-nanospheres-2020",
        r"82.*0\.25.*6 h",
        1,
    ),
    _q(
        "poly_figure",
        "What does Figure 4 compare for the two nanosphere formulations?",
        "en",
        "figure_derived",
        "The figure caption identifies DLS size distributions for the unloaded and drug-loaded formulations.",
        "polymer-nanospheres-2020",
        r"Fig\. 4 Size distribution.*Dynamic Light Scattering",
        8,
    ),
    _q(
        "poly_semantic",
        "Why were two polymers combined in the drug-carrier formulation?",
        "en",
        "semantic",
        "The discussion explains that the two polymer matrices provide complementary hydrophilic and hydrophobic behavior.",
        "polymer-nanospheres-2020",
        r"PCL.*hydrophobic polymer.*PEG.*hydrophilic polymer",
        6,
    ),
    _q(
        "oxide_doi",
        "Which DOI identifies the fungal synthesis study of silver and metal-oxide nanoparticles?",
        "en",
        "identifier",
        "The first page gives the DOI alongside the nanoparticle-synthesis title.",
        "metal-oxide-nanoparticles-2020",
        r"10\.1038/s41598-020-77294-6",
        1,
    ),
    _q(
        "oxide_species",
        "Which three nanoparticle materials are named in the study title?",
        "en",
        "formula",
        "The title names silver and two metal oxides made using the fungal strain.",
        "metal-oxide-nanoparticles-2020",
        r"Ag, CuO and ZnO nanoparticles",
        1,
    ),
    _q(
        "oxide_dls",
        "Which particle-size measurement is reported from the DLS characterization?",
        "en",
        "numeric_value",
        "The DLS results describe average hydrodynamic diameters and distribution peaks for the samples.",
        "metal-oxide-nanoparticles-2020",
        r"average hydrodynamic diameter",
        2,
    ),
    _q(
        "oxide_xray",
        "What X-ray wavelength was used for the diffraction measurements?",
        "en",
        "method_basis",
        "The XRD method gives the weighted Cu-K-alpha wavelength used in the measurements.",
        "metal-oxide-nanoparticles-2020",
        r"λ = 0\.15419 nm",
        3,
    ),
    _q(
        "oxide_ph",
        "At what initial pH did rapid nanoparticle precipitation occur after alkalinization?",
        "en",
        "experimental_condition",
        "The synthesis results describe rapid precipitation after adjusting the initial filtrate to a strongly alkaline pH.",
        "metal-oxide-nanoparticles-2020",
        r"within 10 min.*pH 12",
        3,
    ),
    _q(
        "oxide_tga",
        "What temperature span was covered by the nanoparticle thermal-degradation analysis?",
        "en",
        "numeric_value",
        "The thermal-analysis passage specifies a nitrogen-atmosphere run over a broad heating range.",
        "metal-oxide-nanoparticles-2020",
        r"25 to 900 °C under nitrogen",
        3,
    ),
    _q(
        "oxide_figure",
        "Which measurements are combined in the zinc-oxide nanoparticle figure caption?",
        "en",
        "figure_derived",
        "The figure caption describes particle-size, microscopy, and diffraction evidence for the ZnO samples.",
        "metal-oxide-nanoparticles-2020",
        r"Size distribution of ZnO nanoparticles.*DLS",
        5,
    ),
    _q(
        "oxide_ru_to_en",
        "Какой диапазон углов использовали для регистрации порошковой дифракционной картины?",
        "ru",
        "multilingual",
        "The English experimental paragraph states the 2-theta scan interval for the diffraction patterns.",
        "metal-oxide-nanoparticles-2020",
        r"15° to 60° 2θ range",
        3,
    ),
    _q(
        "xrd_doi",
        "Which DOI identifies the paper combining powder XRD with calorimetry to examine suspect medicines?",
        "en",
        "identifier",
        "The article's bibliographic header supplies the DOI for the diffraction-and-thermal study.",
        "counterfeit-drug-xrd-dsc-2018",
        r"10\.1007/s00706-018-2193-z",
        1,
    ),
    _q(
        "xrd_drugs",
        "Which active substances are named among the medicines investigated?",
        "en",
        "named_compound",
        "The materials section lists aspirin-related and vitamin-C products as the tested medicines.",
        "counterfeit-drug-xrd-dsc-2018",
        r"acetylsalicylic acid.*ascorbic acid",
        9,
    ),
    _q(
        "xrd_peak_tolerance",
        "What two 2-theta values are compared for the first diffraction line in Table 5?",
        "en",
        "numeric_value",
        "The table compares an ICDD reference position with the measured pattern position for its first line.",
        "counterfeit-drug-xrd-dsc-2018",
        r"7\.5497 7\.6842",
        7,
    ),
    _q(
        "xrd_methods",
        "Which pair of experimental methods is used to distinguish authentic from counterfeit samples?",
        "en",
        "method_basis",
        "The article's conclusion relies on X-ray powder diffraction together with differential scanning calorimetry.",
        "counterfeit-drug-xrd-dsc-2018",
        r"XRPD and DSC procedure",
        9,
    ),
    _q(
        "xrd_scan",
        "What 2-theta interval was used in the powder X-ray measurements?",
        "en",
        "experimental_condition",
        "The experimental method states the angular range and step used for the powder scan.",
        "counterfeit-drug-xrd-dsc-2018",
        r"angle range 2 h =5",
        9,
    ),
    _q(
        "xrd_thermal",
        "What approximate mass-loss range is described for aspirin-containing products?",
        "en",
        "numeric_value",
        "The thermal results report a product-dependent mass loss associated with possible dissociation.",
        "counterfeit-drug-xrd-dsc-2018",
        r"weight loss of about 5–10%",
        6,
    ),
    _q(
        "xrd_figure",
        "What thermal curves are presented in Figure 6?",
        "en",
        "figure_derived",
        "The caption identifies the DSC/TG curves for products containing acetylsalicylic acid.",
        "counterfeit-drug-xrd-dsc-2018",
        r"DSC/TG curves for the drugs",
        8,
    ),
    _q(
        "xrd_semantic",
        "Why do the authors combine diffraction and thermal analysis when screening medicines?",
        "en",
        "semantic",
        "The conclusion says the methods jointly help verify active ingredients and detect material changes.",
        "counterfeit-drug-xrd-dsc-2018",
        r"combination of the two methods, XRD and DSC",
        6,
    ),
    _q(
        "framework_doi",
        "Which DOI identifies the aqueous supramolecular organic framework study?",
        "en",
        "identifier",
        "The paper begins with the DOI for the three-dimensional framework and ion-sponge study.",
        "supramolecular-framework-water-2014",
        r"10\.1038/ncomms6574",
        1,
    ),
    _q(
        "framework_material",
        "What framework nickname is used for the Com-Tetra material?",
        "en",
        "named_compound",
        "The paper names the tetratopic-complex framework used in the aqueous ion-sponge experiments.",
        "supramolecular-framework-water-2014",
        r"Com-Tetra",
        3,
    ),
    _q(
        "framework_spacing",
        "What d-spacing was observed for the broad SAXS peak in water?",
        "en",
        "numeric_value",
        "The solution SAXS result reports an observed spacing and compares it with a modelled lattice plane.",
        "supramolecular-framework-water-2014",
        r"d-spacing around 5\.1 nm",
        4,
    ),
    _q(
        "framework_saxs",
        "Which scattering technique provided the solution-phase periodicity evidence?",
        "en",
        "method_basis",
        "A small-angle X-ray scattering experiment is described for the aqueous solution.",
        "supramolecular-framework-water-2014",
        r"small-angle X-ray-scattering \(SAXS\)",
        4,
    ),
    _q(
        "framework_activation",
        "At what activation temperature was gas adsorption measured after vacuum treatment?",
        "en",
        "experimental_condition",
        "The gas-sorption passage specifies a high-temperature vacuum activation step.",
        "supramolecular-framework-water-2014",
        r"180.*10 h",
        9,
    ),
    _q(
        "framework_semantic",
        "How does the framework behave toward dissolved organic guests?",
        "en",
        "semantic",
        "The discussion describes selective uptake and controllable release of conjugated guests from solution.",
        "supramolecular-framework-water-2014",
        r"Com-Tetra functioned like an.*ion sponge",
        7,
    ),
    _q(
        "framework_figure",
        "What evidence is shown for microcrystal formation during slow solvent evaporation?",
        "en",
        "figure_derived",
        "The text associates the figure with solidification and diffraction-based evidence of microcrystallization.",
        "supramolecular-framework-water-2014",
        r"microcrystallization.*selected area electron diffraction",
        5,
    ),
    _q(
        "framework_gas",
        "What nitrogen uptake and BET area are reported for the activated microcrystals?",
        "en",
        "table_derived",
        "The adsorption results give a nitrogen amount and a specific surface-area value.",
        "supramolecular-framework-water-2014",
        r"5\.4 cm.*10\.3 m",
        9,
    ),
    _q(
        "xpcs_doi",
        "Which DOI identifies the robotic pendant-drop XPCS paper?",
        "en",
        "identifier",
        "The title page names the XPCS article and includes its DOI.",
        "xpcs-pendant-drop-2023",
        r"10\.1038/s41377-023-01233-z",
        1,
    ),
    _q(
        "xpcs_technique",
        "Which technique is used to follow nanoparticle dynamics through speckle correlations?",
        "en",
        "method_basis",
        "The methods discussion describes X-ray photon correlation analysis of time-varying speckles.",
        "xpcs-pendant-drop-2023",
        r"intensity correlation.*XPCS",
        4,
    ),
    _q(
        "xpcs_diameter",
        "What diameter did the horizontal alignment scan report for the pendant drop?",
        "en",
        "numeric_value",
        "The alignment scan result gives the pendant-drop diameter in millimetres.",
        "xpcs-pendant-drop-2023",
        r"diameter of 2\.4 mm",
        3,
    ),
    _q(
        "xpcs_frames",
        "At what frame rate were the scattering data collected?",
        "en",
        "numeric_value",
        "The data-collection description specifies a 52-kHz detector-frame rate.",
        "xpcs-pendant-drop-2023",
        r"1\.92 s.*52 kHz",
        8,
    ),
    _q(
        "xpcs_setup",
        "What protective layer surrounds the pendant drop in the alignment example?",
        "en",
        "experimental_condition",
        "The setup description identifies a thin polymer sheet around the drop to limit airflow and evaporation.",
        "xpcs-pendant-drop-2023",
        r"0\.13 mm thick polycarbonate sheet",
        3,
    ),
    _q(
        "xpcs_semantic",
        "Why can XPCS reveal nanoparticle dynamics that differ from a conventional DLS readout?",
        "en",
        "semantic",
        "The discussion contrasts the large pixelated detector and accessible length scales with DLS.",
        "xpcs-pendant-drop-2023",
        r"An advantage of XPCS compared to DLS",
        4,
    ),
    _q(
        "xpcs_figure",
        "What physical quantity is estimated from the horizontal alignment scan in Figure 2?",
        "en",
        "figure_derived",
        "The scan tracks transmitted X-rays as the sample moves across the beam to estimate drop size.",
        "xpcs-pendant-drop-2023",
        r"horizontal alignment scan shows a pendant drop diameter",
        3,
    ),
    _q(
        "xpcs_semantic2",
        "How does the robotic setup help make complex XPCS experiments more reproducible?",
        "en",
        "paraphrase",
        "The workflow section explains that automation sequences actions across the robot and beamline components.",
        "xpcs-pendant-drop-2023",
        r"YAML format",
        6,
    ),
    _q(
        "xpcs_noisy_partial",
        "Drop size from the sideways beam scan?",
        "en",
        "noisy_partial",
        "The alignment passage gives the measured pendant-drop diameter from a horizontal scan.",
        "xpcs-pendant-drop-2023",
        r"horizontal alignment scan shows a pendant drop diameter",
        3,
    ),
    _q(
        "electro_doi",
        "Which DOI identifies the charge-transfer descriptor study for CO2 reduction?",
        "en",
        "identifier",
        "The first page names the electrocatalysis article and its DOI.",
        "co2-electrocatalyst-descriptor-2023",
        r"10\.1038/s41467-023-37929-4",
        1,
    ),
    _q(
        "electro_reaction",
        "Which product-forming electrochemical reaction is modelled in the main mechanism?",
        "en",
        "named_compound",
        "The mechanism follows electrochemical CO2 conversion through adsorbed intermediates to CO.",
        "co2-electrocatalyst-descriptor-2023",
        r"electrochemical reduction of CO2 to CO",
        3,
    ),
    _q(
        "electro_descriptor",
        "What descriptor is proposed to supplement adsorption energies when screening electrocatalysts?",
        "en",
        "method_basis",
        "The central proposal uses a surface-charge-related electrochemical descriptor.",
        "co2-electrocatalyst-descriptor-2023",
        r"potential of zero charge \(PZC\)",
        9,
    ),
    _q(
        "electro_catmap",
        "Which software package is named for the microkinetic calculations?",
        "en",
        "method_basis",
        "The modeling subsection identifies the package used to solve mean-field rate equations.",
        "co2-electrocatalyst-descriptor-2023",
        r"CatMAP package",
        10,
    ),
    _q(
        "electro_conditions",
        "Which electrochemical variables are varied in the reaction-energy treatment?",
        "en",
        "experimental_condition",
        "The article emphasizes dependence on applied potential and pH for intermediate energies.",
        "co2-electrocatalyst-descriptor-2023",
        r"potential and pH dependence",
        2,
    ),
    _q(
        "electro_semantic",
        "Why can a charge-transfer descriptor change predicted catalyst selectivity?",
        "en",
        "semantic",
        "The discussion connects interfacial charge and electric field effects to reaction intermediates and product trends.",
        "co2-electrocatalyst-descriptor-2023",
        r"surface charge density.*potential of zero charge",
        9,
    ),
    _q(
        "electro_figure",
        "Which descriptor controls the location of the reported selectivity-volcano trend?",
        "en",
        "figure_derived",
        "The results relate the selectivity pattern to the potential-of-zero-charge descriptor.",
        "co2-electrocatalyst-descriptor-2023",
        r"selectivity volcano",
        7,
    ),
    _q(
        "electro_paraphrase",
        "In the copper-on-gold examples, what change is suggested to improve CO formation activity?",
        "en",
        "paraphrase",
        "The results discuss modifying gold with copper to shift the relevant charge descriptor.",
        "co2-electrocatalyst-descriptor-2023",
        r"dope Cu into an Au substrate",
        6,
    ),
    _q(
        "chiral_doi",
        "Which DOI identifies the chiral-framework disassembly study?",
        "en",
        "identifier",
        "The title page identifies the organometallic-helix paper and its DOI.",
        "chiral-organometallic-helices-2025",
        r"10\.1038/s41467-025-63459-2",
        1,
    ),
    _q(
        "chiral_material",
        "Which metal is present in the D- and L-enantiomer crystal materials?",
        "en",
        "formula",
        "The article uses copper-containing crystal and single-unit helix names for the enantiomers.",
        "chiral-organometallic-helices-2025",
        r"D-Cu-crystal.*L-Cu-crystal",
        3,
    ),
    _q(
        "chiral_bond",
        "What two hydrogen-bond distances are reported in the structural discussion?",
        "en",
        "numeric_value",
        "The crystal-contact paragraph gives two O-H···O distances in angstroms.",
        "chiral-organometallic-helices-2025",
        r"2\.203 Å.*1\.918 Å",
        4,
    ),
    _q(
        "chiral_spacegroup",
        "Which crystallographic system and chiral space groups are assigned to the two crystals?",
        "en",
        "method_basis",
        "Single-crystal diffraction assigns a tetragonal phase with opposite enantiomorphic space groups.",
        "chiral-organometallic-helices-2025",
        r"tetragonal crystallographic phase.*P4",
        3,
    ),
    _q(
        "chiral_synthesis",
        "At what temperature are the copper crystals prepared according to the synthesis passage?",
        "en",
        "experimental_condition",
        "The synthesis description includes a 60-degree-Celsius step.",
        "chiral-organometallic-helices-2025",
        r"at 60 °C",
        3,
    ),
    _q(
        "chiral_dimensions",
        "What average dimensions are reported for the D-enantiomer crystals?",
        "en",
        "numeric_value",
        "The characterization passage reports a crystal yield and average length, width, and height.",
        "chiral-organometallic-helices-2025",
        r"15\.9.*4\.3",
        11,
    ),
    _q(
        "chiral_figure",
        "What reversible structural change is illustrated between the crystals and the single-unit helices?",
        "en",
        "figure_derived",
        "The results describe a reversible assembly–disassembly cycle between parent crystals and helical units.",
        "chiral-organometallic-helices-2025",
        r"reversible assembly-disassembly cycling",
        6,
    ),
    _q(
        "chiral_semantic",
        "What is the main structural strategy used to obtain the chiral metal-organic helices?",
        "en",
        "semantic",
        "The conclusion describes disassembling hydrogen-bonded crystals into copper-based single-unit helices.",
        "chiral-organometallic-helices-2025",
        r"assembly-disassembly strategy",
        10,
    ),
]

GLOBAL_QRELS = [
    {
        "query_id": "na_basis_methane",
        "query": "Which basis set was used for a B3LYP geometry optimization of methane?",
        "language": "en",
        "query_class": "no_answer",
        "excerpt": "Plausible computational-chemistry question; none of the eight papers reports a methane B3LYP basis-set calculation.",
        "target_specs": [],
        "no_answer": True,
    },
    {
        "query_id": "na_polymer_modulus",
        "query": "What tensile modulus was measured for the PCL/PEG nanospheres?",
        "language": "en",
        "query_class": "no_answer",
        "excerpt": "Plausible polymer-materials property; the corpus contains no reported tensile-modulus measurement for these nanospheres.",
        "target_specs": [],
        "no_answer": True,
    },
    {
        "query_id": "na_zno_bandgap",
        "query": "What optical band gap was measured for the ZnO nanoparticles?",
        "language": "en",
        "query_class": "no_answer",
        "excerpt": "Plausible nanoparticle characterization question; the ZnO paper's indexed text contains no measured optical-band-gap value.",
        "target_specs": [],
        "no_answer": True,
    },
    {
        "query_id": "na_co2_methanol",
        "query": "What overpotential produced methanol during the CO2 electroreduction study?",
        "language": "en",
        "query_class": "no_answer",
        "excerpt": "Plausible electrocatalysis question; the selected electrocatalysis paper models CO formation and does not report methanol overpotential.",
        "target_specs": [],
        "no_answer": True,
    },
    {
        "query_id": "ambiguous_xray",
        "query": "Which papers in the corpus use X-ray methods to characterize a material?",
        "language": "en",
        "query_class": "ambiguous",
        "excerpt": "Multiple acceptable sources use diffraction, scattering, or related X-ray characterization; each selected target names one example.",
        "target_specs": [
            {
                "document_id": "metal-oxide-nanoparticles-2020",
                "selector": r"λ = 0\.15419 nm",
                "page": 3,
            },
            {
                "document_id": "counterfeit-drug-xrd-dsc-2018",
                "selector": r"XRPD and DSC procedure",
                "page": 9,
            },
            {
                "document_id": "supramolecular-framework-water-2014",
                "selector": r"small-angle X-ray-scattering",
                "page": 4,
            },
            {
                "document_id": "chiral-organometallic-helices-2025",
                "selector": r"SXRD analyses",
                "page": 3,
            },
        ],
        "no_answer": False,
    },
    {
        "query_id": "ambiguous_thermal",
        "query": "Which papers report thermal-analysis measurements on their material samples?",
        "language": "en",
        "query_class": "ambiguous",
        "excerpt": "Several studies report TGA, DSC, or related thermal measurements; multiple sources are intentionally acceptable.",
        "target_specs": [
            {
                "document_id": "polymer-nanospheres-2020",
                "selector": r"Thermogravimetric analysis",
                "page": 4,
            },
            {
                "document_id": "metal-oxide-nanoparticles-2020",
                "selector": r"Thermal degradation analysis \(TGA\)",
                "page": 3,
            },
            {
                "document_id": "counterfeit-drug-xrd-dsc-2018",
                "selector": r"DSC/TG curves",
                "page": 8,
            },
        ],
        "no_answer": False,
    },
    {
        "query_id": "cross_ru_to_en_xpcs",
        "query": "Какова частота регистрации кадров и длительность сбора данных?",
        "language": "ru",
        "query_class": "multilingual",
        "excerpt": "The English XPCS experiment description reports both a detector frame rate and a total collection interval.",
        "target_specs": [
            {"document_id": "xpcs-pendant-drop-2023", "selector": r"1\.92 s.*52 kHz", "page": 8}
        ],
        "no_answer": False,
    },
    {
        "query_id": "cross_en_to_ru_formats",
        "query": "Which two structure-file formats are proposed for lattice-recognition input?",
        "language": "en",
        "query_class": "multilingual",
        "excerpt": "The Russian-language discussion names CIF and XYZ as alternative structure or coordinate inputs.",
        "target_specs": [
            {"document_id": "ru-crystal-grid-2025", "selector": r"CIF.*XYZ", "page": 2}
        ],
        "no_answer": False,
    },
]


def _resolve_targets(
    specs: list[dict[str, Any]],
    text_documents: dict[str, list[dict[str, Any]]],
    inventory_by_doc: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    targets = []
    for spec in specs:
        doc_id = spec["document_id"]
        rows = text_documents[doc_id]
        matching = [
            row
            for row in rows
            if (spec.get("page") is None or row["page_number"] == spec["page"])
            and re.search(
                spec["selector"],
                re.sub(r"\s+", " ", row["content"]),
                re.IGNORECASE | re.DOTALL,
            )
        ]
        if not matching:
            raise ValueError(f"No source-inspected chunk matched {doc_id}:{spec['selector']}.")
        row = matching[0]
        document = inventory_by_doc[doc_id]
        chunk = next(item for item in document["chunks"] if item["chunk_id"] == row["chunk_id"])
        targets.append(
            {
                "benchmark_document_id": doc_id,
                "document_id": document["document_id"],
                "page": row["page_number"],
                "chunk_id": row["chunk_id"],
                "evidence_anchor_id": chunk["anchor_id"],
                "source_type": chunk["source_type"],
                "content_hash": chunk["content_hash"],
            }
        )
    return targets


def build() -> tuple[dict[str, Any], list[dict[str, Any]], str]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    inventory = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
    text_path = Path("/tmp/chemdft-real-paper-v1-chunk-text.json")
    text_documents = json.loads(text_path.read_text(encoding="utf-8"))["documents"]
    manifest_by_id = {paper["benchmark_document_id"]: paper for paper in manifest["papers"]}
    inventory_by_doc = {
        document["benchmark_document_id"]: document for document in inventory["documents"]
    }

    specs = QREL_SPECS + GLOBAL_QRELS
    qrels = []
    for ordinal, spec in enumerate(specs, start=1):
        targets = _resolve_targets(spec["target_specs"], text_documents, inventory_by_doc)
        primary = targets[0] if targets else None
        primary_paper = manifest_by_id.get(primary["benchmark_document_id"]) if primary else None
        qrel = {
            "query_id": f"rpv1-{ordinal:03d}",
            "source_spec_id": spec["query_id"],
            "query": spec["query"],
            "language": spec["language"],
            "query_class": spec["query_class"],
            "expected_document_id": primary["document_id"] if primary else None,
            "expected_benchmark_document_id": primary["benchmark_document_id"] if primary else None,
            "expected_page": primary["page"] if primary else None,
            "expected_chunk_id": primary["chunk_id"] if primary else None,
            "expected_evidence_anchor_id": primary["evidence_anchor_id"] if primary else None,
            "acceptable_targets": targets,
            "alternate_targets": targets[1:],
            "no_answer": bool(spec["no_answer"]),
            "evidence_excerpt": spec["excerpt"],
            "document_title": primary_paper["title"]
            if primary_paper
            else "Corpus-wide no-answer candidate",
            "review_status": "UNREVIEWED",
            "reviewer": None,
            "review_notes": "",
        }
        if qrel["no_answer"] and targets:
            raise ValueError(f"No-answer qrel {qrel['query_id']} has target chunks.")
        if not qrel["no_answer"] and not targets:
            raise ValueError(f"Answerable qrel {qrel['query_id']} has no target chunks.")
        qrels.append(qrel)

    output = {
        "benchmark_id": "real-scientific-retrieval-v1",
        "status": "UNREVIEWED",
        "corpus_manifest": "real-paper-v1-manifest.json",
        "corpus_chunk_inventory": "real-paper-v1-chunks.json",
        "authoring_method": "Manually authored from licensed source PDFs and Phase 9 parser/chunker output; no embedding models or rankings were run.",
        "qrels": qrels,
    }
    validate(output, manifest, inventory)
    return output, qrels, _summary(qrels, manifest, inventory)


def validate(output: dict[str, Any], manifest: dict[str, Any], inventory: dict[str, Any]) -> None:
    paper_ids = {paper["benchmark_document_id"] for paper in manifest["papers"]}
    expected_chunks = {
        chunk["chunk_id"]: (
            document["benchmark_document_id"],
            document["document_id"],
            chunk["page_number"],
        )
        for document in inventory["documents"]
        for chunk in document["chunks"]
    }
    qrels = output["qrels"]
    if len({item["query_id"] for item in qrels}) != len(qrels):
        raise ValueError("Query IDs must be unique.")
    if output["status"] != "UNREVIEWED" or any(q["review_status"] != "UNREVIEWED" for q in qrels):
        raise ValueError("All benchmark qrels must remain UNREVIEWED.")
    for qrel in qrels:
        if qrel["no_answer"] != (len(qrel["acceptable_targets"]) == 0):
            raise ValueError(f"No-answer state and target set disagree for {qrel['query_id']}.")
        for target in qrel["acceptable_targets"]:
            if target["benchmark_document_id"] not in paper_ids:
                raise ValueError(f"Unknown paper in qrel target {qrel['query_id']}.")
            chunk = expected_chunks.get(target["chunk_id"])
            if chunk != (target["benchmark_document_id"], target["document_id"], target["page"]):
                raise ValueError(f"Chunk/document/page mismatch for {qrel['query_id']}.")
        for target in qrel["acceptable_targets"]:
            page_count = next(
                paper["page_count"]
                for paper in manifest["papers"]
                if paper["benchmark_document_id"] == target["benchmark_document_id"]
            )
            if not 1 <= target["page"] <= page_count:
                raise ValueError(f"Out-of-range page for {qrel['query_id']}.")


def _summary(
    qrels: list[dict[str, Any]], manifest: dict[str, Any], inventory: dict[str, Any]
) -> str:
    classes = Counter(qrel["query_class"] for qrel in qrels)
    languages = Counter(qrel["language"] for qrel in qrels)
    by_document = Counter(
        target["benchmark_document_id"] for qrel in qrels for target in qrel["acceptable_targets"]
    )
    multi = sum(len(qrel["acceptable_targets"]) > 1 for qrel in qrels)
    missing_chunks = sum(not qrel["no_answer"] and not qrel["expected_chunk_id"] for qrel in qrels)
    missing_pages = sum(not qrel["no_answer"] and qrel["expected_page"] is None for qrel in qrels)
    total_chunks = sum(document["chunk_count"] for document in inventory["documents"])
    lines = [
        "# Real-paper qrel review pack summary",
        "",
        "Status: **UNREVIEWED — benchmark not frozen.** No retrieval or embedding ranking was run.",
        "",
        f"- Papers: {len(manifest['papers'])}",
        f"- Production-shaped chunks: {total_chunks}",
        f"- Candidate queries: {len(qrels)}",
        f"- No-answer: {sum(q['no_answer'] for q in qrels)}",
        f"- Ambiguous/multi-target: {multi}",
        f"- Missing target chunks/pages: {missing_chunks}/{missing_pages}",
        "",
        "## Queries by paper (target-bearing queries)",
        "",
    ]
    for paper in manifest["papers"]:
        doc_id = paper["benchmark_document_id"]
        lines.append(
            f"- `{doc_id}` — {by_document[doc_id]} target rows; {paper['chunk_count']} chunks"
        )
    lines.extend(["", "## Queries by class", ""])
    lines.extend(f"- `{name}`: {count}" for name, count in sorted(classes.items()))
    lines.extend(["", "## Queries by language", ""])
    lines.extend(f"- `{name}`: {count}" for name, count in sorted(languages.items()))
    lines.extend(
        [
            "",
            "## Review cautions",
            "",
            "- All rows are candidate judgments; a domain reviewer must approve, correct, or reject each row.",
            "- Evidence clues are concise paraphrases, not quotations. Reviewers should open the cited paper/page and verify the target.",
            "- No-answer rows need a full-corpus absence check. Multi-target rows deliberately have several acceptable source chunks.",
            "- Figure/table rows use only text/captions returned by the production PDF text parser; image-only content is not inferred.",
            "- Source anchors are page/chunk references. The isolated parser run did not create Phase 7 database anchor UUIDs.",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    output, qrels, summary = build()
    if not args.check_only:
        REVIEW_DIR.mkdir(parents=True, exist_ok=True)
        QREL_JSON_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
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
        with QREL_CSV_PATH.open("w", encoding="utf-8-sig", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
            writer.writeheader()
            for qrel in qrels:
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
                        "alternate_targets": json.dumps(
                            qrel["alternate_targets"], ensure_ascii=False
                        ),
                        "no_answer": str(qrel["no_answer"]).lower(),
                        "review_status": qrel["review_status"],
                        "reviewer": qrel["reviewer"] or "",
                        "review_notes": qrel["review_notes"],
                    }
                )
        SUMMARY_PATH.write_text(summary, encoding="utf-8")
    print(summary)


if __name__ == "__main__":
    main()
