from __future__ import annotations

import argparse
import hashlib
import io
import json
import random
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps
from rdkit import Chem
from rdkit.Chem import Draw

ROOT = Path(__file__).parents[2] / "data" / "v1"
LICENSE = "CC0-1.0"
PROVENANCE = (
    "ChemDFT synthetic image generated locally from hand-authored SMILES or schematic recipe"
)

MOLECULES = [
    ("simple_organic", "simple_ethanol", "CCO"),
    ("simple_organic", "simple_acetone", "CC(=O)C"),
    ("simple_organic", "simple_acetic_acid", "CC(=O)O"),
    ("simple_organic", "simple_propylamine", "CCCN"),
    ("simple_organic", "simple_butane", "CCCC"),
    ("aromatic", "aromatic_benzene", "c1ccccc1"),
    ("aromatic", "aromatic_pyridine", "c1ccncc1"),
    ("aromatic", "aromatic_anisole", "COc1ccccc1"),
    ("aromatic", "aromatic_naphthalene", "c1ccc2ccccc2c1"),
    ("aromatic", "aromatic_biphenyl", "c1ccc(-c2ccccc2)cc1"),
    ("heterocycle", "hetero_morpholine", "O1CCNCC1"),
    ("heterocycle", "hetero_imidazole", "c1ncc[nH]1"),
    ("heterocycle", "hetero_thiophene", "c1ccsc1"),
    ("heterocycle", "hetero_pyrrolidine", "N1CCCC1"),
    ("heterocycle", "hetero_oxazole", "c1ncco1"),
    ("charged", "charged_ammonium", "[NH4+]"),
    ("charged", "charged_acetate", "CC(=O)[O-]"),
    ("charged", "charged_glycine", "[NH3+]CC(=O)[O-]"),
    ("charged", "charged_formate", "O=C[O-]"),
    ("salts", "salt_sodium_chloride", "[Na+].[Cl-]"),
    ("salts", "salt_sodium_acetate", "CC(=O)[O-].[Na+]"),
    ("salts", "salt_ammonium_chloride", "[NH4+].[Cl-]"),
    ("stereochemistry", "stereo_lactic_acid_r", "C[C@H](O)C(=O)O"),
    ("stereochemistry", "stereo_lactic_acid_s", "C[C@@H](O)C(=O)O"),
    ("stereochemistry", "stereo_alanine", "N[C@@H](C)C(=O)O"),
    ("stereochemistry", "stereo_halogen", "F[C@](Cl)(Br)I"),
    ("stereochemistry", "stereo_two_centers", "N[C@@H](C)[C@H](O)C"),
    ("isotope", "isotope_carbon13", "[13CH4]"),
    ("isotope", "isotope_heavy_water", "[2H]O[2H]"),
    ("explicit_hydrogen", "explicit_hydrogen_methanol", "[H]OC([H])([H])[H]"),
    ("explicit_hydrogen", "explicit_hydrogen_hf", "[H]F"),
    ("dense_structure", "dense_caffeine", "Cn1c(=O)c2c(ncn2C)n(C)c1=O"),
    ("dense_structure", "dense_aspirin", "CC(=O)Oc1ccccc1C(=O)O"),
]


def _png(image: Image.Image) -> bytes:
    output = io.BytesIO()
    image.convert("RGB").save(output, format="PNG", optimize=True)
    return output.getvalue()


def _mol_image(smiles: str, size: tuple[int, int] = (512, 512)) -> Image.Image:
    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None:
        raise ValueError(f"Invalid dataset SMILES: {smiles}")
    return Draw.MolToImage(molecule, size=size, kekulize=True, wedgeBonds=True).convert("RGB")


def _transform(image: Image.Image, name: str, seed: int) -> Image.Image:
    rng = random.Random(seed)
    if name == "rotated_scaled":
        image = image.resize((350, 350), Image.Resampling.LANCZOS).rotate(
            22, expand=True, fillcolor="white"
        )
    elif name == "low_resolution":
        image = image.resize((96, 96), Image.Resampling.LANCZOS).resize(
            (512, 512), Image.Resampling.NEAREST
        )
    elif name == "blur_compression":
        image = image.filter(ImageFilter.GaussianBlur(1.8))
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=28)
        image = Image.open(io.BytesIO(buffer.getvalue())).convert("RGB")
    elif name == "grayscale_scan":
        image = ImageOps.grayscale(image).convert("RGB")
    elif name == "cropped_figure":
        image = image.crop((85, 35, 475, 435)).resize((512, 512), Image.Resampling.LANCZOS)
    elif name == "noisy_background":
        pixels = image.convert("RGB").load()
        for _ in range(1200):
            x, y = rng.randrange(image.width), rng.randrange(image.height)
            shade = rng.choice((232, 240, 248, 255))
            pixels[x, y] = (shade, shade, shade)
    else:
        raise ValueError(f"Unknown deterministic transform: {name}")
    return ImageOps.pad(image, (512, 512), color="white").convert("RGB")


def _schematic(kind: str, label: str) -> Image.Image:
    image = Image.new("RGB", (512, 512), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=21)
    small = ImageFont.load_default(size=16)
    if kind == "coordination_complex":
        draw.text((224, 220), "Cr", fill="black", font=font)
        for x, y in ((130, 110), (370, 110), (130, 340), (370, 340), (250, 70), (250, 400)):
            draw.line((250, 250, x, y), fill="black", width=4)
            draw.ellipse((x - 30, y - 20, x + 30, y + 20), outline="black", width=3)
            draw.text((x - 17, y - 12), "O", fill="black", font=small)
    elif kind == "polymer_repeat":
        draw.text((40, 180), "[", fill="black", font=font)
        draw.text((92, 180), "CH2—CH2—O", fill="black", font=font)
        draw.text((435, 180), "]n", fill="black", font=font)
        draw.line((75, 165, 75, 240), fill="black", width=3)
        draw.line((420, 165, 420, 240), fill="black", width=3)
    elif kind == "reaction_scheme":
        draw.text((55, 150), "CCO", fill="black", font=font)
        draw.line((170, 190, 335, 190), fill="black", width=4)
        draw.polygon([(335, 190), (312, 177), (312, 203)], fill="black")
        draw.text((370, 150), "CC=O", fill="black", font=font)
        draw.text((198, 130), "heat", fill="black", font=small)
    elif kind == "crystal_diagram":
        for x, y in (
            (120, 120),
            (250, 120),
            (380, 120),
            (120, 250),
            (250, 250),
            (380, 250),
            (120, 380),
            (250, 380),
            (380, 380),
        ):
            draw.ellipse((x - 12, y - 12, x + 12, y + 12), fill="black")
        for y in (120, 250, 380):
            for x in (120, 250):
                draw.line((x, y, x + 130, y), fill="#555555", width=2)
        for x in (120, 250, 380):
            draw.line((x, 120, x, 250), fill="#555555", width=2)
            draw.line((x, 250, x, 380), fill="#555555", width=2)
        draw.text((35, 440), "unit cell · species sites", fill="black", font=small)
    elif kind == "plot_molecule":
        draw.line((55, 420, 455, 420), fill="black", width=2)
        draw.line((55, 420, 55, 75), fill="black", width=2)
        points = [(70, 390), (140, 350), (200, 270), (260, 300), (335, 165), (425, 110)]
        draw.line(points, fill="#333333", width=3)
        for x, y in points:
            draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill="black")
        molecule = _mol_image("c1ccncc1", (165, 165))
        image.paste(molecule, (290, 290))
    elif kind == "multiple_molecules":
        image.paste(_mol_image("CCO", (210, 210)), (10, 100))
        image.paste(_mol_image("c1ccncc1", (210, 210)), (292, 100))
        draw.text((235, 205), "+", fill="black", font=font)
    elif kind == "partially_occluded":
        image = _mol_image("CC(=O)Oc1ccccc1C(=O)O")
        draw.rectangle((190, 0, 315, 330), fill="white")
    elif kind == "hand_drawn":
        coords = [(120, 250), (185, 190), (250, 250), (315, 190), (380, 250)]
        draw.line(coords, fill="#202020", width=6, joint="curve")
        for x, y in coords:
            draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill="#202020")
        draw.text((130, 280), "OH", fill="black", font=font)
        draw.text((308, 280), "NH2", fill="black", font=font)
    elif kind == "abbreviation":
        draw.text((105, 220), "Et", fill="black", font=font)
        draw.line((145, 235, 220, 235), fill="black", width=3)
        draw.text((225, 216), "O", fill="black", font=font)
        draw.line((245, 235, 320, 235), fill="black", width=3)
        draw.text((325, 216), "R", fill="black", font=font)
    else:
        raise ValueError(kind)
    draw.text((12, 12), label, fill="#666666", font=small)
    return image


def _example(
    case_id: str, category: str, image: Image.Image, smiles: str | None, recipe: str
) -> dict[str, Any]:
    path = f"images/{case_id}.png"
    data = _png(image)
    return {
        "case_id": case_id,
        "category": category,
        "image_path": path,
        "image_sha256": hashlib.sha256(data).hexdigest(),
        "ground_truth_smiles": smiles,
        "scorable": smiles is not None,
        "expected_status": "MANUAL_REVIEW_REQUIRED" if smiles is not None else "UNSUPPORTED",
        "preprocessing_recipe": recipe,
        "preprocessing_version": "chemdft-synthetic-image-v1",
        "license": LICENSE,
        "provenance": PROVENANCE,
        "source": "self-generated synthetic depiction; no paper or third-party figure included",
        "generator": "RDKit 2025.09.1 + Pillow 12.3.0; fixed seeds; see dataset.py",
        "_bytes": data,
    }


def build_dataset(root: Path = ROOT) -> dict[str, Any]:
    examples: list[dict[str, Any]] = []
    for category, case_id, smiles in MOLECULES:
        image = _mol_image(smiles)
        examples.append(
            _example(case_id, category, image, smiles, "RDKit clean depiction, 512x512")
        )

    augments = [
        ("rotated_scaled", "aromatic_benzene", "c1ccccc1"),
        ("rotated_scaled", "hetero_morpholine", "O1CCNCC1"),
        ("low_resolution", "simple_ethanol", "CCO"),
        ("low_resolution", "aromatic_anisole", "COc1ccccc1"),
        ("blur_compression", "hetero_imidazole", "c1ncc[nH]1"),
        ("blur_compression", "stereo_lactic_acid_r", "C[C@H](O)C(=O)O"),
        ("grayscale_scan", "aromatic_pyridine", "c1ccncc1"),
        ("grayscale_scan", "dense_caffeine", "Cn1c(=O)c2c(ncn2C)n(C)c1=O"),
        ("cropped_figure", "dense_aspirin", "CC(=O)Oc1ccccc1C(=O)O"),
        ("cropped_figure", "stereo_alanine", "N[C@@H](C)C(=O)O"),
        ("noisy_background", "hetero_thiophene", "c1ccsc1"),
        ("noisy_background", "charged_acetate", "CC(=O)[O-]"),
    ]
    for index, (category, _source_id, smiles) in enumerate(augments):
        image = _transform(_mol_image(smiles), category, seed=20260924 + index)
        examples.append(
            _example(
                f"{category}_{index + 1:02d}",
                category,
                image,
                smiles,
                f"{category}; deterministic seed={20260924 + index}",
            )
        )

    ood_counts = {
        "coordination_complex": 4,
        "polymer_repeat": 3,
        "reaction_scheme": 3,
        "crystal_diagram": 3,
        "plot_molecule": 2,
        "multiple_molecules": 3,
        "partially_occluded": 2,
        "hand_drawn": 2,
        "abbreviation": 2,
    }
    for category, count in ood_counts.items():
        for index in range(count):
            case_id = f"{category}_{index + 1:02d}"
            image = _schematic(category, case_id)
            examples.append(
                _example(
                    case_id,
                    category,
                    image,
                    None,
                    "synthetic out-of-domain schematic; manual review expected",
                )
            )

    root.mkdir(parents=True, exist_ok=True)
    (root / "images").mkdir(parents=True, exist_ok=True)
    for example in examples:
        (root / example["image_path"]).write_bytes(example.pop("_bytes"))
    manifest = {
        "dataset_id": "chemdft-structure-image-evaluation-v1",
        "license": LICENSE,
        "provenance": PROVENANCE,
        "count": len(examples),
        "generator_version": "chemdft-synthetic-image-v1",
        "rdkit_version": Chem.rdBase.rdkitVersion,
        "examples": examples,
    }
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build the redistributable synthetic molecular-image evaluation set"
    )
    parser.add_argument("--output", type=Path, default=ROOT)
    args = parser.parse_args()
    manifest = build_dataset(args.output)
    print(f"Generated {manifest['count']} CC0-1.0 examples at {args.output}")


if __name__ == "__main__":
    main()
