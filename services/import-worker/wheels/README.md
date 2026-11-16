# Pinned cclib wheel

`cclib-1.8.1.post1278+b1364ecf-py3-none-any.whl` is a build of **cclib @ `b1364ecf5ac21042c5a37ed5446771217e0431ea`**
(upstream development branch, 2026-10-03; BSD-3-Clause, license file inside the wheel).

* Why not PyPI cclib 1.8.1 (2024-03-18)? It crashes on **every ORCA 6.x output** (spike: 12 of 12 positive ORCA 6 fixtures
  fail with `PARSE_FAILED`) and returns Q-Chem thermochemistry with different semantics. Gaussian and ORCA 5 behave identically in both.
* Why a wheel? Nothing may be installed from GitHub at runtime. The wheel is locked by SHA-256 in `../uv.lock`.
* Wheel bytes are not reproducible across builds (timestamps); the **content digest** is:
  `9762a1ebd08d313ef46f94d229ca9ee05adcfd7ea8de80984a23ad5b4a256361` (SHA-256 of sorted `(member, sha256)` pairs excluding `RECORD`).
  Wheel SHA-256: `ea74d47a5ffe35f563475e51ee5c471189e0eadf5ee51bb647e29efca544eab5`.
* Verify from the repo root (rebuilds from the pinned commit and compares): `python tools/build_cclib_wheel.py verify`.
* Only this isolated import-worker environment depends on it; the API and the scientific worker do not.
