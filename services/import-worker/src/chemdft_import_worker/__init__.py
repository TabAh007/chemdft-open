"""Isolated parser for External Computational Import V1 (Gaussian 09/16, ORCA 5.x/6.x).

This package runs ONLY inside the import-worker virtual environment, in a resource-limited subprocess. It never touches the
database or the network. Its single output is a JSON preview report that the API validates again before anything is stored.
"""
# ruff: noqa: E501  (long evidence strings and human-readable diagnostics)

IMPORTER_VERSION = "chemdft.external-import/1.0.0"
NORMALIZATION_VERSION = "chemdft.import.units/1.0.0"
REPORT_SCHEMA = "chemdft.external-import.preview"
REPORT_SCHEMA_VERSION = "1.0.0"
PARSER_INFO = {
    "name": "cclib",
    "version": "1.8.1.post1278+b1364ecf",
    "commit": "b1364ecf5ac21042c5a37ed5446771217e0431ea",
    "wheel_sha256": "ea74d47a5ffe35f563475e51ee5c471189e0eadf5ee51bb647e29efca544eab5",
}
