from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
from typing import Any

import numpy as np


ROOT = Path(__file__).resolve().parents[4]
MODEL_CANDIDATES = {
    "multilingual-e5-base": {
        "repository": "intfloat/multilingual-e5-base",
        "revision": "d128750597153bb5987e10b1c3493a34e5a4502a",
        "license": "MIT",
        "dimension": 768,
        "query_prefix": "query: ",
        "document_prefix": "passage: ",
    },
    "bge-m3": {
        "repository": "BAAI/bge-m3",
        "revision": "5617a9f61b028005a4858fdac845db406aefb181",
        "license": "MIT",
        "dimension": 1024,
        "query_prefix": "",
        "document_prefix": "",
    },
}


def _load_contract() -> tuple[type[Any], type[Any]]:
    path = ROOT / "services/api/src/chemdft_api/knowledge/embeddings.py"
    spec = importlib.util.spec_from_file_location("chemdft_phase9_embeddings", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load the Phase 9 embedding gateway contract.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.Embedding, module.DeterministicFakeEmbeddingGateway


Embedding, DeterministicFakeEmbeddingGateway = _load_contract()


class HuggingFaceSentenceGateway:
    """Evaluation-only adapter implementing the existing Phase 9 EmbeddingGateway shape."""

    provider = "huggingface-local"

    def __init__(self, candidate: str, *, offline: bool = False) -> None:
        from sentence_transformers import SentenceTransformer
        import torch

        config = MODEL_CANDIDATES[candidate]
        self.model = candidate
        self.dimension = config["dimension"]
        self.config = config
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.encoder = SentenceTransformer(
            config["repository"],
            revision=config["revision"],
            device=device,
            trust_remote_code=False,
            model_kwargs={"local_files_only": offline},
        )
        self.device = device

    def _embed_batch(self, texts: list[str], prefix: str) -> list[Any]:
        prepared = [prefix + text for text in texts]
        values = self.encoder.encode(
            prepared,
            batch_size=16,
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        values = np.asarray(values, dtype=np.float32)
        if values.ndim == 1:
            values = values.reshape(1, -1)
        if values.shape[1] != self.dimension:
            raise ValueError(
                f"{self.model} emitted {values.shape[1]} dimensions, expected {self.dimension}."
            )
        output = []
        for text, vector in zip(texts, values, strict=True):
            output.append(
                Embedding(
                    vector=tuple(float(value) for value in vector),
                    provider=self.provider,
                    model=str(self.config["repository"]),
                    dimension=self.dimension,
                    normalized=True,
                    usage=len(text.split()),
                    metadata={
                        "revision": str(self.config["revision"]),
                        "device": self.device,
                        "local_only": "true",
                    },
                )
            )
        return output

    def embed_documents(self, texts: list[str]) -> list[Any]:
        return self._embed_batch(texts, str(self.config["document_prefix"]))

    def embed_query(self, text: str) -> Any:
        return self._embed_batch([text], str(self.config["query_prefix"]))[0]


class HuggingFaceMoleculeEncoder:
    """Small local wrappers for pinned, model-card documented molecule encoders."""

    MODELS = {
        "molformer": {
            "repository": "ibm-research/MoLFormer-XL-both-10pct",
            "revision": "361063d0ad524ef77cf39b08469f6be770dc550f",
            "license": "Apache-2.0",
            "dimension": 768,
            "requires_remote_code": True,
        },
        "smi-ted": {
            "repository": "ibm-research/materials.smi-ted",
            "revision": "414c3ea0a8603ef49d1c5bb3db336e09877c01ce",
            "license": "Apache-2.0",
            "dimension": 768,
            "requires_remote_code": False,
        },
    }

    def __init__(self, model_name: str) -> None:
        import torch

        config = self.MODELS[model_name]
        self.config = config
        self.model_name = model_name
        if model_name == "smi-ted":
            self.device = "cpu"
            self._load_smi_ted(torch)
            return

        from transformers import AutoModel, AutoTokenizer

        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.tokenizer = AutoTokenizer.from_pretrained(
            config["repository"],
            revision=config["revision"],
            trust_remote_code=True,
        )
        self.model = AutoModel.from_pretrained(
            config["repository"],
            revision=config["revision"],
            trust_remote_code=True,
            use_safetensors=True,
            deterministic_eval=True,
        ).to(self.device)
        self.model.eval()

    def _load_smi_ted(self, torch: Any) -> None:
        from huggingface_hub import hf_hub_download, snapshot_download

        snapshot = Path(
            snapshot_download(
                self.config["repository"],
                revision=self.config["revision"],
                allow_patterns=[
                    "bert_vocab_curated.txt",
                    "smi-ted-Light_40.pt",
                    "smi-ted/inference/smi_ted_light/**",
                ],
            )
        )
        source_dir = snapshot / "smi-ted/inference/smi_ted_light"
        source_file = source_dir / "load.py"
        if not source_file.exists():
            raise RuntimeError(
                "Pinned IBM SMI-TED inference source is missing from its model snapshot."
            )
        sys.path.insert(0, str(source_dir))
        spec = importlib.util.spec_from_file_location("ibm_smi_ted_load", source_file)
        if spec is None or spec.loader is None:
            raise RuntimeError("Could not load the pinned IBM SMI-TED encoder source.")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        checkpoint = hf_hub_download(
            self.config["repository"],
            filename="smi-ted-Light_40.pt",
            revision=self.config["revision"],
        )
        vocab = hf_hub_download(
            self.config["repository"],
            filename="bert_vocab_curated.txt",
            revision=self.config["revision"],
        )
        original_load = torch.load

        def restricted_load(*args: Any, **kwargs: Any) -> Any:
            kwargs.setdefault("weights_only", True)
            return original_load(*args, **kwargs)

        try:
            torch.load = restricted_load
            self.model = module.load_smi_ted(
                folder=str(source_dir), ckpt_filename=checkpoint, vocab_filename=vocab
            )
        finally:
            torch.load = original_load
        self.model.eval()

    def encode(self, smiles: list[str], batch_size: int = 16) -> np.ndarray:
        import torch

        if self.model_name == "smi-ted":
            with torch.inference_mode():
                vectors = self.model.encode(smiles, batch_size=batch_size).to_numpy(
                    dtype=np.float32
                )
            vectors = np.nan_to_num(vectors, copy=False)
            norms = np.linalg.norm(vectors, axis=1, keepdims=True)
            return vectors / np.maximum(norms, 1e-12)

        outputs: list[np.ndarray] = []
        for offset in range(0, len(smiles), batch_size):
            inputs = self.tokenizer(
                smiles[offset : offset + batch_size],
                padding=True,
                truncation=True,
                max_length=200,
                return_tensors="pt",
            ).to(self.device)
            with torch.inference_mode():
                model_output = self.model(**inputs, return_dict=True)
            pooled = model_output.pooler_output
            pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)
            outputs.extend(pooled.detach().float().cpu().numpy())
        return np.asarray(outputs, dtype=np.float32)
