"""Budgeted live acceptance of DRAW mode through the application's own gateway and budget.

    uv run --project services/api python tools/draw_live_acceptance.py --set dev|final --out FILE.jsonl

In-process FastAPI app + throw-away SQLite; the model is whatever CHEMDFT_AI_* selects (.env), reached through
the application's HttpOpenAIModelGateway. A hard cap on model calls (default 40 across both sets, tracked in a
counter file) stops the run before an over-budget call is made. Every request is logged: prompt, model output,
server validation, final SMILES/formula, latency, tokens. Credentials are never printed or logged.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CALL_CAP = 15  # approved for the second draw-quality task (earlier 40 + 25 are spent); counter in output/draw-live-calls-quality-b.txt

DEV_SET = [
    ("fresh", "draw ethanol"),
    ("keep", "add an OH group on atom 1"),
    ("keep", "undo that"),
    ("fresh", "draw phenol"),
    ("keep", "add a nitro group on the ring carbon furthest from the OH"),
    ("fresh", "6 H + 2 N + 1 C"),
    ("choose", "first option"),
    ("fresh", "draw a carbon with five single bonds to carbon atoms"),
    ("fresh", "what is the boiling point of ethanol"),
    ("fresh", "draw caffeine"),
]
DEV_SET_2 = [
    ("fresh", "6 H + 2 N + 1 C"),
    ("fresh", "add 2 carbons, 1 nitrogen and 1 oxygen"),
    ("keep", "connect them"),
]
FINAL_SET_2 = [
    ("fresh", "draw acetone"),
    ("fresh", "C3H6O"),
    ("fresh", "draw urea"),
    ("fresh", "draw aspirin"),
]
# Draw-quality task (2026-11): "seed" puts a molecule on the canvas without a model call.
QUALITY_DEV = [
    ("fresh", "draw 6 water molecules"),
    ("seed", "O"),
    ("keep", "make it two"),
    ("fresh", "draw 1-B-3-MIHS"),
    ("seed", "CCO"),
    ("keep", "clear the drawing"),
    ("fresh", "draw acetone"),
]
QUALITY_FINAL = [
    ("fresh", "draw 5 methanol molecules"),
    ("fresh", "draw two molecules of acetic acid"),
    ("fresh", "draw 3 pyridine molecules"),
    ("fresh", "draw 4 CO2"),
    ("seed", "Cc1ccccc1"),
    ("keep", "again"),
    ("seed", "CCC"),
    ("keep", "make it three"),
    ("seed", "N"),
    ("keep", "double it"),
    ("fresh", "draw florbazine"),
    ("fresh", "draw 7-X-9-QWERT"),
    ("seed", "CCO"),
    ("keep", "start over and draw methane"),
    ("fresh", "draw ethanol"),
]
# Second held-out set: fresh prompts run AFTER fixes made from the first held-out run (not the same prompts).
QUALITY_FINAL2 = [
    ("fresh", "draw 3 cyclohexane molecules"),
    ("fresh", "draw 6 molecules of glycine"),
    ("fresh", "draw 2 toluene"),
    ("seed", "CCO"),
    ("keep", "clear it and draw propane"),
    ("seed", "CC(C)=O"),
    ("keep", "twice"),
]
# Third set: fresh prompts after the single-molecule fragment check and the table-name note.
QUALITY_FINAL3 = [
    ("seed", "CCO"),
    ("keep", "clear it and draw pentane"),
    ("fresh", "draw 3 hexane molecules"),
    ("fresh", "draw 4 cyclopentane molecules"),
]
# Second quality task (held-out; prompts written before the run, no tuning on them).
QUALITY_B = [
    ("seed", "O"),
    ("keep", "make it two"),
    ("keep", "again"),
    ("choose", "second option"),
    ("seed", "O"),
    ("keep", "Replace the drawing with a version of the current molecule that has 2 carbon atoms in its carbon chain"),
    ("seed", "CCO"),
    ("keep", "make it three"),
    ("choose", "second option"),
    ("fresh", "draw 4 ethanol molecules"),
    ("fresh", "draw 3 ammonia molecules"),
    ("fresh", "draw 2 benzoic acid molecules"),
    ("fresh", "draw the stuff from the other day"),
    ("seed", "Cc1ccccc1"),
    ("keep", "bigger"),
    ("choose", "second option"),
]
# Re-check after the fixes made from the first QUALITY_B run (same two defects, fresh drawings).
QUALITY_B2 = [
    ("seed", "O"),
    ("keep", "make it two"),
    ("seed", "O"),
    ("keep", "Replace the drawing with a two-carbon alkane"),
]
FINAL_SET = [
    ("fresh", "draw acetone"),
    ("fresh", "draw cyclohexane"),
    ("fresh", "draw toluene"),
    ("fresh", "C2H6O"),
    ("fresh", "draw an ammonium ion"),
    ("fresh", "draw glycine"),
    ("fresh", "add 3 hydrogens and 1 nitrogen"),
    ("fresh", "draw benzoic acid"),
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--set", choices=["dev", "final", "dev2", "final2", "qdev", "qfinal", "qfinal2", "qfinal3", "qb", "qb2"], required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--only", help="comma-separated 0-based prompt indexes of the set")
    parser.add_argument("--counter", default=str(ROOT / "output/draw-live-calls-quality-b.txt"))
    args = parser.parse_args()

    sys.path.insert(0, str(ROOT / "services/api/src"))
    from chemdft_api import ai as _ai  # noqa: F401
    from chemdft_api.ai import gateway as gw
    from chemdft_api.auth import ensure_dev_identity
    from chemdft_api.config import Settings, get_settings
    from chemdft_api.database import Base, get_session
    from chemdft_api.main import app
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import sessionmaker

    counter = Path(args.counter)
    counter.parent.mkdir(parents=True, exist_ok=True)
    used = int(counter.read_text()) if counter.exists() else 0

    tmp = Path(tempfile.mkdtemp(prefix="draw-live-"))
    settings = Settings(
        database_url=f"sqlite:///{tmp / 'live.db'}",
        object_root=tmp / "objects",
        auto_create_schema=True,
        dev_identity_enabled=True,
        dev_identity_header_override_enabled=True,
        run_ai_integration=True,
        billing_managed_ai_enabled=True,
    )
    engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})
    with engine.connect() as c:
        c.execute(text("PRAGMA foreign_keys=ON"))
    sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(engine)
    with sessions() as s:
        ensure_dev_identity(s, settings)

    def override_session():
        with sessions() as s:
            yield s

    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_session] = override_session

    log: list[dict] = []
    original = gw.HttpOpenAIModelGateway.generate

    def counted(self, request):
        nonlocal used
        if used >= CALL_CAP:
            raise RuntimeError(f"model call cap {CALL_CAP} reached; refusing to call")
        used += 1
        counter.write_text(str(used))
        started = time.time()
        try:
            response = original(self, request)
        except Exception as err:
            log.append({"call": used, "error": type(err).__name__, "latency_s": round(time.time() - started, 2)})
            raise
        log.append({
            "call": used, "latency_s": round(time.time() - started, 2),
            "model": response.model_identifier, "finish": response.finish_reason,
            "tokens_in": response.usage.input_tokens if response.usage else None,
            "tokens_out": response.usage.output_tokens if response.usage else None,
            "output": response.content,
        })
        return response

    gw.HttpOpenAIModelGateway.generate = counted

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with TestClient(app) as client, out.open("w") as sink:
        project = client.post("/v1/projects", json={"name": "draw-live", "slug": "draw-live"}).json()["id"]
        conv = client.post(f"/v1/projects/{project}/ai/conversations", json={}).json()["conversation"]["id"]
        canvas, previous, last_clarify = None, None, None
        history: list[dict] = []
        chosen = {"dev": DEV_SET, "final": FINAL_SET, "dev2": DEV_SET_2, "final2": FINAL_SET_2, "qdev": QUALITY_DEV, "qfinal": QUALITY_FINAL, "qfinal2": QUALITY_FINAL2, "qfinal3": QUALITY_FINAL3, "qb": QUALITY_B, "qb2": QUALITY_B2}[args.set]
        keep_idx = {int(i) for i in args.only.split(",")} if args.only else set(range(len(chosen)))
        for idx, (mode, prompt) in enumerate(chosen):
            if idx not in keep_idx:
                continue
            if mode == "seed":
                from chemdft_api.ai.draw import DrawState, parse_plan, run_ops

                plan = parse_plan(json.dumps({"ops": [{"op": "load_smiles", "smiles": prompt, "label": "seed"}]}))
                seeded = run_ops(DrawState(), list(plan.ops), previous_molfile=None).steps[-1]
                canvas, previous, history = seeded.molfile, None, []
                continue
            if mode == "fresh":
                canvas, previous, history = None, None, []
            if mode == "choose" and last_clarify:
                prompt = last_clarify[1 if "second" in prompt else 0]["message"]
            before = len(log)
            started = time.time()
            body = {"content": prompt, "molfile": canvas, "previous_molfile": previous, "history": history[-6:]}
            r = client.post(f"/v1/projects/{project}/ai/conversations/{conv}/draw", json=body)
            record = {
                "prompt": prompt, "http": r.status_code, "wall_s": round(time.time() - started, 2),
                "model_calls": log[before:],
            }
            if r.status_code == 200:
                d = r.json()
                record.update(
                    status=d["status"], repaired=d["repaired"], reply=d["reply"],
                    ops=[s["op"] for s in d["steps"]], step_ok=[s["ok"] for s in d["steps"]],
                    step_errors=[s["error"] for s in d["steps"] if not s["ok"]],
                    final_smiles=(d["final"] or {}).get("smiles"), final_formula=(d["final"] or {}).get("formula"),
                    fragments=(d["final"] or {}).get("smiles", "").count(".") + 1 if d["final"] and d["final"].get("smiles") else 0,
                    info=d.get("info"),
                    input_tokens=d.get("input_tokens"), output_tokens=d.get("output_tokens"),
                    clarify=d["clarify"], warnings=d["warnings"], error=d["error"],
                )
                last_clarify = d["clarify"]["options"] if d["clarify"] else None
                if d["final"] and d["status"] in ("OK", "PARTIAL", "NEEDS_ATTENTION"):
                    previous, canvas = canvas, d["final"]["molfile"]
                history += [{"role": "user", "content": prompt}, {"role": "assistant", "content": d["reply"]}]
            else:
                record["detail"] = r.text[:400]
            sink.write(json.dumps(record, ensure_ascii=False) + "\n")
            sink.flush()
            print(prompt, "->", record.get("status", record["http"]), record.get("final_smiles"), f"({len(record['model_calls'])} calls)")
    print("model calls used so far:", used, "/", CALL_CAP)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
