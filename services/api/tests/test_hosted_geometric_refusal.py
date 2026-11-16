"""Release 0.0.53: the hosted compute image ships without geomeTRIC, so PySCF geometry optimisation is refused
with a typed, explanatory error (never a crash or a queued job that fails later)."""

import pytest
from chemdft_api.config import Settings
from chemdft_api.contracts.catalog import CalculationSubmitInput
from chemdft_api.scientific.engines.registry import (
    HOSTED_GEOMETRIC_REFUSAL,
    capability_views,
    hosted_geometric_unavailable,
    validate_capability,
)
from chemdft_api.errors import EngineUnavailable

from test_ai_proposal_feedback import arguments


def _opt(engine="pyscf", optimizer="geometric"):
    extra = {"optimization": {"optimizer": optimizer, "max_steps": 20}}
    if optimizer == "xtb-ancopt":
        extra["optimization"]["xtb_level"] = "normal"
    variant = arguments(task="GEOMETRY_OPTIMIZATION", engine=engine, **extra)
    return CalculationSubmitInput.model_validate(variant).specification


def test_hosted_backend_refuses_pyscf_optimisation_with_a_typed_message():
    hosted = Settings(_env_file=None, compute_local_enabled=False)
    assert hosted_geometric_unavailable(hosted)
    with pytest.raises(EngineUnavailable) as caught:
        validate_capability(_opt(), hosted)
    assert "not available in the hosted version" in str(caught.value.detail)
    assert "Self-hosting" in HOSTED_GEOMETRIC_REFUSAL


def test_hosted_backend_does_not_advertise_pyscf_optimisation():
    hosted = Settings(_env_file=None, compute_local_enabled=False)
    pyscf = next(v for v in capability_views(hosted) if v.engine == "pyscf")
    assert "GEOMETRY_OPTIMIZATION" not in pyscf.supported_tasks
    assert "geometric" not in pyscf.supported_optimizers


def test_a_self_hosted_aws_image_with_the_extra_can_re_enable_it():
    own = Settings(_env_file=None, compute_local_enabled=False, compute_aws_geometric_available=True)
    assert not hosted_geometric_unavailable(own)
    validate_capability(_opt(), own)


def test_energy_is_not_affected_by_the_refusal():
    hosted = Settings(_env_file=None, compute_local_enabled=False)
    validate_capability(CalculationSubmitInput.model_validate(arguments()).specification, hosted)
