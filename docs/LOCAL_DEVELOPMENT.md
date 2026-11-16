# ChemDFT Local Development

This setup enables a safe local-only development identity so the browser can exercise the real API actions. It is not production authentication and does not issue trusted worker authority to the browser.

## API

```bash
CHEMDFT_AUTO_CREATE_SCHEMA=true \
CHEMDFT_DEV_IDENTITY_ENABLED=true \
CHEMDFT_DATABASE_URL=sqlite:///./.chemdft/chemdft.db \
CHEMDFT_OBJECT_ROOT=./.chemdft/objects \
uv run --project services/api chemdft-api
```

The API listens on `http://127.0.0.1:8000`. Development identity is disabled unless `CHEMDFT_DEV_IDENTITY_ENABLED=true` is set.
Set `CHEMDFT_DATABASE_URL` explicitly for the API and every worker. If it is unset, the API silently falls back to `./.chemdft/chemdft.db` relative to its working directory. The browser end-to-end configuration uses the separate disposable `/tmp/chemdft-e2e-localhost.db`; it is not the persistent local QA database.

## Web

```bash
CHEMDFT_API_BASE_URL=http://127.0.0.1:8000 \
CHEMDFT_DEV_IDENTITY_ENABLED=true \
pnpm dev
```

Open `http://localhost:3000/en`. The web shell proxies API requests through `/api/chemdft`, strips browser-supplied identity headers, and attaches the configured local development actor server-side.

## Development Identity

Defaults match the Phase 1 development adapter:

```bash
CHEMDFT_DEV_USER_ID=00000000-0000-4000-8000-000000000001
CHEMDFT_DEV_ORGANIZATION_ID=00000000-0000-4000-8000-000000000010
```

Only set `CHEMDFT_DEV_IDENTITY_HEADER_OVERRIDE_ENABLED=true` for controlled API tests that intentionally exercise alternate users or organizations. Do not use it for browser development.

## Optional PySCF Worker

```bash
uv sync --project services/scientific-worker
CHEMDFT_SCIENTIFIC_WORKER_PYTHON=services/scientific-worker/.venv/bin/python
```

If the worker is not configured or cannot import pinned PySCF, the calculation panel reports the explicit unavailable state. It never fakes an engine result.
