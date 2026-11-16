#!/usr/bin/env python3
"""Flatten the hosted pilot image without geomeTRIC (release 0.0.53). WRITTEN, NOT RUN.

Runs ON the pilot instance, as root, ONLY inside an owner-opened guarded session (the same preconditions
host-workflow.sh enforces: Linux x86_64, root, chemdft-session-stop.timer active, metadata endpoint blocked).
It uses the local Docker daemon only: it never starts instances, never calls AWS/SSM/IAM and never touches the network.

  python3 aws_flatten_geometric_image.py              build chemdft-pilot:runtime-qe-0053 from runtime-qe-0046, then verify
  python3 aws_flatten_geometric_image.py --verify-only   verify an existing new tag (idempotent re-run; never rebuilds)
  python3 aws_flatten_geometric_image.py --inspect-file F   print the `docker import --change` arguments parsed from a
                                                            saved `docker inspect` JSON (no Docker, no guard; used by the offline test)

The old tag is the rollback and is never overwritten or removed. The new tag only appears after verification passed.
"""
import argparse
import json
import os
import platform
import re
import subprocess
import sys

OLD_TAG = "chemdft-pilot:runtime-qe-0046"
OLD_DIGEST = "sha256:83d8d13188a48af9819cc6a23adc94ac119cda67961c58489e1205d64883c77a"
NEW_TAG = "chemdft-pilot:runtime-qe-0053"
STAGING_TAG = "chemdft-pilot:runtime-qe-0053-staging"
REMOVED_LABEL = ("org.chemdft.geometric-removed", "2026-11-14")
REMOVE = ("geometric", "networkx", "six")
SHUTDOWN_TIMER = "chemdft-session-stop.timer"
TAG_RE = re.compile(r"^chemdft-pilot:runtime-qe-\d{4}(-staging)?$")
QE_LOCK = "/opt/locks/qe-binaries.sha256"
COUNT_DIRS = ("/opt/qe", "/opt/sssp")


class Stop(Exception):
    pass


def run(cmd, check=True, input_bytes=None):
    p = subprocess.run(cmd, input=input_bytes, capture_output=True)
    if check and p.returncode != 0:
        raise Stop(f"command failed ({p.returncode}): {' '.join(cmd)}\n{p.stderr.decode(errors='replace')[-800:]}")
    return p


def out(cmd):
    return run(cmd).stdout.decode().strip()


# ---------------------------------------------------------------- pure logic (offline-tested)
def parse_args(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--old-tag", default=OLD_TAG)
    ap.add_argument("--new-tag", default=NEW_TAG)
    ap.add_argument("--verify-only", action="store_true")
    ap.add_argument("--inspect-file", help="print import --change args from a saved docker inspect JSON and exit")
    a = ap.parse_args(argv)
    for t in (a.old_tag, a.new_tag):
        if not TAG_RE.match(t):
            raise Stop(f"refusing tag {t!r}: only chemdft-pilot:runtime-qe-NNNN tags are allowed")
    if a.old_tag == a.new_tag:
        raise Stop("the new tag must differ from the old tag (the old tag is the rollback and is never overwritten)")
    return a


def inspect_to_changes(inspect_json):
    """Return the `docker import --change` instruction list that restores the runtime config of the old image."""
    data = json.loads(inspect_json) if isinstance(inspect_json, str) else inspect_json
    if not isinstance(data, list) or len(data) != 1:
        raise Stop("docker inspect output must be a one-element list")
    cfg = data[0].get("Config") or {}
    if cfg.get("Healthcheck"):
        raise Stop("old image defines a HEALTHCHECK, which docker import cannot restore; stop and ask the architect")
    ch = []
    if not cfg.get("User"):
        raise Stop("old image has no USER; expected 10001:10001")
    ch.append(f"USER {cfg['User']}")
    if cfg.get("WorkingDir"):
        ch.append(f"WORKDIR {cfg['WorkingDir']}")
    for e in cfg.get("Env") or []:
        k, _, v = e.partition("=")
        ch.append(f"ENV {k}={json.dumps(v)}")
    if cfg.get("Entrypoint"):
        ch.append(f"ENTRYPOINT {json.dumps(cfg['Entrypoint'])}")
    if cfg.get("Cmd"):
        ch.append(f"CMD {json.dumps(cfg['Cmd'])}")
    for port in sorted(cfg.get("ExposedPorts") or {}):
        ch.append(f"EXPOSE {port}")
    for vol in sorted(cfg.get("Volumes") or {}):
        ch.append(f"VOLUME {vol}")
    labels = dict(cfg.get("Labels") or {})
    labels[REMOVED_LABEL[0]] = REMOVED_LABEL[1]
    for k in sorted(labels):
        ch.append(f"LABEL {json.dumps(k)}={json.dumps(labels[k])}")
    return ch


def import_command_args(changes):
    args = []
    for c in changes:
        args += ["--change", c]
    return args


def parse_required_by(pip_show_text):
    """{package: [required-by...]} from `pip show a b c` output."""
    res, name = {}, None
    for line in pip_show_text.splitlines():
        if line.startswith("Name:"):
            name = line.split(":", 1)[1].strip().lower()
            res[name] = []
        elif line.startswith("Required-by:") and name:
            res[name] = [x.strip().lower() for x in line.split(":", 1)[1].split(",") if x.strip()]
    return res


def dependency_blockers(required_by):
    """Anything outside the removal set that depends on a removed package. Empty list means safe."""
    bad = []
    for pkg, users in required_by.items():
        for u in users:
            if u not in REMOVE:
                bad.append(f"{pkg} is required by {u}")
    return bad


def pw_sha_from_lock(lock_text):
    for line in lock_text.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[-1].lstrip("*").endswith("/pw.x"):
            return parts[0].lower(), parts[-1].lstrip("*")
    raise Stop(f"no pw.x entry in {QE_LOCK}")


def config_mismatches(old_inspect, new_inspect):
    o, n = old_inspect[0]["Config"], new_inspect[0]["Config"]
    bad = []
    for k in ("User", "WorkingDir", "Entrypoint", "Cmd"):
        if (o.get(k) or None) != (n.get(k) or None):
            bad.append(f"{k}: {o.get(k)!r} != {n.get(k)!r}")
    if sorted(o.get("Env") or []) != sorted(n.get("Env") or []):
        bad.append("Env differs")
    want = dict(o.get("Labels") or {})
    want[REMOVED_LABEL[0]] = REMOVED_LABEL[1]
    if (n.get("Labels") or {}) != want:
        bad.append("Labels differ")
    return bad


# ---------------------------------------------------------------- guard (same preconditions as host-workflow.sh)
def require_guard():
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        raise Stop("Linux x86_64 only (run on the pilot instance, never on the Mac)")
    if os.geteuid() != 0:
        raise Stop("root required (run through the approved logged SSM session)")
    if run(["systemctl", "is-active", SHUTDOWN_TIMER], check=False).stdout.decode().strip() != "active":
        raise Stop("SHUTDOWN_TIMER_NOT_ACTIVE: not inside a guard session")
    if run(["iptables", "-C", "DOCKER-USER", "-d", "169.254.169.254/32", "-j", "DROP"], check=False).returncode != 0:
        raise Stop("METADATA_BLOCK_MISSING")


# ---------------------------------------------------------------- docker steps
def image_inspect(tag):
    return json.loads(out(["docker", "image", "inspect", tag]))


def image_exists(tag):
    return run(["docker", "image", "inspect", tag], check=False).returncode == 0


def sh_in(tag, script, user="0"):
    return run(["docker", "run", "--rm", "--network", "none", "--user", user, "--entrypoint", "sh", tag, "-c", script], check=False)


def count_files(tag):
    res = {}
    for d in COUNT_DIRS:
        p = sh_in(tag, f"find {d} -type f | wc -l")
        if p.returncode != 0:
            raise Stop(f"cannot list {d} in {tag}")
        res[d] = int(p.stdout.decode().strip())
    return res


def build(old_tag, new_tag, old_inspect):
    img = old_inspect[0]
    ids = {img.get("Id", "")} | {d.split("@")[-1] for d in img.get("RepoDigests") or []}
    if OLD_DIGEST not in ids:
        raise Stop(f"{old_tag} is not the expected image (want {OLD_DIGEST}; have {sorted(ids)}); stop")
    changes = inspect_to_changes(old_inspect)
    cid = out(["docker", "create", "--user", "0", "--network", "none", "--entrypoint", "sleep", old_tag, "infinity"])
    try:
        run(["docker", "start", cid])
        py = lambda *a: run(["docker", "exec", "--user", "0", cid, "python", "-m", "pip", *a], check=False)
        show = py("show", *REMOVE)
        required = parse_required_by(show.stdout.decode())
        print("pip show required-by:", json.dumps(required))
        print(show.stdout.decode())
        blockers = dependency_blockers(required)
        if blockers:
            raise Stop("STOP: other packages depend on the removal set: " + "; ".join(blockers))
        if "geometric" not in required:
            raise Stop("geometric is not installed in the old image; nothing to remove")
        p = py("uninstall", "-y", *REMOVE)
        if p.returncode != 0:
            raise Stop("pip uninstall failed:\n" + p.stderr.decode(errors="replace")[-800:])
        py("cache", "purge")
        run(["docker", "exec", "--user", "0", cid, "sh", "-c",
             "rm -rf /root/.cache/pip /home/*/.cache/pip /tmp/pip-* 2>/dev/null; true"])
        if run(["docker", "image", "inspect", STAGING_TAG], check=False).returncode == 0:
            run(["docker", "rmi", STAGING_TAG])  # our own staging tag only
        exp = subprocess.Popen(["docker", "export", cid], stdout=subprocess.PIPE)
        imp = subprocess.run(["docker", "import", *import_command_args(changes), "-", STAGING_TAG], stdin=exp.stdout, capture_output=True)
        exp.stdout.close()
        if exp.wait() != 0 or imp.returncode != 0:
            raise Stop("export/import failed: " + imp.stderr.decode(errors="replace")[-800:])
    finally:
        run(["docker", "rm", "-f", cid], check=False)


def verify(tag, old_tag):
    """Return a list of failures; prints every check."""
    fails = []

    def check(ok, msg):
        print(("PASS  " if ok else "FAIL  ") + msg)
        if not ok:
            fails.append(msg)

    old_i, new_i = image_inspect(old_tag), image_inspect(tag)
    cm = config_mismatches(old_i, new_i)
    check(not cm, "runtime config (USER/WORKDIR/ENV/ENTRYPOINT/CMD/labels) matches old image" + (": " + "; ".join(cm) if cm else ""))
    check(new_i[0]["Config"]["User"] == "10001:10001", f"USER is {new_i[0]['Config']['User']}")
    py = lambda code: run(["docker", "run", "--rm", "--network", "none", "--entrypoint", "python", tag, "-c", code], check=False)
    check(py("import geometric").returncode != 0, "python -c 'import geometric' fails (as required)")
    check(py("import pyscf, numpy").returncode == 0, "python -c 'import pyscf, numpy' works")
    lock = sh_in(tag, f"cat {QE_LOCK}")
    if lock.returncode != 0:
        check(False, f"{QE_LOCK} readable")
    else:
        want, path = pw_sha_from_lock(lock.stdout.decode())
        got = sh_in(tag, f"sha256sum {path}").stdout.decode().split()[:1]
        check(got == [want], f"pw.x sha256 matches {QE_LOCK} ({want})")
    oc, nc = count_files(old_tag), count_files(tag)
    for d in COUNT_DIRS:
        check(oc[d] == nc[d], f"{d} file count old={oc[d]} new={nc[d]}")
    hist = lambda t: len(out(["docker", "history", "-q", t]).splitlines())
    print(f"INFO  docker history layers old={hist(old_tag)} new={hist(tag)}")
    print(f"INFO  image size bytes old={old_i[0]['Size']} new={new_i[0]['Size']}")
    return fails


def main(argv):
    a = parse_args(argv)
    if a.inspect_file:
        with open(a.inspect_file) as f:
            print("\n".join(inspect_to_changes(f.read())))
        return 0
    require_guard()
    if not image_exists(a.old_tag):
        raise Stop(f"{a.old_tag} not found; refusing (it is the rollback and the input)")
    if a.verify_only or image_exists(a.new_tag):
        if not image_exists(a.new_tag):
            raise Stop(f"{a.new_tag} does not exist; nothing to verify")
        print(f"{a.new_tag} exists; verifying only (nothing is rebuilt or overwritten)")
        fails = verify(a.new_tag, a.old_tag)
    else:
        build(a.old_tag, a.new_tag, image_inspect(a.old_tag))
        fails = verify(STAGING_TAG, a.old_tag)
        if not fails:
            run(["docker", "tag", STAGING_TAG, a.new_tag])
            run(["docker", "rmi", STAGING_TAG])
            print(f"tagged {a.new_tag}; {a.old_tag} untouched (rollback)")
    if fails:
        print(f"RESULT FAIL ({len(fails)} mismatch(es)); {a.new_tag} was not created; staging image kept for inspection", file=sys.stderr)
        return 1
    print("RESULT PASS")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Stop as e:
        print(f"STOP: {e}", file=sys.stderr)
        sys.exit(2)
