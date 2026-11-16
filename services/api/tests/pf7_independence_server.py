"""Test-only API launcher that makes construction of every model provider a failure."""

import argparse

import uvicorn


def main():
    from chemdft_api.ai import gateway, providers

    def forbidden(*_args, **_kwargs):
        raise AssertionError("Core product flow constructed an AI provider")

    gateway.FakeModelGateway.__init__ = forbidden
    gateway.HttpOpenAIModelGateway.__init__ = forbidden
    gateway.build_model_gateway = forbidden
    providers.build_model_gateway = forbidden
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    from chemdft_api.main import app

    uvicorn.run(app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
