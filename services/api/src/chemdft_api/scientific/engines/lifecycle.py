# SPDX-FileCopyrightText: 2026 Tabriz Ahmadli
# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from ...contracts.scientific import CalculationLifecycle
from ...errors import InvalidLifecycleTransition

ALLOWED_TRANSITIONS = {
    CalculationLifecycle.DRAFT: {CalculationLifecycle.VALIDATED},
    CalculationLifecycle.VALIDATED: {CalculationLifecycle.AUTHORIZED},
    CalculationLifecycle.AUTHORIZED: {CalculationLifecycle.QUEUED},
    CalculationLifecycle.QUEUED: {CalculationLifecycle.RUNNING, CalculationLifecycle.CANCELED},
    CalculationLifecycle.RUNNING: {
        CalculationLifecycle.SUCCEEDED,
        CalculationLifecycle.FAILED,
        CalculationLifecycle.CANCELED,
    },
    CalculationLifecycle.SUCCEEDED: set(),
    CalculationLifecycle.FAILED: set(),
    CalculationLifecycle.CANCELED: set(),
}


def require_transition(current: CalculationLifecycle, target: CalculationLifecycle) -> None:
    if target not in ALLOWED_TRANSITIONS[current]:
        raise InvalidLifecycleTransition(
            f"Cannot transition calculation from {current} to {target}."
        )
