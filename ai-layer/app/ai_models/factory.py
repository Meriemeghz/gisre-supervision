from __future__ import annotations

from pathlib import Path

from app.ai_models.base import BaseAIModel
from app.ai_models.registry import ModelRegistry


class ModelFactory:
    def __init__(self, model_dir: str | Path = "/app/models") -> None:
        self.model_dir = Path(model_dir)

    def create(self, model_id: str) -> BaseAIModel:
        model_class = ModelRegistry.get_model_class(model_id)
        if model_class is None:
            raise KeyError(f"Unknown AI model: {model_id}")
        model = model_class(self.model_dir)
        model.load()
        return model

    def list_models(self) -> list[dict]:
        return [self.create(model_class.model_id).get_metadata() for model_class in ModelRegistry.list_model_classes()]
