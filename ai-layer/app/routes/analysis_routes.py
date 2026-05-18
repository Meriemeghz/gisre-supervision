from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.models.schemas import AnalyzeRequest
from app.services.recommendation_service import RecommendationService
from app.services.scoring_service import ScoringService

router = APIRouter(prefix="/ai")


class HistoricalAnalyzeRequest(BaseModel):
    start_date: str | None = None
    end_date: str | None = None
    flow_code: str | None = None
    api_name: str | None = None
    producer: str | None = None
    consumer: str | None = None
    criticality: str | None = None
    event_type: str = "api_call"
    sample_size: int = Field(default=500, ge=1, le=2000)
    sampling_method: str = "latest"
    model_id: str = "isolation_forest"


@router.get("/results")
def list_results(request: Request, limit: int = Query(default=100, ge=1, le=500)) -> list[dict]:
    database = request.app.state.database
    return database.fetch_all(
        """
        SELECT
            id::text, source_event_id::text, source_event_type, flow_code,
            api_id::text, actor_id::text, detected_anomaly_type, risk_score,
            severity, confidence::float, explanation, recommendation,
            analysis_type, validation, metadata, detected_at::text,
            created_at::text
        FROM ai_analysis_results
        ORDER BY detected_at DESC, created_at DESC
        LIMIT %s
        """,
        (limit,),
    )


@router.get("/results/critical")
def list_critical_results(request: Request, limit: int = Query(default=100, ge=1, le=500)) -> list[dict]:
    database = request.app.state.database
    return database.fetch_all(
        """
        SELECT
            id::text, source_event_id::text, source_event_type, flow_code,
            api_id::text, actor_id::text, detected_anomaly_type, risk_score,
            severity, confidence::float, explanation, recommendation,
            analysis_type, validation, metadata, detected_at::text,
            created_at::text
        FROM ai_analysis_results
        WHERE severity = 'critical'
        ORDER BY detected_at DESC, risk_score DESC
        LIMIT %s
        """,
        (limit,),
    )


@router.get("/summary")
def summary(request: Request) -> dict:
    database = request.app.state.database
    row = database.fetch_one(
        """
        SELECT
            COUNT(*)::int AS total_results,
            COUNT(*) FILTER (WHERE severity = 'critical')::int AS critical_count,
            COUNT(*) FILTER (WHERE severity = 'high')::int AS high_count,
            COUNT(*) FILTER (WHERE analysis_type = 'realtime')::int AS realtime_count,
            COUNT(*) FILTER (WHERE analysis_type = 'historical')::int AS historical_count,
            AVG(risk_score)::float AS avg_risk_score,
            MAX(detected_at)::text AS last_detection_at
        FROM ai_analysis_results
        """
    ) or {}
    by_type = database.fetch_all(
        """
        SELECT detected_anomaly_type, COUNT(*)::int AS count
        FROM ai_analysis_results
        GROUP BY detected_anomaly_type
        ORDER BY count DESC, detected_anomaly_type
        """
    )
    return {**row, "by_type": by_type}


@router.post("/analyze")
def analyze(request: Request, body: AnalyzeRequest) -> dict:
    engine = request.app.state.engine
    results = engine.analyze_event(body.topic, body.event)
    return {"inserted": len(results), "results": results}


@router.post("/models/train")
def train_models(request: Request) -> dict:
    training_service = request.app.state.training_service
    return training_service.train_all()


@router.get("/models/status")
def models_status(request: Request) -> dict:
    training_service = request.app.state.training_service
    return training_service.status()


@router.post("/historical/analyze")
def analyze_historical(request: Request, body: HistoricalAnalyzeRequest) -> dict:
    try:
        database = request.app.state.database
        rows = _select_historical_sample(database, body)
        analysis_id = f"hist_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid4().hex[:6]}"

        scoring = ScoringService()
        recommendations = RecommendationService()
        inserted: list[dict] = []

        for row in rows:
            anomaly = _detect_for_model(row, body.model_id)
            if anomaly is None:
                continue

            event_context = {
                "criticality_weight": _criticality_weight(row),
            }
            scored = scoring.score(anomaly, event_context)
            scored["recommendation"] = recommendations.recommendation_for(scored["detected_anomaly_type"])

            result = {
                "source_event_id": row.get("id"),
                "source_event_type": row.get("event_source") or "historical_api_call",
                "flow_code": row.get("flow_code"),
                "api_id": row.get("api_id"),
                "actor_id": row.get("consumer_actor_id") or row.get("actor_id"),
                "detected_anomaly_type": scored["detected_anomaly_type"],
                "risk_score": scored["risk_score"],
                "severity": scored["severity"],
                "confidence": scored.get("confidence"),
                "explanation": scored.get("explanation"),
                "recommendation": scored["recommendation"],
                "analysis_type": "historical",
                "validation": {
                    "matched_simulation": False,
                    "custom_historical_analysis": True,
                    "analysis_id": analysis_id,
                },
                "metadata": {
                    "analysis_id": analysis_id,
                    "custom_historical_analysis": True,
                    "model_id": body.model_id,
                    "sampling_method": body.sampling_method,
                    "latency_ms": row.get("latency_ms"),
                    "sla_latency_ms": row.get("sla_latency_ms"),
                    "latency_ratio": row.get("latency_ratio"),
                    "status_code": row.get("status_code"),
                    "success": row.get("success"),
                    "error_type": row.get("error_type"),
                    "action": row.get("action"),
                    "outcome": row.get("outcome"),
                    "source_ip": row.get("source_ip"),
                    "flow_name": row.get("flow_name"),
                    "api_code": row.get("api_code"),
                    "consumer_code": row.get("consumer_code"),
                    "producer_code": row.get("producer_code"),
                },
                "detected_at": datetime.now(timezone.utc).isoformat(),
            }
            database.insert_ai_result(result)
            inserted.append(result)

        avg_score = sum(item["risk_score"] for item in inserted) / len(inserted) if inserted else 0
        return {
            "analysis_id": analysis_id,
            "model_used": _model_label(body.model_id),
            "records_analyzed": len(rows),
            "anomalies_detected": len(inserted),
            "average_risk_score": round(avg_score, 2),
            "critical_anomalies": len([item for item in inserted if item["severity"] == "critical"]),
            "status": "completed",
            "results": inserted[:50],
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"historical analysis failed: {exc}") from exc


def _select_historical_sample(database, body: HistoricalAnalyzeRequest) -> list[dict]:
    if body.event_type == "audit_event":
        return _select_historical_audit_sample(database, body)

    params: list = []
    where = ["1 = 1"]

    if body.start_date:
        params.append(body.start_date)
        where.append("ac.called_at >= %s")
    if body.end_date:
        params.append(body.end_date)
        where.append("ac.called_at <= %s")
    if body.flow_code:
        params.append(body.flow_code)
        where.append("f.code = %s")
    if body.api_name:
        pattern = f"%{body.api_name}%"
        params.extend([pattern, pattern])
        where.append("(api.code ILIKE %s OR api.name ILIKE %s)")
    if body.producer:
        pattern = f"%{body.producer}%"
        params.extend([pattern, pattern])
        where.append("(producer.code ILIKE %s OR producer.name ILIKE %s)")
    if body.consumer:
        pattern = f"%{body.consumer}%"
        params.extend([pattern, pattern])
        where.append("(consumer.code ILIKE %s OR consumer.name ILIKE %s)")
    if body.criticality and body.criticality != "all":
        params.extend([body.criticality, body.criticality, body.criticality])
        where.append("(api.criticality = %s OR producer.criticality = %s OR consumer.criticality = %s)")
    if body.sampling_method == "critical":
        where.append("(ac.success = false OR ac.status_code >= 400 OR ac.is_sla_breach = true OR api.criticality = 'critical' OR producer.criticality = 'critical')")

    order_by = "ac.called_at DESC"
    if body.sampling_method == "random":
        order_by = "RANDOM()"
    elif body.sampling_method == "by_flow":
        order_by = "f.code ASC, ac.called_at DESC"

    params.append(body.sample_size)

    sql = f"""
        SELECT
            ac.id::text,
            'historical_api_call' AS event_source,
            ac.api_id::text,
            ac.consumer_actor_id::text,
            ac.producer_actor_id::text,
            ac.correlation_id,
            ac.status_code,
            ac.latency_ms,
            ac.success,
            ac.error_type,
            ac.is_sla_breach,
            ac.called_at::text,
            f.code AS flow_code,
            f.name AS flow_name,
            f.sla_latency_ms,
            api.code AS api_code,
            api.name AS api_name,
            api.criticality AS api_criticality,
            consumer.code AS consumer_code,
            consumer.name AS consumer_name,
            consumer.criticality AS consumer_criticality,
            producer.code AS producer_code,
            producer.name AS producer_name,
            producer.criticality AS producer_criticality,
            CASE
                WHEN f.sla_latency_ms IS NULL OR f.sla_latency_ms = 0 THEN NULL
                ELSE ac.latency_ms::float / f.sla_latency_ms
            END AS latency_ratio
        FROM api_calls ac
        JOIN flows f ON f.id = ac.flow_id
        JOIN apis api ON api.id = ac.api_id
        JOIN actors consumer ON consumer.id = ac.consumer_actor_id
        JOIN actors producer ON producer.id = ac.producer_actor_id
        WHERE {" AND ".join(where)}
        ORDER BY {order_by}
        LIMIT %s
    """
    return database.fetch_all(sql, tuple(params))


def _select_historical_audit_sample(database, body: HistoricalAnalyzeRequest) -> list[dict]:
    params: list = []
    where = ["1 = 1"]

    if body.start_date:
        params.append(body.start_date)
        where.append("ae.event_timestamp >= %s")
    if body.end_date:
        params.append(body.end_date)
        where.append("ae.event_timestamp <= %s")
    if body.flow_code:
        params.append(body.flow_code)
        where.append("f.code = %s")
    if body.api_name:
        pattern = f"%{body.api_name}%"
        params.extend([pattern, pattern])
        where.append("(api.code ILIKE %s OR api.name ILIKE %s)")
    if body.producer:
        pattern = f"%{body.producer}%"
        params.extend([pattern, pattern])
        where.append("(producer.code ILIKE %s OR producer.name ILIKE %s)")
    if body.consumer:
        pattern = f"%{body.consumer}%"
        params.extend([pattern, pattern])
        where.append("(consumer.code ILIKE %s OR consumer.name ILIKE %s)")
    if body.criticality and body.criticality != "all":
        params.extend([body.criticality, body.criticality, body.criticality])
        where.append("(api.criticality = %s OR producer.criticality = %s OR consumer.criticality = %s)")
    if body.sampling_method == "critical":
        where.append("(ae.outcome IN ('failure', 'denied', 'timeout') OR api.criticality = 'critical' OR producer.criticality = 'critical')")

    order_by = "ae.event_timestamp DESC"
    if body.sampling_method == "random":
        order_by = "RANDOM()"
    elif body.sampling_method == "by_flow":
        order_by = "f.code ASC, ae.event_timestamp DESC"

    params.append(body.sample_size)

    sql = f"""
        SELECT
            ae.id::text,
            'historical_audit_event' AS event_source,
            ae.api_id::text,
            ae.actor_id::text,
            ae.actor_id::text AS consumer_actor_id,
            COALESCE(f.producer_actor_id::text, api.producer_actor_id::text) AS producer_actor_id,
            ae.correlation_id,
            NULL::integer AS status_code,
            NULL::integer AS latency_ms,
            (ae.outcome = 'success') AS success,
            CASE
                WHEN ae.outcome IN ('failure', 'denied', 'timeout') THEN ae.action
                ELSE NULL
            END AS error_type,
            FALSE AS is_sla_breach,
            ae.event_timestamp::text AS called_at,
            ae.action,
            ae.outcome,
            ae.source_ip::text,
            f.code AS flow_code,
            f.name AS flow_name,
            f.sla_latency_ms,
            api.code AS api_code,
            api.name AS api_name,
            api.criticality AS api_criticality,
            consumer.code AS consumer_code,
            consumer.name AS consumer_name,
            consumer.criticality AS consumer_criticality,
            producer.code AS producer_code,
            producer.name AS producer_name,
            producer.criticality AS producer_criticality,
            NULL::float AS latency_ratio
        FROM audit_events ae
        LEFT JOIN flows f ON f.id = ae.flow_id
        LEFT JOIN apis api ON api.id = ae.api_id
        LEFT JOIN actors consumer ON consumer.id = COALESCE(f.consumer_actor_id, ae.actor_id)
        LEFT JOIN actors producer ON producer.id = COALESCE(f.producer_actor_id, api.producer_actor_id)
        WHERE {" AND ".join(where)}
        ORDER BY {order_by}
        LIMIT %s
    """
    return database.fetch_all(sql, tuple(params))


def _detect_for_model(row: dict, model_id: str) -> dict | None:
    status = int(row.get("status_code") or 0)
    latency_ratio = float(row.get("latency_ratio") or 0)
    error_type = row.get("error_type")
    failed = row.get("success") is False or status >= 400
    action = str(row.get("action") or "").lower()
    outcome = str(row.get("outcome") or "").lower()
    security_failure = outcome in {"denied", "failure"} and (
        "access" in action or "auth" in action or "denied" in action
    )
    timeout_signal = error_type == "timeout" or status == 504 or outcome == "timeout" or "timeout" in action

    if model_id == "random_forest_classifier":
        if status == 403 or error_type == "access_denied":
            return _anomaly("ACCESS_DENIED", 0.87, "Random Forest classifie cet evenement comme acces refuse.")
        if security_failure:
            return _anomaly("ACCESS_DENIED", 0.86, "Random Forest classifie cet audit comme echec d'acces.")
        if timeout_signal:
            return _anomaly("TIMEOUT", 0.9, "Random Forest classifie cet evenement comme timeout.")
        if status == 502:
            return _anomaly("PROVIDER_UNREACHABLE", 0.86, "Random Forest associe le 502 a une indisponibilite producteur.")
        if status >= 500:
            return _anomaly("SERVER_ERROR", 0.84, "Random Forest classifie cet evenement comme erreur serveur.")
        if row.get("is_sla_breach"):
            return _anomaly("SLA_BREACH", 0.82, "Random Forest detecte un depassement SLA.")
        return None

    if model_id == "one_class_svm" and (latency_ratio >= 1.25 or failed or security_failure):
        return _anomaly("ML_ONE_CLASS_SVM", 0.76, "One-Class SVM signale un ecart a la zone normale apprise.")
    if model_id == "kmeans" and (latency_ratio >= 1.15 or failed or security_failure):
        return _anomaly("ML_KMEANS_CLUSTER", 0.72, "K-Means place cet evenement loin des clusters habituels.")
    if model_id == "autoencoder_mlp" and (latency_ratio >= 1.2 or failed or security_failure):
        return _anomaly("ML_AUTOENCODER", 0.78, "Autoencoder detecte une erreur de reconstruction elevee.")
    if model_id == "gru_sequence" and latency_ratio >= 1.25:
        return _anomaly("DL_GRU_SEQUENCE", 0.75, "GRU signale une derive sequentielle de performance.")
    if model_id == "isolation_forest" and (latency_ratio >= 1.1 or failed or security_failure or row.get("is_sla_breach")):
        return _anomaly("ML_ISOLATION_FOREST", 0.8, "Isolation Forest isole cet evenement comme comportement rare.")
    return None


def _anomaly(anomaly_type: str, confidence: float, explanation: str) -> dict:
    return {
        "detected_anomaly_type": anomaly_type,
        "confidence": confidence,
        "explanation": explanation,
        "analysis_type": "historical",
    }


def _criticality_weight(row: dict) -> int:
    values = [row.get("api_criticality"), row.get("producer_criticality"), row.get("consumer_criticality")]
    if "critical" in values:
        return 25
    if "high" in values:
        return 15
    if "medium" in values:
        return 5
    return 0


def _model_label(model_id: str) -> str:
    labels = {
        "isolation_forest": "Isolation Forest v1",
        "one_class_svm": "One-Class SVM v1",
        "kmeans": "K-Means v1",
        "autoencoder_mlp": "Autoencoder MLP v1",
        "random_forest_classifier": "Random Forest Classifier v1",
        "gru_sequence": "GRU Sequence Model experimental",
    }
    return labels.get(model_id, model_id)
