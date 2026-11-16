# Self-hosting ChemDFT

Run ChemDFT on your own machine. No cloud account, no AWS, no paid service.

**What this is:** the web app (Next.js) and the API (FastAPI) on your computer, a database you own, and — optionally — a
local PySCF worker that runs real calculations. Everything below uses only what the repository already supports; nothing
new was added for this document.

> **Status of this guide: PARTLY TESTED.** See §8 for exactly which steps were executed while writing it and which were
> not. Do not assume a step works because it is written down.

## 1. What you need

| Requirement | Notes |
|---|---|
| macOS or Linux | Windows via WSL2 is untested. |
| ~10 GB free disk | Python environments, the npm install, and scratch space for jobs. PySCF wheels are large. |
| 8 GB RAM minimum, 16 GB comfortable | A DFT job runs in the worker process; memory is the practical limit, not CPU. |
| Python 3.12+ | The API requires `>=3.12` (`pyproject.toml`). |
| Node 20+ and pnpm | The web app is a pnpm workspace member. |
| `uv` | Used by the project for every Python environment. |
| Docker (optional) | Only if you use the Postgres compose file in §3. The default local database is SQLite. |

## 2. Get the code

```bash
git clone <repository-url> chemdft
cd chemdft
pnpm install
```

There is no public repository yet (see the licence page). Until there is, use the source archive you were given.

## 3. Database: SQLite by default, Postgres if you want it

The local default is SQLite and it is what the project's own development guide uses.

```bash
export CHEMDFT_DATABASE_URL="sqlite:///./.chemdft/chemdft.db"
```

If you prefer Postgres, a compose file with a single database service is included:

```bash
docker compose -f docker-compose.selfhost.yml up -d
export CHEMDFT_DATABASE_URL="postgresql+psycopg://chemdft:chemdft@127.0.0.1:5432/chemdft"
```

Then create the schema:

```bash
uv run --project services/api alembic upgrade head
```

The `+psycopg` part matters: the API installs psycopg 3 only (`services/api/pyproject.toml`), and a bare `postgresql://` makes SQLAlchemy look for psycopg2.

Note: the compose file exists for convenience only; **Postgres with this project has not been exercised in this
release** (the hosted deployment uses a managed Postgres, but that is not evidence for this file). SQLite is the tested path.

## 4. Start the API

```bash
export CHEMDFT_AUTO_CREATE_SCHEMA=true
export CHEMDFT_DEV_IDENTITY_ENABLED=true
export CHEMDFT_OBJECT_ROOT=./.chemdft/objects
uv run --project services/api chemdft-api
```

It listens on `http://127.0.0.1:8000`. Development identity is off unless you set `CHEMDFT_DEV_IDENTITY_ENABLED=true`,
and it is **not authentication**: it exists so the browser can exercise real actions locally.

## 5. Start the web app

```bash
CHEMDFT_API_BASE_URL=http://127.0.0.1:8000 \
CHEMDFT_DEV_IDENTITY_ENABLED=true \
pnpm dev
```

Open `http://localhost:3000/en`.

## 6. Make calculations real (PySCF worker)

This is what turns the calculation panel from "unavailable" into actual DFT.

```bash
uv sync --project services/scientific-worker
export CHEMDFT_SCIENTIFIC_WORKER_PYTHON=services/scientific-worker/.venv/bin/python
```

Restart the API afterwards. If the worker is missing or cannot import PySCF, the panel says so explicitly — the platform
never fakes an engine result. That behaviour is by design.

Nothing else is needed for PySCF. xTB, CREST, Psi4 and Quantum ESPRESSO are separate programs that ChemDFT starts as
subprocesses; each has to be installed and configured on your machine before the corresponding engine is available.

## 7. What does not work locally

- **Quantum ESPRESSO periodic calculations** need a QE installation (binaries and pseudopotentials) and the hosted
  image's configuration. No local recipe is provided in this release.
- **CREST, xTB, Psi4 and DFT-D4** are separate builds; the repository does not install them for you.
- **Sign-in with Google** requires OAuth credentials and a public callback URL; locally you use the development identity.
- **The hosted beta's quota and beta-cap behaviour** is server configuration; self-hosted use has no such caps.
- **Email sending** (verification, feedback notifications) needs a provider and is disabled by default.
- **GPU4PySCF, Psi4 and DFT-D4** are marked "Not available" in this release regardless of what you install.

## 8. What was actually run while writing this guide

| Step | Result |
|---|---|
| `pnpm install --frozen-lockfile --prefer-offline` in a fresh worktree | **PASS** (10.7 s, local store) |
| `uv sync --frozen` to create a Python 3.12 environment | **PARTIAL** — the environment was created; the API's dependencies were not installed by that command here, so the API was not started |
| API start, web start, PySCF worker, database migration, Postgres compose (`docker compose` never run: Docker is not installed here; checked only by YAML parse, port/credential/URL consistency against this document and `backend.env.example`) | **NOT RUN** |

So: the commands are the project's documented commands, copied from `LOCAL_DEVELOPMENT.md` and `pyproject.toml`, but the
end-to-end quickstart was **not** executed in this release. Treat §4-§6 as untested until someone runs them.

## 9. Licence implications of running engines locally

Your local installation is your own. If you install Quantum ESPRESSO (GPL-2.0-or-later) or a GPL build of CREST, those
programs stay under their own licences in your environment; ChemDFT only starts them as separate processes. If you
redistribute a modified GPL engine, the GPL's source-offer obligations apply to *you*. The Apache-2.0 licence on ChemDFT's
own code does not change the licence of anything you install alongside it.

geomeTRIC is **not** part of the default install (it forbids use in AI-training datasets). If you want geometry
optimisation, install it yourself:

```bash
uv pip install geometric
```

and read its licence first. ChemDFT will tell you when optimisation is requested but geomeTRIC is absent.

**Hosted version:** since release 0.0.53 the hosted compute image does not include geomeTRIC, so PySCF geometry optimisation is refused there with
"not available in the hosted version; see Self-hosting". xTB optimisation is unaffected. If you run your own AWS compute image that installs
geomeTRIC, set `CHEMDFT_COMPUTE_AWS_GEOMETRIC_AVAILABLE=true` on the API to offer PySCF optimisation again. With the local provider
(`CHEMDFT_COMPUTE_LOCAL_ENABLED=true`, the default) the API checks the worker environment for geomeTRIC itself.

## 10. Known gaps

Recorded in [14_ROADMAP.md](14_ROADMAP.md): there is no supported one-command local stack, no local Quantum ESPRESSO recipe,
and the Postgres path is untested. These are gaps, not features.
