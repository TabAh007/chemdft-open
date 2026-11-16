"""ChemDFT spectra worker: experimental spectrum parsing, deterministic transforms and comparison.

Runs only inside the isolated worker environment (numpy, scipy, pybaselines). The API process never imports it.
"""
# ruff: noqa: E501  (long evidence strings, scientific symbols and human-readable diagnostics)

WORKER_VERSION = "chemdft.spectra-worker/1.0.0"
PARSER_NAME = "chemdft-spectra-text"
PARSER_VERSION = "1.0.0"
SCHEMA_PREVIEW = "chemdft.experimental-spectrum.preview"
SCHEMA_VERSION = "1.0.0"
