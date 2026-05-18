from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.ai_models.factory import ModelFactory

router = APIRouter(prefix="/ai/models")


class ModelPredictRequest(BaseModel):
    event: dict[str, Any]


class ModelTrainRequest(BaseModel):
    records: list[dict[str, Any]] | None = None


@router.get("")
def list_runtime_models(request: Request) -> dict:
    factory = _factory(request)
    models = factory.list_models()
    return {
        "count": len(models),
        "models": models,
        "families": sorted({model["family"] for model in models}),
    }


@router.get("/{model_id}")
def get_runtime_model(request: Request, model_id: str) -> dict:
    model = _load_model(request, model_id)
    return model.get_metadata()


@router.post("/{model_id}/train")
def train_runtime_model(request: Request, model_id: str, body: ModelTrainRequest) -> dict:
    model = _load_model(request, model_id)
    return {
        "metadata": model.get_metadata(),
        "training": model.train(body.records),
        "evaluation": model.evaluate(body.records),
    }


@router.post("/{model_id}/predict")
def predict_runtime_model(request: Request, model_id: str, body: ModelPredictRequest) -> dict:
    model = _load_model(request, model_id)
    return model.predict(body.event)


def _factory(request: Request) -> ModelFactory:
    factory = getattr(request.app.state, "model_factory", None)
    if factory is None:
        factory = ModelFactory()
        request.app.state.model_factory = factory
    return factory


def _load_model(request: Request, model_id: str):
    try:
        return _factory(request).create(model_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
