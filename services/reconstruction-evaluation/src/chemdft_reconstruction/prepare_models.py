from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import urllib.request
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

from .decimer_adapter import MODEL_URLS, MODEL_VERSION

ARTIFACTS = {
    "DECIMER": {
        "record": "https://zenodo.org/records/8300489",
        "filename": "models.zip",
        "md5": "de78c966b0d63b290cd3f70bb81a91e7",
        "sha256": None,
        "license": "CC-BY-4.0",
        "model_dir": "DECIMER_model",
    },
    "DECIMER_HandDrawn": {
        "record": "https://zenodo.org/records/10781330",
        "filename": "DECIMER_HandDrawn_model.zip",
        "md5": "1fece9813549417440f7c45d0c51603a",
        "sha256": None,
        "license": "CC-BY-4.0",
        "model_dir": "DECIMER_HandDrawn_model",
    },
}


def _digest(path: Path, algorithm: str) -> str:
    digest = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prepare_models(cache: Path) -> None:
    root = cache / "DECIMER-V2"
    root.mkdir(parents=True, exist_ok=True)
    provenance: dict[str, object] = {
        "software": "DECIMER",
        "software_version": MODEL_VERSION,
        "prepared_at": datetime.now(UTC).isoformat(),
        "source": "official DECIMER Zenodo records",
        "assets": {},
    }
    for model_name, metadata in ARTIFACTS.items():
        model_root = root / str(metadata["model_dir"])
        if (model_root / "saved_model.pb").is_file():
            marker = model_root / ".model_url"
            if marker.is_file() and marker.read_text().strip() == MODEL_URLS[model_name]:
                provenance["assets"][model_name] = {  # type: ignore[index]
                    **metadata,
                    "sha256": _digest(model_root / "saved_model.pb", "sha256"),
                    "already_cached": True,
                }
                continue
        archive = root / str(metadata["filename"])
        url = MODEL_URLS[model_name]
        print(f"Downloading {model_name} from its official Zenodo record")
        request = urllib.request.Request(
            url, headers={"User-Agent": "ChemDFT-reconstruction-evaluation/0.1"}
        )
        with urllib.request.urlopen(request, timeout=120) as response, archive.open("wb") as target:
            shutil.copyfileobj(response, target)
        actual_md5 = _digest(archive, "md5")
        if actual_md5 != metadata["md5"]:
            archive.unlink(missing_ok=True)
            raise RuntimeError(f"Official archive MD5 mismatch for {model_name}: {actual_md5}")
        actual_sha256 = _digest(archive, "sha256")
        with zipfile.ZipFile(archive) as bundle:
            bad_file = bundle.testzip()
            if bad_file:
                raise RuntimeError(f"Corrupt model archive member: {bad_file}")
            for member in bundle.infolist():
                member_path = PurePosixPath(member.filename)
                if member_path.is_absolute() or ".." in member_path.parts:
                    raise RuntimeError(f"Unsafe path in official archive: {member.filename}")
            bundle.extractall(root)
        archive.unlink()
        if not (model_root / "saved_model.pb").is_file():
            raise RuntimeError(
                f"Expected saved model at {model_root}; inspect official archive layout "
                "before evaluation"
            )
        (model_root / ".model_url").write_text(url + "\n")
        provenance["assets"][model_name] = {  # type: ignore[index]
            **metadata,
            "sha256": actual_sha256,
            "already_cached": False,
        }
    (root / "model-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    print(f"Prepared both official models in {root}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Explicitly prepare official DECIMER models for offline use"
    )
    parser.add_argument(
        "--cache", type=Path, required=True, help="PYSTOW_HOME directory outside the repository"
    )
    args = parser.parse_args()
    prepare_models(args.cache.expanduser().resolve())


if __name__ == "__main__":
    main()
