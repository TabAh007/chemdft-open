"""Local structured hooks only. Never accept prompts, raw files, keys or arguments."""

import logging

logger = logging.getLogger("chemdft.ai")
SAFE_FIELDS = frozenset(
    {
        "human_id",
        "organization_id",
        "project_id",
        "run_id",
        "provider",
        "model",
        "mode",
        "tool_id",
        "approval_id",
        "arguments_hash",
        "status",
        "error_code",
        "context_bytes",
        "phase",
        "kind",
        "http_status",
        "elapsed_ms",
        "headers_ms",
        "timeout_seconds",
        "retry_eligible",
        "attempt",
        "estimated_input_tokens",
        "reported_input_tokens",
        "reported_output_tokens",
    }
)


def emit(event: str, **fields) -> None:
    logger.info(
        event,
        extra={
            "ai_event": event,
            "ai_metadata": {key: value for key, value in fields.items() if key in SAFE_FIELDS},
        },
    )
