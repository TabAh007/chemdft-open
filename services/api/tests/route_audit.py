# ruff: noqa: E501  (request fixtures)
"""Route authorization audit harness (PF-2).

Calls every project-scoped route as an owner, editor, viewer and outsider against a throw-away
database in dev auth mode (where several people share one organization, so editor and viewer
memberships are reachable) and records, per route, what each role received and whether the central
capability mapping was consulted. Bodies are generated from the route's own request schema, so the
audit follows new routes automatically; where a body cannot be generated the route is reported as
`UNPROVEN` rather than silently passed.
"""

from __future__ import annotations

import inspect
import re
import uuid
from dataclasses import dataclass, field

from chemdft_api import project_access
from chemdft_api.main import app
from chemdft_api.models import Membership, ProjectMember, User
from fastapi.routing import APIRoute

PREFIX = "/v1/projects/{project_id}"
FAKE = "00000000-0000-4000-8000-0000000000ee"


def project_routes() -> list[tuple[str, str, APIRoute]]:
    rows = []
    for route in app.routes:
        if isinstance(route, APIRoute) and route.path.startswith(PREFIX):
            for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
                rows.append((method, route.path, route))
    return sorted(rows, key=lambda r: (r[1], r[0]))


def _resolve(schema: dict, defs: dict) -> dict:
    while "$ref" in schema:
        schema = defs[schema["$ref"].split("/")[-1]]
    return schema


def minimal(schema: dict, defs: dict, depth: int = 0):
    schema = _resolve(schema, defs)
    for key in ("anyOf", "oneOf"):
        if key in schema:
            options = [o for o in schema[key] if o.get("type") != "null"]
            return minimal(options[0], defs, depth + 1) if options else None
    if "allOf" in schema:
        return minimal(schema["allOf"][0], defs, depth + 1)
    if "enum" in schema:
        return schema["enum"][0]
    if "const" in schema:
        return schema["const"]
    kind = schema.get("type")
    if kind == "object":
        if depth > 4:
            return {}
        required = schema.get("required", [])
        props = schema.get("properties", {})
        return {name: minimal(props[name], defs, depth + 1) for name in required if name in props}
    if kind == "array":
        item = schema.get("items", {})
        count = schema.get("minItems", 0)
        return [minimal(item, defs, depth + 1) for _ in range(count)]
    if kind == "string":
        fmt = schema.get("format")
        if fmt == "uuid":
            return str(uuid.uuid4())
        if fmt == "date-time":
            return "2026-01-01T00:00:00Z"
        pattern = schema.get("pattern", "")
        if "[a-f0-9]{" in pattern:
            return "a" * int(pattern.split("{")[1].split("}")[0])
        if pattern:
            return "a-b" if "-" in pattern else "abc"
        length = max(1, schema.get("minLength", 1))
        return "x" * min(length, schema.get("maxLength", length))
    if kind == "integer":
        return schema.get("minimum", 1)
    if kind == "number":
        return schema.get("minimum", 1.0)
    if kind == "boolean":
        return False
    return None


def _digitization(**extra: object) -> dict:
    """A schema-valid digitization request; hashes are placeholders (the role check precedes them)."""
    return {
        "experiment_name": "audit",
        "source_document_sha256": "b" * 64,
        "source_render_sha256": "a" * 64,
        "source_render_version": "pdfjs-test",
        "source_render_scale": 1,
        "source_pixel_width": 1000,
        "source_pixel_height": 1200,
        "plot_region": {"x": 100, "y": 200, "width": 700, "height": 600},
        "x_calibration": {
            "pixel_a": {"x": 200, "y": 700},
            "pixel_b": {"x": 700, "y": 700},
            "value_a": 20,
            "value_b": 60,
            "label": "2theta",
            "unit": "degree",
        },
        "point_mode": "PEAK_PICKING",
        "points": [{"source_pixel": {"x": 300, "y": 500}}],
        **extra,
    }


_XYZ = b"2\nH2\nH 0 0 -0.37\nH 0 0 0.37\n"

# Routes whose request needs a value the generator cannot guess (a closed literal, a real file, a real
# artifact). A value may be a callable taking the audit project's prepared context.
OVERRIDES: dict[tuple[str, str], object] = {
    ("POST", "/calculations/{calculation_id}/fields/grid"): {
        "json": {"field_kind": "ELECTRON_DENSITY"}
    },
    ("POST", "/structures/imports"): {
        "files": {"upload": ("h2.xyz", _XYZ, "chemical/x-xyz")},
        "data": {"file_format": "XYZ", "idempotency_key": "audit-import-1", "structure_name": "H2"},
    },
    ("POST", "/imports"): {
        "files": {"upload": ("h2.xyz", _XYZ, "chemical/x-xyz")},
        "data": {"file_format": "XYZ"},
    },
    ("POST", "/experimental/imports"): {
        "files": {"upload": ("xrd.csv", b"x,y\n10,2\n11,3\n", "text/csv")},
        "data": {
            "modality": "XRD",
            "x_column": "x",
            "y_columns": "y",
            "x_label": "2theta",
            "x_unit": "degree",
            "y_label": "Intensity",
            "y_unit": "count",
            "experiment_name": "audit",
        },
    },
    ("POST", "/evidence/{candidate_id}/xrd-digitizations"): {
        "json": _digitization(y_unit_status="UNKNOWN")
    },
    ("POST", "/evidence/{candidate_id}/graph-digitizations"): {
        "json": _digitization(
            point_mode="CURVE_POINTS",
            y_calibration={
                "pixel_a": {"x": 200, "y": 700},
                "pixel_b": {"x": 200, "y": 300},
                "value_a": 0,
                "value_b": 100,
                "label": "Intensity",
                "unit": "count",
            },
        )
    },
    ("POST", "/structure-candidates/{candidate_id}/representations"): {
        "json": {"representation_type": "SMILES", "smiles": "O"}
    },
    ("POST", "/structure-candidates/{candidate_id}/representations/imports"): {
        "files": {"upload": ("h2.xyz", _XYZ, "chemical/x-xyz")},
        "data": {
            "file_format": "XYZ",
            "coordinate_unit": "angstrom",
            "coordinate_origin": "USER_IMPORTED_FILE",
        },
    },
    ("POST", "/structures/versions"): lambda context: {"json": context["structure_version_body"]},
}

PREPARED: dict[str, object] = {}


def prepare(client, headers: dict, project_id: str) -> None:
    """Create the one real record some requests need (a structure version to derive another from)."""
    imported = client.post(
        f"/v1/projects/{project_id}/structures/imports",
        headers=headers,
        files={"upload": ("h2.xyz", _XYZ, "chemical/x-xyz")},
        data={"file_format": "XYZ", "idempotency_key": "audit-structure-1", "structure_name": "H2"},
    ).json()
    version = imported["version"]
    coordinates = dict(version["coordinates"])
    coordinates.pop("structure_version_id")
    coordinates.pop("source")
    PREPARED["structure_version_body"] = {
        "structure_id": imported["structure"]["id"],
        "parent_version_id": version["id"],
        "representation_artifact": version["representation_artifacts"][0],
        "coordinates": coordinates,
        "overall_charge": 0,
        "multiplicity": 1,
        "idempotency_key": "audit-version-0001",
    }


def request_for(route: APIRoute, method: str, project_id: str):
    """(path, kwargs) for a best-effort request, or None if no body could be built."""
    path = route.path.replace("{project_id}", project_id).replace("{target}", "pause")
    for name in route.dependant.path_params:
        path = path.replace("{" + name.name + "}", FAKE)
    kwargs: dict = {}
    override = OVERRIDES.get((method, route.path.removeprefix(PREFIX)))
    if override:
        return path, (override(PREPARED) if callable(override) else override)
    for query in route.dependant.query_params:
        if query.field_info.is_required():
            kwargs.setdefault("params", {})[query.name] = "IR" if "technique" in query.name else "1"
    body = route.body_field
    if method == "GET" or body is None:
        return path, kwargs
    spec = app.openapi()
    request_body = spec["paths"].get(route.path, {}).get(method.lower(), {}).get("requestBody")
    if not request_body:
        return path, kwargs
    defs = spec.get("components", {}).get("schemas", {})
    content = request_body["content"]
    if "multipart/form-data" in content:
        schema = _resolve(content["multipart/form-data"]["schema"], defs)
        files, data = {}, {}
        for name, prop in schema.get("properties", {}).items():
            resolved = _resolve(prop, defs)
            if resolved.get("format") == "binary" or resolved.get("contentMediaType"):
                files[name] = ("x.txt", b"x", "text/plain")
            elif name in schema.get("required", []):
                value = minimal(prop, defs)
                data[name] = value if isinstance(value, str) else str(value)
        return path, {**kwargs, "files": files, "data": data}
    if "application/json" in content:
        return path, {**kwargs, "json": minimal(content["application/json"]["schema"], defs)}
    return path, kwargs


@dataclass
class AuditRow:
    method: str
    path: str
    status: dict[str, int] = field(default_factory=dict)
    consulted: dict[str, list[tuple[str, bool]]] = field(default_factory=dict)


def add_member(sessions, project_id: str, email: str, role: str, org_id: str) -> str:
    with sessions() as session:
        user = User(email=email, display_name=email.split("@")[0], kind="HUMAN")
        session.add(user)
        session.flush()
        session.add(Membership(organization_id=org_id, user_id=user.id, role="member"))
        if role:
            session.add(ProjectMember(project_id=project_id, user_id=user.id, role=role))
        session.commit()
        return user.id


def run_audit(client, sessions, settings, project_id: str) -> list[AuditRow]:
    users = {
        "owner": settings.dev_user_id,
        "editor": add_member(
            sessions, project_id, "editor@x.test", "editor", settings.dev_organization_id
        ),
        "viewer": add_member(
            sessions, project_id, "viewer@x.test", "viewer", settings.dev_organization_id
        ),
        "outsider": add_member(
            sessions, project_id, "outsider@x.test", "", settings.dev_organization_id
        ),
    }
    prepare(
        client,
        {
            "X-ChemDFT-User-ID": settings.dev_user_id,
            "X-ChemDFT-Organization-ID": settings.dev_organization_id,
        },
        project_id,
    )
    rows = []
    for method, path, route in project_routes():
        built = request_for(route, method, project_id)
        row = AuditRow(method, path.replace(PREFIX, "") or "/")
        for who, user_id in users.items():
            project_access.AUDIT_LOG = []
            headers = {
                "X-ChemDFT-User-ID": user_id,
                "X-ChemDFT-Organization-ID": settings.dev_organization_id,
            }
            if built is None:
                row.status[who] = -1
            else:
                try:
                    row.status[who] = client.request(
                        method, built[0], headers=headers, **built[1]
                    ).status_code
                except Exception:  # an unhandled server error surfaces as 500, never as a pass
                    row.status[who] = 500
            row.consulted[who] = list(project_access.AUDIT_LOG or [])
            project_access.AUDIT_LOG = None
        rows.append(row)
    return rows


WRITE_MARKERS = ("ProjectCapability.WRITE", "edit=True", "write=True")


def static_write_evidence(route: APIRoute) -> bool:
    """Whether the code this route calls consults the WRITE capability (a source-level proof).

    Used only for routes whose request body the audit cannot generate. It inspects the handler, the
    action functions it names, and the service-class methods it calls.
    """
    handler = route.endpoint
    source = inspect.getsource(handler)
    namespace = handler.__globals__
    names = set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", source))
    methods = set(re.findall(r"\.([A-Za-z_][A-Za-z0-9_]*)\(", source))
    for name in names:
        target = namespace.get(name)
        module = getattr(target, "__module__", "") or ""
        if not module.startswith("chemdft_api"):
            continue
        if inspect.isfunction(target):
            if any(marker in inspect.getsource(target) for marker in WRITE_MARKERS):
                return True
        elif inspect.isclass(target):
            for method in methods:
                member = getattr(target, method, None)
                if inspect.isfunction(member) and any(
                    marker in inspect.getsource(member) for marker in WRITE_MARKERS
                ):
                    return True
    return any(marker in source for marker in WRITE_MARKERS)
