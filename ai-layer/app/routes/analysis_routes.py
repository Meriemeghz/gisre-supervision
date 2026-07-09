from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.models.schemas import AnalyzeRequest
from app.core.config import settings
from app.services.cache_service import get_cache
from app.services.recommendation_service import RecommendationService
from app.services.scoring_service import ScoringService

logger = logging.getLogger(__name__)

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


class ValidationUpdateRequest(BaseModel):
    validation_status: str = Field(..., min_length=1, max_length=30)
    validation_comment: str | None = None
    validated_by: str = Field(default="supervisor", min_length=1, max_length=120)


class DemoValidationSeedRequest(BaseModel):
    limit: int = Field(default=20, ge=1, le=100)


VALIDATION_STATUSES = {
    "unverified",
    "pending_review",
    "confirmed",
    "partial",
    "false_positive",
    "ignored",
    "resolved",
    "auto_confirmed",
    "auto_dismissed",
}

HUMAN_VALIDATION_STATUSES = {
    "pending_review",
    "confirmed",
    "partial",
    "false_positive",
    "ignored",
    "resolved",
}

PENDING_REVIEW_STATUSES = ("unverified", "pending_review", "partial")

TECHNICAL_EVIDENT_ANOMALIES = {
    "TIMEOUT",
    "SERVER_ERROR",
    "PROVIDER_UNREACHABLE",
    "CORRUPTED_EVENT_PAYLOAD",
    "FLOW_ERROR_RATE_SPIKE",
    "FLOW_PROVIDER_DEGRADATION",
    "FLOW_INTERMITTENT_FAILURES",
    "FLOW_HEALTH_DEGRADATION",
}

SECURITY_BEHAVIOR_ANOMALIES = {
    "ACCESS_DENIED",
    "RATE_LIMIT_EXCEEDED",
    "ACCESS_DENIED_ANOMALY",
    "AUTHENTICATION_ABUSE",
    "TOKEN_FAILURE_PATTERN",
    "UNAUTHORIZED_API_ATTEMPT",
    "ENDPOINT_ENUMERATION",
    "PRIVILEGE_MISUSE",
    "CONSUMER_BEHAVIOR_SHIFT",
    "CONSUMER_PROFILE_DRIFT",
    "UNUSUAL_API_USAGE",
    "RARE_API_ACCESS",
    "RARE_FLOW_ACTIVATION",
    "WORKFLOW_SEQUENCE_ANOMALY",
}


@router.get("/analytics/historical")
def historical_analytics(
    request: Request,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
    flow_code: str | None = None,
    api_code: str | None = None,
    producer_code: str | None = None,
    consumer_code: str | None = None,
    anomaly_type: str | None = None,
) -> dict:
    database = request.app.state.database
    period_end = _as_utc(end_date or datetime.now(timezone.utc))
    period_start = _as_utc(start_date or (period_end - timedelta(days=7)))
    if period_start >= period_end:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")
    if period_end - period_start > timedelta(days=366):
        raise HTTPException(status_code=400, detail="historical range cannot exceed 366 days")
    period_midpoint = period_start + ((period_end - period_start) / 2)
    cache = get_cache(request.app.state)
    cache_key = None
    if cache is not None:
        cache_key = cache.build_cache_key(
            "historical",
            {
                "start_date": period_start.isoformat(),
                "end_date": period_end.isoformat(),
                "period": None,
                "flow_code": flow_code,
                "api_code": api_code,
                "producer_code": producer_code,
                "consumer_code": consumer_code,
                "anomaly_type": anomaly_type,
            },
        )
        cached = cache.get_json(cache_key)
        if cached is not None:
            return cached

    bucket = "hour" if period_end - period_start <= timedelta(days=2) else "day"
    if period_end - period_start > timedelta(days=45):
        bucket = "week"

    # Single consolidated query: historical_results is MATERIALIZED once and reused
    # by all sub-analyses, replacing 6 separate sequential queries.
    query = f"""
        WITH historical_results AS MATERIALIZED (
            SELECT
                results.id,
                results.detected_at,
                results.detected_anomaly_type,
                results.risk_score,
                results.severity,
                results.metadata,
                COALESCE(to_jsonb(results)->>'validation_status', 'unverified') AS validation_status,
                COALESCE(results.flow_code, results.metadata->>'flow_code', calls.flow_code) AS flow_code,
                COALESCE(results.metadata->>'api_code', calls.api_code) AS api_code,
                COALESCE(results.metadata->>'producer_code', calls.producer_code) AS producer_code,
                COALESCE(results.metadata->>'consumer_code', calls.consumer_code) AS consumer_code
            FROM ai_analysis_results results
            LEFT JOIN api_calls calls ON calls.id = results.source_event_id
            WHERE results.detected_at >= %s
              AND results.detected_at < %s
              AND (%s::text IS NULL OR COALESCE(results.flow_code, results.metadata->>'flow_code', calls.flow_code) = %s)
              AND (%s::text IS NULL OR COALESCE(results.metadata->>'api_code', calls.api_code) = %s)
              AND (%s::text IS NULL OR COALESCE(results.metadata->>'producer_code', calls.producer_code) = %s)
              AND (%s::text IS NULL OR COALESCE(results.metadata->>'consumer_code', calls.consumer_code) = %s)
              AND (%s::text IS NULL OR results.detected_anomaly_type = %s)
        ),
        anomaly_timeline AS MATERIALIZED (
            SELECT
                date_trunc('{bucket}', detected_at)::text AS bucket,
                detected_anomaly_type AS anomaly_type,
                COUNT(*)::int AS count
            FROM historical_results
            WHERE detected_anomaly_type IS NOT NULL
              AND detected_anomaly_type <> 'NORMAL'
            GROUP BY date_trunc('{bucket}', detected_at), detected_anomaly_type
        ),
        evolving_anomalies AS MATERIALIZED (
            SELECT
                detected_anomaly_type AS anomaly_type,
                COUNT(*)::int AS occurrences,
                MIN(detected_at)::text AS first_seen,
                MAX(detected_at)::text AS last_seen,
                COUNT(*) FILTER (WHERE detected_at < %s)::int AS previous_period_count,
                COUNT(*) FILTER (WHERE detected_at >= %s)::int AS recent_period_count
            FROM historical_results
            WHERE detected_anomaly_type IS NOT NULL
              AND detected_anomaly_type <> 'NORMAL'
            GROUP BY detected_anomaly_type
        ),
        heatmap_raw AS (
            SELECT
                EXTRACT(ISODOW FROM detected_at)::int AS day,
                EXTRACT(HOUR FROM detected_at)::int AS hour,
                COALESCE(detected_anomaly_type, 'UNKNOWN_ANOMALY') AS anomaly_type,
                COUNT(*)::int AS anomaly_count,
                SUM(COALESCE(risk_score, 0))::float AS risk_sum
            FROM historical_results
            WHERE (
                LOWER(COALESCE(
                    metadata #>> '{{analysis_trace,event,anomaly_detected}}',
                    metadata #>> '{{analysis_trace,flow,anomaly_detected}}',
                    'false'
                )) = 'true'
                OR COALESCE(detected_anomaly_type, 'NORMAL') <> 'NORMAL'
                OR severity <> 'low'
            )
            GROUP BY
                EXTRACT(ISODOW FROM detected_at),
                EXTRACT(HOUR FROM detected_at),
                COALESCE(detected_anomaly_type, 'UNKNOWN_ANOMALY')
        ),
        heatmap_ranked AS (
            SELECT
                day, hour, anomaly_type, anomaly_count,
                SUM(anomaly_count) OVER (PARTITION BY day, hour)::int AS total_count,
                SUM(risk_sum) OVER (PARTITION BY day, hour)::float AS total_risk,
                ROW_NUMBER() OVER (
                    PARTITION BY day, hour ORDER BY anomaly_count DESC, anomaly_type
                ) AS anomaly_rank
            FROM heatmap_raw
        ),
        temporal_heatmap AS MATERIALIZED (
            SELECT
                day, hour,
                MAX(total_count)::int AS anomaly_count,
                MAX(CASE WHEN anomaly_rank = 1 THEN anomaly_type END) AS top_anomaly_type,
                CASE WHEN MAX(total_count) = 0 THEN NULL
                     ELSE (MAX(total_risk) / MAX(total_count))::float
                END AS average_risk_score
            FROM heatmap_ranked
            GROUP BY day, hour
        ),
        root_rows AS MATERIALIZED (
            SELECT
                producer_code, api_code,
                detected_anomaly_type AS anomaly_type,
                COUNT(*)::int AS anomaly_count,
                AVG(risk_score)::float AS average_risk_score,
                MAX(risk_score)::int AS max_risk_score,
                SUM(COALESCE(risk_score, 0))::float AS risk_sum,
                CASE MAX(CASE severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END)
                    WHEN 4 THEN 'critical' WHEN 3 THEN 'high' WHEN 2 THEN 'medium' ELSE 'low'
                END AS criticality,
                AVG(CASE severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END)::float AS average_severity_score,
                MIN(detected_at)::text AS first_seen,
                MAX(detected_at)::text AS last_seen,
                COUNT(DISTINCT flow_code)::int AS impacted_flows
            FROM historical_results
            WHERE detected_anomaly_type IS NOT NULL
              AND detected_anomaly_type NOT IN ('NORMAL', 'FLOW_NORMAL')
              AND producer_code IS NOT NULL
              AND api_code IS NOT NULL
            GROUP BY producer_code, api_code, detected_anomaly_type
            ORDER BY average_risk_score DESC NULLS LAST, anomaly_count DESC
            LIMIT 200
        ),
        quality AS MATERIALIZED (
            SELECT
                COUNT(*)::int AS total_results,
                COUNT(*) FILTER (WHERE detected_anomaly_type IS NOT NULL AND detected_anomaly_type <> 'NORMAL')::int AS anomalies_detected,
                COUNT(*) FILTER (WHERE detected_anomaly_type = 'NORMAL')::int AS normal_results,
                COUNT(*) FILTER (WHERE validation_status = 'false_positive' AND detected_anomaly_type <> 'NORMAL')::int AS false_positives,
                COUNT(*) FILTER (WHERE validation_status = 'confirmed' AND detected_anomaly_type <> 'NORMAL')::int AS true_positives,
                COUNT(*) FILTER (WHERE validation_status IN ('unverified', 'pending_review', 'partial') AND detected_anomaly_type <> 'NORMAL')::int AS pending_reviews,
                COUNT(*) FILTER (WHERE validation_status IN ('confirmed', 'partial', 'false_positive', 'ignored') AND detected_anomaly_type <> 'NORMAL')::int AS reviewed_results
            FROM historical_results
        )
        SELECT
            (SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.bucket, t.anomaly_type), '[]'::json) FROM anomaly_timeline t) AS anomaly_timeline,
            (SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.occurrences DESC, t.anomaly_type), '[]'::json) FROM evolving_anomalies t) AS evolving_anomalies,
            (SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.day, t.hour), '[]'::json) FROM temporal_heatmap t) AS temporal_heatmap,
            (SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM root_rows t) AS root_rows,
            (SELECT row_to_json(t) FROM quality t) AS quality,
            (SELECT COALESCE(array_agg(DISTINCT flow_code ORDER BY flow_code) FILTER (WHERE flow_code IS NOT NULL), ARRAY[]::text[]) FROM historical_results) AS filter_flow_codes,
            (SELECT COALESCE(array_agg(DISTINCT api_code ORDER BY api_code) FILTER (WHERE api_code IS NOT NULL), ARRAY[]::text[]) FROM historical_results) AS filter_api_codes,
            (SELECT COALESCE(array_agg(DISTINCT producer_code ORDER BY producer_code) FILTER (WHERE producer_code IS NOT NULL), ARRAY[]::text[]) FROM historical_results) AS filter_producer_codes,
            (SELECT COALESCE(array_agg(DISTINCT consumer_code ORDER BY consumer_code) FILTER (WHERE consumer_code IS NOT NULL), ARRAY[]::text[]) FROM historical_results) AS filter_consumer_codes,
            (SELECT COALESCE(array_agg(DISTINCT detected_anomaly_type ORDER BY detected_anomaly_type) FILTER (WHERE detected_anomaly_type IS NOT NULL AND detected_anomaly_type NOT IN ('NORMAL', 'FLOW_NORMAL')), ARRAY[]::text[]) FROM historical_results) AS filter_anomaly_types
    """

    query_params = (
        period_start, period_end,
        flow_code, flow_code,
        api_code, api_code,
        producer_code, producer_code,
        consumer_code, consumer_code,
        anomaly_type, anomaly_type,
        period_midpoint, period_midpoint,
    )

    try:
        raw = database.fetch_one(query, query_params) or {}
    except Exception as exc:
        logger.exception("Failed to load historical analytics")
        raise HTTPException(status_code=500, detail=f"historical analytics failed: {exc}") from exc

    anomaly_timeline = raw.get("anomaly_timeline") or []
    evolving_anomalies = raw.get("evolving_anomalies") or []
    temporal_heatmap = raw.get("temporal_heatmap") or []
    root_rows = raw.get("root_rows") or []
    quality = dict(raw.get("quality") or {})

    root_cause_chains = [
        {
            "producer_code": row.get("producer_code"),
            "api_code": row.get("api_code"),
            "anomaly_type": row.get("anomaly_type"),
            "occurrences": row.get("anomaly_count"),
            "average_risk_score": row.get("average_risk_score"),
            "max_risk_score": row.get("max_risk_score"),
            "risk_sum": row.get("risk_sum"),
            "criticality": row.get("criticality"),
            "average_severity_score": row.get("average_severity_score"),
            "first_seen": row.get("first_seen"),
            "last_seen": row.get("last_seen"),
            "impacted_flows": row.get("impacted_flows"),
        }
        for row in root_rows
    ]
    root_causes = _legacy_root_cause_groups(root_cause_chains)

    reviewed = int(quality.get("reviewed_results") or 0)
    anomalies = int(quality.get("anomalies_detected") or 0)
    quality["validation_rate"] = reviewed / anomalies if anomalies else None

    filter_options = {
        "flow_code": list(raw.get("filter_flow_codes") or []),
        "api_code": list(raw.get("filter_api_codes") or []),
        "producer_code": list(raw.get("filter_producer_codes") or []),
        "consumer_code": list(raw.get("filter_consumer_codes") or []),
        "anomaly_type": list(raw.get("filter_anomaly_types") or []),
    }

    top_anomalies = [
        {"anomaly_type": row["anomaly_type"], "count": row["occurrences"]}
        for row in sorted(
            evolving_anomalies,
            key=lambda item: int(item.get("occurrences") or 0),
            reverse=True,
        )[:12]
    ]
    hourly_counts: dict[int, int] = {}
    daily_counts: dict[int, int] = {}
    for row in temporal_heatmap:
        hour = int(row.get("hour") or 0)
        day = int(row.get("day") or 0)
        count = int(row.get("anomaly_count") or 0)
        hourly_counts[hour] = hourly_counts.get(hour, 0) + count
        daily_counts[day] = daily_counts.get(day, 0) + count
    hourly = [{"hour": hour, "count": count} for hour, count in sorted(hourly_counts.items())]
    daily = [{"day": day, "count": count} for day, count in sorted(daily_counts.items())]
    timeline_totals: dict[str, int] = {}
    for row in anomaly_timeline:
        timeline_bucket = str(row.get("bucket") or "")
        timeline_totals[timeline_bucket] = (
            timeline_totals.get(timeline_bucket, 0) + int(row.get("count") or 0)
        )
    trends = [
        {
            "bucket": timeline_bucket,
            "anomaly_count": count,
            "average_risk_score": None,
            "average_latency_ms": None,
            "error_rate": None,
        }
        for timeline_bucket, count in sorted(timeline_totals.items())
    ]

    response = {
        "period": {
            "start_date": period_start.isoformat(),
            "end_date": period_end.isoformat(),
            "bucket": bucket,
        },
        "filters": {
            "flow_code": flow_code,
            "api_code": api_code,
            "producer_code": producer_code,
            "consumer_code": consumer_code,
            "anomaly_type": anomaly_type,
        },
        "filter_options": filter_options,
        "trends": trends,
        "anomaly_timeline": anomaly_timeline,
        "evolving_anomalies": evolving_anomalies,
        "recurrences": {
            "top_anomalies": top_anomalies,
            "by_hour": hourly,
            "by_day": daily,
        },
        "temporal_heatmap": temporal_heatmap,
        "root_cause_chains": root_cause_chains,
        "root_cause_groups": root_causes,
        "supervision_quality": quality,
        "llm_ready_summary_payload": {
            "period": {"start_date": period_start.isoformat(), "end_date": period_end.isoformat()},
            "dominant_anomalies": top_anomalies[:5],
            "evolving_anomalies": evolving_anomalies[:10],
            "problematic_flows": root_causes["flow_code"][:5],
            "involved_producers": root_causes["producer_code"][:5],
            "risk_trend": [
                {"bucket": row.get("bucket"), "average_risk_score": row.get("average_risk_score")}
                for row in trends
            ],
        },
    }
    if cache is not None and cache_key is not None:
        cache.set_json(cache_key, response, ttl=600)
    return response



def _legacy_root_cause_groups(chains: list[dict]) -> dict:
    groups: dict[str, list[dict]] = {
        "producer_code": [],
        "consumer_code": [],
        "api_code": [],
        "flow_code": [],
    }
    for dimension, field in (("producer_code", "producer_code"), ("api_code", "api_code")):
        aggregated: dict[str, dict] = {}
        for chain in chains:
            code = chain.get(field)
            if not code:
                continue
            item = aggregated.setdefault(
                str(code),
                {
                    "code": str(code),
                    "anomaly_count": 0,
                    "risk_sum": 0.0,
                    "max_risk_score": 0,
                },
            )
            occurrences = int(chain.get("occurrences") or 0)
            item["anomaly_count"] += occurrences
            item["risk_sum"] += float(chain.get("risk_sum") or 0)
            item["max_risk_score"] = max(
                item["max_risk_score"],
                int(chain.get("max_risk_score") or 0),
            )
        ranked = []
        for item in aggregated.values():
            count = item.pop("anomaly_count")
            risk_sum = item.pop("risk_sum")
            ranked.append(
                {
                    **item,
                    "anomaly_count": count,
                    "average_risk_score": risk_sum / count if count else None,
                }
            )
        groups[dimension] = sorted(
            ranked,
            key=lambda item: (
                int(item.get("anomaly_count") or 0),
                int(item.get("max_risk_score") or 0),
            ),
            reverse=True,
        )[:10]
    return groups


class HistoricalInterpretPayload(BaseModel):
    period: dict
    filters: dict
    anomaly_family_evolution: list
    temporal_heatmap_summary: dict
    top_evolving_anomalies: list
    root_cause_chains: list
    supervision_quality: dict


_INTERPRET_SYSTEM_PROMPT = (
    "Tu es un assistant d'observabilité pour une plateforme nationale d'interopérabilité (GISRE Maroc).\n"
    "Tu analyses UNIQUEMENT les agrégats statistiques historiques fournis dans le message utilisateur.\n"
    "Tu ne crées pas de chiffres. Tu ne cites pas de données absentes du contexte fourni.\n"
    "Tu ne proposes pas d'action technique non justifiée par les données.\n"
    "Tu rédiges en français professionnel et opérationnel.\n"
    "Retourne UNIQUEMENT un objet JSON valide avec exactement cette structure :\n"
    "{\n"
    '  "executive_summary": "résumé exécutif en 2-3 phrases",\n'
    '  "key_findings": ["constat 1", "constat 2", "constat 3"],\n'
    '  "risk_interpretation": "lecture du niveau de risque global",\n'
    '  "root_cause_interpretation": "analyse des causes racines dominantes",\n'
    '  "temporal_interpretation": "lecture des patterns temporels",\n'
    '  "recommendations": ["recommandation 1", "recommandation 2", "recommandation 3"],\n'
    '  "confidence_note": "note sur la fiabilité de l\'interprétation"\n'
    "}"
)


@router.post("/analytics/historical/interpret")
async def historical_interpret(payload: HistoricalInterpretPayload, request: Request) -> dict:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return {"configured": False, "message": "LLM interpretation not configured yet"}
    cache = get_cache(request.app.state)
    cache_key = cache.build_cache_key("openai:historical", payload.model_dump()) if cache is not None else None
    if cache is not None and cache_key is not None:
        cached = cache.get_json(cache_key)
        if cached is not None:
            return cached

    anomalies_detected = int(payload.supervision_quality.get("anomalies_detected") or 0)
    if anomalies_detected == 0 and not payload.top_evolving_anomalies:
        response = {
            "configured": True,
            "executive_summary": "Not enough historical data to generate an insight.",
            "key_findings": [],
            "risk_interpretation": "Not available",
            "root_cause_interpretation": "Not available",
            "temporal_interpretation": "Not available",
            "recommendations": [],
            "confidence_note": "No anomaly data found for the selected period and filters.",
        }
        if cache is not None and cache_key is not None:
            cache.set_json(cache_key, response, ttl=86400)
        return response

    active_filters = {k: v for k, v in payload.filters.items() if v}
    period_label = f"{payload.period.get('start_date', '')} → {payload.period.get('end_date', '')}"

    user_content = (
        f"Analyse historique GISRE — période : {period_label}\n"
        f"Filtres actifs : {json.dumps(active_filters, ensure_ascii=False) if active_filters else 'aucun'}\n\n"
        f"ÉVOLUTION DES FAMILLES D'ANOMALIES :\n"
        f"{json.dumps(payload.anomaly_family_evolution, ensure_ascii=False, indent=2)}\n\n"
        f"TOP ANOMALIES EN ÉVOLUTION :\n"
        f"{json.dumps(payload.top_evolving_anomalies, ensure_ascii=False, indent=2)}\n\n"
        f"SYNTHÈSE HEATMAP TEMPORELLE :\n"
        f"{json.dumps(payload.temporal_heatmap_summary, ensure_ascii=False, indent=2)}\n\n"
        f"CHAÎNES DE CAUSE RACINE PRINCIPALES :\n"
        f"{json.dumps(payload.root_cause_chains, ensure_ascii=False, indent=2)}\n\n"
        f"QUALITÉ DE SUPERVISION :\n"
        f"{json.dumps(payload.supervision_quality, ensure_ascii=False, indent=2)}\n\n"
        "Retourne l'analyse JSON comme spécifié dans tes instructions."
    )

    try:
        from openai import AsyncOpenAI  # noqa: PLC0415
        client = AsyncOpenAI(api_key=api_key)
        response = await client.responses.create(
            model="gpt-4o",
            instructions=_INTERPRET_SYSTEM_PROMPT,
            input=user_content,
            text={"format": {"type": "json_object"}},
        )
        raw = (response.output_text or "").strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
        result = {"configured": True, **json.loads(raw)}
        if cache is not None and cache_key is not None:
            cache.set_json(cache_key, result, ttl=86400)
        return result
    except Exception as exc:
        logger.exception("OpenAI interpretation failed")
        raise HTTPException(status_code=500, detail=f"LLM interpretation failed: {exc}") from exc


_INCIDENT_ASSIST_PROMPT = (
    "Tu es un assistant d'investigation pour les opérateurs d'une plateforme nationale d'interopérabilité (GISRE Maroc).\n"
    "Tu analyses un incident IA spécifique et aides l'opérateur à décider s'il est réel ou un faux positif.\n"
    "Tu bases ton analyse UNIQUEMENT sur les données fournies dans le message. Tu ne crées pas de données.\n"
    "Tu rédiges en français professionnel, concis et actionnable.\n"
    "Retourne UNIQUEMENT un objet JSON valide avec exactement cette structure :\n"
    "{\n"
    '  "diagnosis": "diagnostic opérationnel en 2-3 phrases",\n'
    '  "is_likely_real": true,\n'
    '  "confidence": "high",\n'
    '  "risk_assessment": "évaluation du risque opérationnel pour la plateforme",\n'
    '  "action_plan": ["action prioritaire 1", "action 2", "action 3"],\n'
    '  "confidence_note": "note sur la fiabilité de l\'analyse"\n'
    "}"
)


@router.post("/results/{result_id}/interpret")
async def incident_interpret(result_id: str, request: Request) -> dict:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return {"configured": False, "message": "LLM assistance not configured — set OPENAI_API_KEY"}

    database = request.app.state.database
    row = database.fetch_one(
        """
        SELECT id::text, flow_code, detected_anomaly_type, risk_score, severity,
               confidence::float, explanation, recommendation, analysis_type,
               COALESCE(to_jsonb(results)->>'validation_status', 'unverified') AS validation_status,
               to_jsonb(results)->>'validation_comment' AS validation_comment,
               to_jsonb(results)->>'validated_by' AS validated_by,
               results.detected_at::text, results.metadata
        FROM ai_analysis_results AS results
        WHERE results.id = %s
        """,
        (result_id,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="AI result not found")

    metadata = row.get("metadata") or {}
    model_info = metadata.get("model") if isinstance(metadata, dict) else None

    user_content = (
        f"INCIDENT À ANALYSER :\n"
        f"Type d'anomalie : {row['detected_anomaly_type']}\n"
        f"Flux métier : {row['flow_code'] or 'non spécifié'}\n"
        f"Score de risque : {row['risk_score']}/100\n"
        f"Sévérité : {row['severity']}\n"
        f"Confiance du modèle : {row['confidence']}\n"
        f"Type d'analyse : {row['analysis_type']}\n"
        f"Détecté le : {row['detected_at']}\n\n"
        f"EXPLICATION DU MODÈLE IA :\n{row['explanation'] or 'Non disponible'}\n\n"
        f"RECOMMANDATION DU MODÈLE IA :\n{row['recommendation'] or 'Non disponible'}\n\n"
        f"STATUT DE VALIDATION ACTUEL : {row['validation_status']}\n"
    )
    if model_info and isinstance(model_info, dict):
        user_content += f"\nMODÈLE DE DÉTECTION : {json.dumps(model_info, ensure_ascii=False)}\n"
    user_content += (
        "\nAnalyse cet incident et fournis ton diagnostic operationnel. "
        "Retourne uniquement un objet JSON valide conforme au schema demande."
    )

    try:
        from openai import AsyncOpenAI  # noqa: PLC0415
        client = AsyncOpenAI(api_key=api_key)
        response = await client.responses.create(
            model="gpt-4o",
            instructions=_INCIDENT_ASSIST_PROMPT,
            input=user_content,
            text={"format": {"type": "json_object"}},
        )
        raw = (response.output_text or "").strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
        result = json.loads(raw)
        return {"configured": True, **result}
    except Exception as exc:
        logger.exception("OpenAI incident interpretation failed")
        raise HTTPException(status_code=500, detail=f"LLM assistance failed: {exc}") from exc


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


@router.get("/results")
def list_results(
    request: Request,
    limit: int = Query(default=100, ge=1, le=500),
    include_normal: bool = False,
) -> list[dict]:
    database = request.app.state.database
    anomaly_filter = "" if include_normal else """
        WHERE results.detected_anomaly_type IS NOT NULL
          AND results.detected_anomaly_type <> 'NORMAL'
          AND COALESCE(results.risk_score, 0) > 0
    """
    query = f"""
        SELECT
            results.id::text,
            results.source_event_id::text,
            results.source_event_type,
            results.flow_code,
            results.api_id::text,
            results.actor_id::text,
            results.detected_anomaly_type,
            results.risk_score,
            results.severity,
            results.confidence::float,
            results.explanation,
            results.recommendation,
            results.analysis_type,
            results.validation,
            COALESCE(results.validation_status, 'unverified') AS validation_status,
            results.validated_by,
            results.validated_at::text AS validated_at,
            results.validation_comment,
            results.validation_source,
            results.metadata,
            results.detected_at::text,
            results.created_at::text
        FROM ai_analysis_results AS results
        {anomaly_filter}
        ORDER BY results.detected_at DESC, results.created_at DESC
        LIMIT %s
    """
    try:
        return database.fetch_all(query, (limit,))
    except Exception as exc:
        logger.exception(
            "Failed to list AI results (limit=%s, include_normal=%s)",
            limit,
            include_normal,
        )
        raise HTTPException(
            status_code=500,
            detail=f"failed to list AI results: {exc}",
        ) from exc


@router.get("/results/critical")
def list_critical_results(request: Request, limit: int = Query(default=100, ge=1, le=500)) -> list[dict]:
    database = request.app.state.database
    return database.fetch_all(
        """
        SELECT
            results.id::text, results.source_event_id::text, results.source_event_type, results.flow_code,
            results.api_id::text, results.actor_id::text, results.detected_anomaly_type, results.risk_score,
            results.severity, results.confidence::float, results.explanation, results.recommendation,
            results.analysis_type, results.validation,
            COALESCE(results.validation_status, 'unverified') AS validation_status,
            results.validated_by,
            results.validated_at::text AS validated_at,
            results.validation_comment,
            results.validation_source,
            results.metadata, results.detected_at::text,
            results.created_at::text
        FROM ai_analysis_results AS results
        WHERE results.severity = 'critical'
          AND results.detected_anomaly_type IS NOT NULL
          AND results.detected_anomaly_type <> 'NORMAL'
          AND COALESCE(results.risk_score, 0) > 0
        ORDER BY results.detected_at DESC, results.risk_score DESC
        LIMIT %s
        """,
        (limit,),
    )


@router.patch("/results/{result_id}/validation")
def update_result_validation(result_id: str, request: Request, body: ValidationUpdateRequest) -> dict:
    status = body.validation_status.strip().lower()
    if status not in HUMAN_VALIDATION_STATUSES:
        raise HTTPException(status_code=400, detail=f"unsupported validation_status: {body.validation_status}")

    validated_at = datetime.now(timezone.utc)
    database = request.app.state.database
    row = database.fetch_one(
        """
        UPDATE ai_analysis_results
        SET
            validation_status = %s,
            validated_by = %s,
            validated_at = %s,
            validation_comment = %s,
            validation_source = 'human',
            validation = COALESCE(validation, '{}'::jsonb) || jsonb_build_object(
                'human_status', %s,
                'validated_by', %s,
                'validated_at', %s,
                'validation_comment', %s,
                'validation_source', 'human'
            )
        WHERE id = %s
        RETURNING
            id::text, source_event_id::text, source_event_type, flow_code,
            api_id::text, actor_id::text, detected_anomaly_type, risk_score,
            severity, confidence::float, explanation, recommendation,
            analysis_type, validation,
            COALESCE(validation_status, 'unverified') AS validation_status,
            validated_by, validated_at::text, validation_comment, validation_source,
            metadata, detected_at::text, created_at::text
        """,
        (
            status,
            body.validated_by,
            validated_at,
            body.validation_comment,
            status,
            body.validated_by,
            validated_at.isoformat(),
            body.validation_comment,
            result_id,
        ),
    )
    if not row:
        raise HTTPException(status_code=404, detail="AI result not found")
    try:
        agent = getattr(request.app.state.engine, "rl_decision_agent", None)
        if agent is not None:
            agent.learn_from_validation(result=row, final_validation_status=status)
    except Exception as exc:  # pragma: no cover - defensive runtime guard
        logger.warning("[RL] validation reward update failed result_id=%s error=%s", result_id, exc)
    cache = get_cache(request.app.state)
    if cache is not None:
        cache.delete_pattern("feedback_dataset_summary:*")
        cache.delete_pattern("model_metrics:*")
        cache.delete_pattern("historical:*")
    return row


@router.post("/results/demo-validations")
def generate_demo_validations(request: Request, body: DemoValidationSeedRequest) -> dict:
    limit = body.limit if body.limit in {20, 50, 100} else 20
    database = request.app.state.database
    ensure_demo_validation_source_allowed(database)
    candidates = database.fetch_all(
        """
        SELECT
            results.id::text, results.source_event_id::text, results.source_event_type, results.flow_code,
            results.api_id::text, results.actor_id::text, results.detected_anomaly_type, results.risk_score,
            results.severity, results.confidence::float, results.explanation, results.recommendation,
            results.analysis_type, results.validation,
            COALESCE(results.validation_status, 'unverified') AS validation_status,
            results.validated_by,
            results.validated_at::text AS validated_at,
            results.validation_comment,
            results.validation_source,
            results.metadata, results.detected_at::text, results.created_at::text
        FROM ai_analysis_results AS results
        WHERE COALESCE(results.validation_status, 'unverified')
              IN ('unverified', 'pending_review', 'partial')
          AND results.detected_anomaly_type IS NOT NULL
        ORDER BY results.detected_at DESC, results.created_at DESC
        LIMIT %s
        """,
        (limit,),
    )

    validated_at = datetime.now(timezone.utc)
    updated_rows: list[dict] = []
    status_counts: dict[str, int] = {}
    for index, candidate in enumerate(candidates):
        decision = demo_validation_decision(candidate, index)
        row = database.fetch_one(
            """
            UPDATE ai_analysis_results
            SET
                validation_status = %s,
                validated_by = 'demo_supervisor',
                validated_at = %s,
                validation_comment = %s,
                validation_source = 'demo_seed',
                validation = COALESCE(validation, '{}'::jsonb) || jsonb_build_object(
                    'human_status', %s,
                    'validated_by', 'demo_supervisor',
                    'validated_at', %s,
                    'validation_comment', %s,
                    'validation_source', 'demo_seed',
                    'demo_feedback', true
                )
            WHERE id = %s
            RETURNING
                id::text, source_event_id::text, source_event_type, flow_code,
                api_id::text, actor_id::text, detected_anomaly_type, risk_score,
                severity, confidence::float, explanation, recommendation,
                analysis_type, validation,
                COALESCE(validation_status, 'unverified') AS validation_status,
                validated_by, validated_at::text, validation_comment, validation_source,
                metadata, detected_at::text, created_at::text
            """,
            (
                decision["status"],
                validated_at,
                decision["comment"],
                decision["status"],
                validated_at.isoformat(),
                decision["comment"],
                candidate["id"],
            ),
        )
        if row:
            updated_rows.append(row)
            status_counts[row["validation_status"]] = status_counts.get(row["validation_status"], 0) + 1
            if settings.include_demo_feedback:
                try:
                    agent = getattr(request.app.state.engine, "rl_decision_agent", None)
                    if agent is not None:
                        agent.learn_from_validation(
                            result=row,
                            final_validation_status=row["validation_status"],
                        )
                except Exception as exc:  # pragma: no cover - defensive runtime guard
                    logger.warning("[RL] demo reward update failed result_id=%s error=%s", row["id"], exc)

    cache = get_cache(request.app.state)
    if cache is not None:
        cache.delete_pattern("feedback_dataset_summary:*")
        cache.delete_pattern("model_metrics:*")
        cache.delete_pattern("historical:*")
    return {
        "requested_limit": limit,
        "updated": len(updated_rows),
        "validation_source": "demo_seed",
        "validated_by": "demo_supervisor",
        "include_demo_feedback": settings.include_demo_feedback,
        "counts": status_counts,
        "results": updated_rows,
    }


def ensure_demo_validation_source_allowed(database) -> None:
    database.execute(
        """
        DO $$
        BEGIN
            ALTER TABLE ai_analysis_results
                DROP CONSTRAINT IF EXISTS ai_analysis_results_validation_source_check;

            ALTER TABLE ai_analysis_results
                ADD CONSTRAINT ai_analysis_results_validation_source_check
                CHECK (
                    validation_source IS NULL OR validation_source IN (
                        'simulator',
                        'human',
                        'rule_validation',
                        'model_validation',
                        'demo_seed'
                    )
                );
        END $$;
        """
    )


@router.get("/results/pending-review")
def pending_review_results(request: Request, limit: int = Query(default=100, ge=1, le=500)) -> list[dict]:
    database = request.app.state.database
    return database.fetch_all(
        """
        SELECT
            results.id::text, results.source_event_id::text, results.source_event_type, results.flow_code,
            results.api_id::text, results.actor_id::text, results.detected_anomaly_type, results.risk_score,
            results.severity, results.confidence::float, results.explanation, results.recommendation,
            results.analysis_type, results.validation,
            COALESCE(results.validation_status, 'unverified') AS validation_status,
            results.validated_by,
            results.validated_at::text AS validated_at,
            results.validation_comment,
            results.validation_source,
            results.metadata, results.detected_at::text, results.created_at::text
        FROM ai_analysis_results AS results
        WHERE results.detected_anomaly_type IS NOT NULL
          AND results.detected_anomaly_type <> 'NORMAL'
          AND COALESCE(results.risk_score, 0) > 0
          AND COALESCE(results.validation_status, 'unverified')
              IN ('unverified', 'pending_review', 'partial')
        ORDER BY results.detected_at DESC, results.created_at DESC
        LIMIT %s
        """,
        (limit,),
    )


@router.get("/results/validation-summary")
def validation_summary(request: Request) -> dict:
    database = request.app.state.database
    rows = database.fetch_all(
        """
        SELECT validation_status, COUNT(*)::int AS count
        FROM ai_analysis_results
        WHERE validation_status IS NOT NULL
          AND validation_status <> 'unverified'
        GROUP BY validation_status

        UNION ALL

        SELECT 'unverified' AS validation_status, COUNT(*)::int AS count
        FROM ai_analysis_results
        WHERE COALESCE(validation_status, 'unverified') = 'unverified'
          AND detected_anomaly_type IS NOT NULL
          AND detected_anomaly_type <> 'NORMAL'
          AND COALESCE(risk_score, 0) > 0
        """
    )
    summary = {status: 0 for status in VALIDATION_STATUSES}
    for row in rows:
        summary[str(row["validation_status"])] = int(row["count"])
    summary["pending_review_total"] = sum(summary[status] for status in PENDING_REVIEW_STATUSES)
    summary["reviewed"] = (
        summary["confirmed"]
        + summary["partial"]
        + summary["false_positive"]
        + summary["ignored"]
        + summary["resolved"]
        + summary["auto_confirmed"]
        + summary["auto_dismissed"]
    )
    return summary


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
        WHERE detected_anomaly_type IS NOT NULL
          AND detected_anomaly_type <> 'NORMAL'
          AND COALESCE(risk_score, 0) > 0
        """
    ) or {}
    by_type = database.fetch_all(
        """
        SELECT detected_anomaly_type, COUNT(*)::int AS count
        FROM ai_analysis_results
        WHERE detected_anomaly_type IS NOT NULL
          AND detected_anomaly_type <> 'NORMAL'
          AND COALESCE(risk_score, 0) > 0
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


def demo_validation_decision(row: dict, index: int = 0) -> dict:
    anomaly_type = str(row.get("detected_anomaly_type") or "NORMAL").upper()
    severity = str(row.get("severity") or "low").lower()
    risk_score = int(row.get("risk_score") or 0)

    if anomaly_type in {"NORMAL", "FLOW_NORMAL", "SUCCESS"} or (risk_score < 30 and severity == "low"):
        status = "auto_dismissed" if index % 2 == 0 else "false_positive"
        return {
            "status": status,
            "comment": "Demo feedback: low-risk or normal result treated as not requiring investigation.",
        }

    if anomaly_type in TECHNICAL_EVIDENT_ANOMALIES or risk_score >= 85 or severity == "critical":
        return {
            "status": "confirmed",
            "comment": "Demo feedback: obvious technical anomaly confirmed for demonstration.",
        }

    if anomaly_type in SECURITY_BEHAVIOR_ANOMALIES:
        status = "pending_review" if index % 2 == 0 else ("confirmed" if index % 3 == 0 else "false_positive")
        return {
            "status": status,
            "comment": "Demo feedback: security or behaviour anomaly requires cautious review.",
        }

    if risk_score >= 60 or severity == "high":
        return {
            "status": "confirmed",
            "comment": "Demo feedback: high-risk anomaly confirmed for demonstration.",
        }

    return {
        "status": "pending_review" if index % 2 == 0 else "false_positive",
        "comment": "Demo feedback: ambiguous medium-risk anomaly seeded for review workflow.",
    }
