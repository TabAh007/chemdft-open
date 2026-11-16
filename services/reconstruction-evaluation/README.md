# ChemDFT reconstruction evaluation harness

This is a standalone, experimental evaluation package for molecular-image reconstruction. It is deliberately not imported by the ChemDFT API or web application. Outputs are non-authoritative and must not be persisted as accepted chemistry.

## Reproduce the local evaluation

Requires Python 3.12, `uv`, and a one-time network-enabled model preparation. The prepared model cache must live outside this repository; do not commit model weights.

```sh
uv sync --project services/reconstruction-evaluation --extra decimer --group dev
uv run --project services/reconstruction-evaluation chemdft-reconstruction-prepare-models \
  --cache /absolute/path/outside/repository/DECIMER
uv run --project services/reconstruction-evaluation chemdft-reconstruction-evaluate \
  --dataset services/reconstruction-evaluation/data/v1 \
  --output /absolute/path/outside/repository/results \
  --model-cache /absolute/path/outside/repository/DECIMER
```

Model preparation downloads only the official DECIMER Zenodo records and verifies their published MD5 values before extraction. Evaluation requires both prepared checkpoints and blocks Python socket/DNS networking for the complete run; it fails closed if the checkpoint files or DECIMER cache markers are missing. No API key, Hugging Face account, or hosted inference service is used.

Run package tests from the package directory:

```sh
cd services/reconstruction-evaluation
uv run --project . --group dev python -m pytest -q
```

`data/v1` is a deterministic, 69-image CC0 synthetic dataset. Regenerate it with `chemdft-reconstruction-build-dataset --output <directory>`. The checked-in `results/decimer-2.8.0-2026-09-24/` directory contains the observed local run: per-case JSON/CSV, category summaries, and a human-review sheet. Category labels are benchmark metadata, not predictions from a production classifier. Metrics are exploratory because the sample sizes are small.

See the evaluation report for methodology, findings, limitations, and product recommendations.
