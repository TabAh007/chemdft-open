"""Download the explicitly licensed Real Scientific Retrieval V1 source PDFs.

PDF binaries are intentionally not stored in the repository. This script reads
the checked-in manifest, downloads only its allowlisted sources, and verifies
each expected SHA-256 before retaining a file.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
MANIFEST_PATH = ROOT / "services" / "embedding-evaluation" / "real-paper-v1-manifest.json"


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def download(output_dir: Path) -> list[dict[str, str]]:
    manifest: dict[str, Any] = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    if manifest.get("status") != "UNREVIEWED":
        raise ValueError("This script only downloads the unfrozen Real Paper V1 corpus.")

    output_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for paper in manifest["papers"]:
        url = paper["pdf_source_url"]
        if not url.startswith("https://"):
            raise ValueError(f"Refusing non-HTTPS PDF source for {paper['benchmark_document_id']}.")
        destination = output_dir / paper["local_pdf_name"]
        expected = paper["pdf_sha256"]
        if destination.exists():
            actual = _sha256(destination.read_bytes())
            if actual != expected:
                raise ValueError(
                    f"Existing file hash mismatch; refusing to overwrite {destination.name}."
                )
            results.append(
                {"document_id": paper["benchmark_document_id"], "status": "already_verified"}
            )
            continue

        request = urllib.request.Request(
            url,
            headers={"User-Agent": "ChemDFT-real-paper-v1-reproducible-downloader/1.0"},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read()
        if not payload.startswith(b"%PDF-"):
            raise ValueError(
                f"Source did not return PDF bytes for {paper['benchmark_document_id']}."
            )
        actual = _sha256(payload)
        if actual != expected:
            raise ValueError(
                f"PDF hash mismatch for {paper['benchmark_document_id']}: expected {expected}, got {actual}."
            )
        destination.write_bytes(payload)
        results.append(
            {"document_id": paper["benchmark_document_id"], "status": "downloaded_verified"}
        )
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    for item in download(args.output_dir):
        print(f"{item['document_id']}: {item['status']}")


if __name__ == "__main__":
    main()
