"""Single backend source of truth for the ChemDFT release version shown in exports.

The newest entry of ``apps/web/src/content/releases.ts`` must equal ``RELEASE_VERSION``
(tests/test_release_version_agrees.py fails otherwise). Bump both in the same change.
"""

from __future__ import annotations

RELEASE_VERSION = "0.0.60"
EXPORTER_NAME = f"ChemDFT {RELEASE_VERSION}"
