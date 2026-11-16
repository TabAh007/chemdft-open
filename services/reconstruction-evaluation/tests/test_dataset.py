import hashlib
import json
from pathlib import Path


def test_dataset_examples_have_per_example_license_and_provenance():
    dataset_root = Path(__file__).parents[1] / "data" / "v1"
    manifest = json.loads((dataset_root / "manifest.json").read_text())

    assert 40 <= len(manifest["examples"]) <= 80
    for example in manifest["examples"]:
        assert example["license"]
        assert example["provenance"]
        assert (dataset_root / example["image_path"]).is_file()
        image_path = dataset_root / example["image_path"]
        assert len(example["image_sha256"]) == 64
        assert hashlib.sha256(image_path.read_bytes()).hexdigest() == example["image_sha256"]


def test_dataset_has_required_in_domain_and_out_of_domain_classes():
    dataset_root = Path(__file__).parents[1] / "data" / "v1"
    manifest = json.loads((dataset_root / "manifest.json").read_text())
    categories = {example["category"] for example in manifest["examples"]}

    assert {"simple_organic", "aromatic", "heterocycle", "stereochemistry"} <= categories
    assert {
        "coordination_complex",
        "polymer_repeat",
        "reaction_scheme",
        "crystal_diagram",
        "multiple_molecules",
        "partially_occluded",
    } <= categories
