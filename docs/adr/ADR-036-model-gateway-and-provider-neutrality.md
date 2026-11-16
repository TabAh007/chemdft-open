# ADR-036: Model Gateway and Provider Neutrality

## Context
ChemDFT requires integration with advanced foundation models (e.g. OpenAI, Anthropic, Google) for reasoning, structured planning, and scientific synthesis. However, tying core business logic to proprietary vendor SDKs introduces dependency bloat, testing friction, credential leakage risks, and vendor lock-in. Furthermore, standard CI pipelines and local test environments must run fully offline without requiring paid third-party API keys.

## Decision
1. **Provider-Neutral ModelGateway Protocol**: Define an abstract `ModelGateway` protocol with a unified `generate(request: ModelRequest) -> ModelResponse` contract supporting typed tool calls, bounded tokens, latency recording, usage accounting, and error typing.
2. **Zero Proprietary SDK Imports in Core**: Core application services depend only on the gateway protocol. HTTP communication is handled using standard `httpx` adapters (`HttpOpenAIModelGateway`) without proprietary vendor packages (`openai`, `@ai-sdk`) in production dependencies.
3. **Deterministic Fake Gateway for CI**: A scripted `FakeModelGateway` is provided by default for CI and local development (`CHEMDFT_AI_PROVIDER=fake`). It simulates model tool decisions and grounded responses without faking scientific outcomes.
4. **Gated Live Integration**: Real provider calls are strictly gated by environment configuration (`CHEMDFT_AI_PROVIDER=openai` and `CHEMDFT_RUN_AI_INTEGRATION=1`), keeping standard `pnpm verify` 100% offline and cost-free.

## Consequences
- **Positive**: Clean architecture boundaries; zero external network calls during normal testing; swappable model backends.
- **Negative**: Provider-specific non-standard features must be normalized across the gateway interface.
