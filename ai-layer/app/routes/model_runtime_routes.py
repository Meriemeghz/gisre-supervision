from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request
from pydantic import BaseModel

from app.ai_models.factory import ModelFactory
from app.services.cache_service import get_cache
from app.services.human_feedback_service import HumanFeedbackService

router = APIRouter(prefix="/ai/models")


class ActivationPolicyUpdate(BaseModel):
    active_model_id: str | None = None
    enabled_models: dict[str, bool] | None = None


@router.get("/activation-policy")
def activation_policy(request: Request) -> dict:
    cache = get_cache(request.app.state)
    if cache is not None:
        cached = cache.get_json("activation_policy")
        if cached is not None:
            return cached
    response = _policy_with_lifecycle(request)
    if cache is not None:
        cache.set_json("activation_policy", response, ttl=300)
    return response


@router.patch("/activation-policy/{analysis_level}")
def update_activation_policy(
    analysis_level: str,
    request: Request,
    body: ActivationPolicyUpdate,
) -> dict:
    try:
        updated = request.app.state.engine.model_policy.update_level(
            analysis_level.strip().lower(),
            body.active_model_id,
            body.enabled_models,
            update_active="active_model_id" in body.model_fields_set,
        )
        _invalidate_activation_policy_cache(request)
        return _enrich_level(request, updated)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


def _policy_with_lifecycle(request: Request) -> dict:
    policy = request.app.state.engine.model_policy.get_policy()
    return {
        level_name: _enrich_level(request, level)
        for level_name, level in policy.items()
    }


def _enrich_level(request: Request, level: dict[str, Any]) -> dict[str, Any]:
    monitoring = getattr(request.app.state, "model_monitoring_service", None)
    enriched_models = []
    for model in level.get("models") or []:
        enriched = dict(model)
        if monitoring is not None:
            try:
                lifecycle = monitoring.lifecycle_metadata(model["model_id"])
                enriched.update(
                    {
                        "version": lifecycle.get("current_version") or model.get("version"),
                        "trained_status": (
                            "not_required"
                            if model.get("trained_status") == "not_required"
                            else "trained"
                            if lifecycle.get("trained")
                            else "not_trained"
                        ),
                        "last_trained_at": lifecycle.get("last_trained_at"),
                        "freshness_score": lifecycle.get("freshness_score"),
                        "drift_score": lifecycle.get("drift_score"),
                        "retraining_recommended": lifecycle.get("retraining_recommended"),
                    }
                )
            except Exception:
                pass
        enriched_models.append(enriched)
    return {**level, "models": enriched_models}


class ModelPredictRequest(BaseModel):
    event: dict[str, Any]


class ModelTrainRequest(BaseModel):
    records: list[dict[str, Any]] | None = None
    dataset_start: datetime | None = None
    dataset_end: datetime | None = None
    sample_size: int = 20000
    triggered_by: str = "supervisor"
    training_mode: str = "manual"
    recommendation_reason: str | None = None
    training_options: dict[str, Any] | None = None


@router.get("/feedback-dataset/summary")
def get_feedback_dataset_summary(
    request: Request,
    model_id: str | None = None,
    analysis_level: str | None = None,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
) -> dict:
    cache = get_cache(request.app.state)
    cache_key = cache.build_cache_key(
        "feedback_dataset_summary",
        {
            "model_id": model_id,
            "analysis_level": analysis_level,
            "start_date": start_date,
            "end_date": end_date,
        },
    ) if cache is not None else None
    if cache is not None and cache_key is not None:
        cached = cache.get_json(cache_key)
        if cached is not None:
            return cached
    response = _feedback(request).summary(
        model_id=model_id,
        analysis_level=analysis_level,
        start_date=start_date,
        end_date=end_date,
    )
    if cache is not None and cache_key is not None:
        cache.set_json(cache_key, response, ttl=300)
    return response


@router.get("/feedback-dataset")
def get_feedback_dataset(
    request: Request,
    model_id: str | None = None,
    analysis_level: str | None = None,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
) -> list[dict[str, Any]]:
    return _feedback(request).dataset(
        model_id=model_id,
        analysis_level=analysis_level,
        start_date=start_date,
        end_date=end_date,
    )


@router.post("/{model_id}/prepare-feedback-training")
def prepare_feedback_training(request: Request, model_id: str) -> dict:
    _load_model(request, model_id)
    return _feedback(request).training_readiness(model_id)


@router.get("")
def list_runtime_models(request: Request) -> dict:
    factory = _factory(request)
    monitoring = _monitoring(request)
    models = []
    for model in factory.list_models():
        try:
            model["lifecycle"] = monitoring.lifecycle_metadata(model["id"])
        except Exception:
            model["lifecycle"] = None
        models.append(model)
    return {
        "count": len(models),
        "models": models,
        "families": sorted({model["family"] for model in models}),
    }


@router.get("/{model_id}/lifecycle")
def get_model_lifecycle(request: Request, model_id: str) -> dict:
    _load_model(request, model_id)
    return _monitoring(request).lifecycle_metadata(model_id)


@router.get("/{model_id}/retraining-recommendation")
def get_retraining_recommendation(request: Request, model_id: str) -> dict:
    _load_model(request, model_id)
    return _monitoring(request).retraining_recommendation(model_id)


@router.get("/{model_id}/training-history")
def get_training_history(request: Request, model_id: str, limit: int = Query(default=20, ge=1, le=100)) -> dict:
    _load_model(request, model_id)
    return {"model_id": model_id, "jobs": _monitoring(request).training_history(model_id, limit)}


@router.get("/{model_id}/drift")
def get_model_drift(request: Request, model_id: str) -> dict:
    _load_model(request, model_id)
    monitoring = _monitoring(request)
    recommendation = monitoring.retraining_recommendation(model_id)
    return {
        "model_id": model_id,
        "drift_score": recommendation["drift_score"],
        "freshness_score": recommendation["freshness_score"],
        "series": monitoring.drift_series(model_id),
    }


@router.post("/{model_id}/train")
def train_runtime_model(
    request: Request,
    model_id: str,
    body: ModelTrainRequest,
    background_tasks: BackgroundTasks,
) -> dict:
    model = _load_model(request, model_id)
    if model.model_type == "rules":
        raise HTTPException(status_code=400, detail="Rules Engine does not require training")
    if model.is_mock:
        raise HTTPException(status_code=400, detail="This model is a placeholder and cannot be trained")

    monitoring = _monitoring(request)
    job = monitoring.create_training_job(
        model_id,
        {
            "model_version": model.version,
            "analysis_level": (model.supported_analysis_levels or ["event"])[0],
            "training_mode": body.training_mode,
            "dataset_start": body.dataset_start,
            "dataset_end": body.dataset_end,
            "sample_size": body.sample_size,
            "triggered_by": body.triggered_by,
            "recommendation_reason": body.recommendation_reason,
            "training_metadata": {
                "records_provided": len(body.records or []),
                "async": True,
                "source": "manual_api",
                "training_options": body.training_options or {},
            },
        },
    )
    background_tasks.add_task(monitoring.run_training_job, job["id"])
    _invalidate_runtime_model_cache(request, model_id)
    return {
        "metadata": model.get_metadata(),
        "job": job,
        "message": "Training job accepted. Inference remains active and is not blocked.",
    }


@router.get("/{model_id}")
def get_runtime_model(request: Request, model_id: str) -> dict:
    model = _load_model(request, model_id)
    metadata = model.get_metadata()
    try:
        metadata["lifecycle"] = _monitoring(request).lifecycle_metadata(model_id)
    except Exception:
        metadata["lifecycle"] = None
    return metadata


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


def _monitoring(request: Request):
    service = getattr(request.app.state, "model_monitoring_service", None)
    if service is None:
        raise HTTPException(status_code=503, detail="Model monitoring service is not initialized")
    return service


def _feedback(request: Request) -> HumanFeedbackService:
    service = getattr(request.app.state, "human_feedback_service", None)
    if service is None:
        database = getattr(request.app.state, "database", None)
        if database is None:
            raise HTTPException(
                status_code=503,
                detail="Human feedback dataset service is not initialized",
            )
        service = HumanFeedbackService(database, _factory(request))
        request.app.state.human_feedback_service = service
    return service


def _load_model(request: Request, model_id: str):
    try:
        model = _factory(request).create(model_id)
        model.load()
        return model
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _invalidate_activation_policy_cache(request: Request) -> None:
    cache = get_cache(request.app.state)
    if cache is None:
        return
    cache.delete("activation_policy")
    cache.delete("model_catalog")
    cache.delete("model_catalog:full")
    cache.delete("model_metrics:all")
    cache.delete_pattern("model_detail:*")


def _invalidate_runtime_model_cache(request: Request, model_id: str) -> None:
    cache = get_cache(request.app.state)
    if cache is None:
        return
    cache.delete(f"model_metrics:{model_id}")
    cache.delete(f"training_history:{model_id}")
    cache.delete(f"model_detail:{model_id}")
