"""Isolated PF-7 browser fixture. Never imported by application/runtime code.

All provider calls are mocked; keys are fake and tests have no provider networking.
"""

import os
from dataclasses import replace

import uvicorn
from cryptography.fernet import Fernet


def main():
    if os.environ.get("CHEMDFT_PF7_BROWSER_FIXTURE") != "fake-credentials-only":
        raise RuntimeError("Explicit isolated browser fixture opt-in is required")
    os.environ["CHEMDFT_BYOK_LOCAL_MASTER_KEY"] = Fernet.generate_key().decode()

    from chemdft_api.ai.gateway import (
        FakeModelGateway,
        HttpOpenAIModelGateway,
        ModelAuthenticationError,
    )
    from chemdft_api.auth import ensure_dev_identity
    from chemdft_api.config import get_settings
    from chemdft_api.database import SessionLocal
    from chemdft_api.examples.seed import seed_examples

    settings = get_settings()
    assert settings.environment == "test" and settings.ai_provider == "fake"
    assert "pf7-browser" in settings.database_url

    def mocked_generate(self, request):
        if not self._api_key.startswith("pf7-fake-"):
            raise ModelAuthenticationError("Mocked invalid credential")
        response = FakeModelGateway().generate(request)
        return replace(response, provider=self._provider, model_identifier=request.model_identifier)

    HttpOpenAIModelGateway.generate = mocked_generate
    from chemdft_api.database import Base, engine
    from chemdft_api.main import app

    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        ensure_dev_identity(session, settings)
        from chemdft_api.storage import LocalObjectStore

        seed_examples(session, LocalObjectStore(settings.object_root), publish=True)
    uvicorn.run(app, host="127.0.0.1", port=8177)


if __name__ == "__main__":
    main()
