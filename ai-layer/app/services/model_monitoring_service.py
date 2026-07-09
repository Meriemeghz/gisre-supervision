from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from psycopg2.extras import Json

from app.ai_models.factory import ModelFactory
from app.core.database import Database

logger = logging.getLogger(__name__)


EVENT_LEVEL_MODELS = {
    "event_rules_engine",
    "event_random_forest",
    "event_isolation_forest",
    "event_lof",
    "event_autoencoder_mlp",
}


class ModelMonitoringService:
    def __init__(self, database: Database, model_dir: str | Path = "/app/models") -> None:
        self.database = database
        self.model_dir = Path(model_dir)
        self.factory = ModelFactory(self.model_dir)

    def lifecycle_metadata(self, model_id: str) -> dict[str, Any]:
        recommendation = self.retraining_recommendation(model_id)
        last_job = self.last_completed_job(model_id)
        model = self.factory.create(model_id)
        version = str(last_job.get("model_version") if last_job else model.version)

        return {
            "model_id": model_id,
            "trained": bool(last_job) or model.is_trained or model_id == "event_rules_engine",
            "current_version": version,
            "last_trained_at": self._dt(last_job.get("completed_at")) if last_job else None,
            "freshness_score": recommendation["freshness_score"],
            "drift_score": recommendation["drift_score"],
            "retraining_recommended": recommendation["recommended"],
            "new_events_since_training": recommendation["new_events_since_training"],
            "days_since_last_training": recommendation["days_since_last_training"],
        }

    def retraining_recommendation(self, model_id: str) -> dict[str, Any]:
        last_job = self.last_completed_job(model_id)
        policy = self.policy(model_id)
        drift_score = self.drift_score(model_id, last_job)
        new_events = self.new_events_since_training(last_job)
        days_since = self.days_since_training(last_job)

        reasons: list[str] = []
        if new_events >= int(policy["min_new_events"]):
            reasons.append(f"{new_events} new events detected since last training")
        if drift_score >= float(policy["drift_threshold"]):
            reasons.append("Drift score above threshold")
        if days_since is None:
            reasons.append("Model has no completed training job")
        elif days_since >= int(policy["max_training_frequency_days"]):
            reasons.append(f"Model is older than {policy['max_training_frequency_days']} days")

        degradation = "low"
        if drift_score >= 0.45 or any("older" in reason for reason in reasons):
            degradation = "high"
        elif drift_score >= 0.25 or new_events >= int(policy["min_new_events"]):
            degradation = "medium"

        freshness_score = self.freshness_score(days_since, new_events, policy)

        return {
            "model_id": model_id,
            "recommended": bool(reasons) and model_id != "event_rules_engine",
            "reasons": reasons,
            "drift_score": round(drift_score, 4),
            "freshness_score": round(freshness_score, 4),
            "days_since_last_training": days_since,
            "new_events_since_training": new_events,
            "degradation_level": degradation,
            "policy": policy,
        }

    def create_training_job(self, model_id: str, request: dict[str, Any]) -> dict[str, Any]:
        job = self.database.fetch_one(
            """
            INSERT INTO model_training_jobs (
                model_id, model_version, analysis_level, status, training_mode,
                dataset_start, dataset_end, sample_size, triggered_by, recommendation_reason,
                training_metadata
            )
            VALUES (%s, %s, %s, 'pending', %s, %s, %s, %s, %s, %s, %s)
            RETURNING id::text, model_id, model_version, analysis_level, status,
                      training_mode, dataset_start::text, dataset_end::text,
                      sample_size, triggered_by, created_at::text
            """,
            (
                model_id,
                request.get("model_version"),
                request.get("analysis_level") or "event",
                request.get("training_mode") or "manual",
                request.get("dataset_start"),
                request.get("dataset_end"),
                request.get("sample_size") or 20000,
                request.get("triggered_by") or "supervisor",
                request.get("recommendation_reason"),
                Json(request.get("training_metadata") or {}),
            ),
        )
        assert job is not None
        return job

    def run_training_job(self, job_id: str) -> None:
        job = self.database.fetch_one("SELECT * FROM model_training_jobs WHERE id = %s", (job_id,))
        if not job:
            return

        model_id = str(job["model_id"])
        logger.info("[AI-MLOPS] training job started model=%s job=%s", model_id, job_id)
        self._mark_job_training(job_id)

        try:
            records = self._load_training_records(job)
            training_options = self._training_options(job)
            if training_options:
                records = [{**record, "_training_options": training_options} for record in records]
            model = self.factory.create(model_id)
            training = model.train(records)
            training_status = str(training.get("status") or "").lower()
            if training_status not in {"trained", "ready"}:
                detail = training.get("dependency") or training.get("required") or training.get("message") or training_status
                raise RuntimeError(f"Training did not complete for {model_id}: {detail}")
            evaluation = model.evaluate(records)
            version = self._next_version(model_id)
            metrics = self._metrics_from_training(training, evaluation)
            drift_score = self.drift_score(model_id, self.last_completed_job(model_id))
            metadata = {
                "training": training,
                "evaluation": evaluation,
                "records_loaded": len(records),
                "training_options": training_options,
                "model_metadata": model.get_metadata(),
            }

            self.database.execute(
                """
                UPDATE model_training_jobs
                SET status = 'completed',
                    completed_at = NOW(),
                    model_version = %s,
                    accuracy = %s,
                    precision_score = %s,
                    recall_score = %s,
                    f1_score = %s,
                    drift_score = %s,
                    training_metadata = %s
                WHERE id = %s
                """,
                (
                    version,
                    metrics.get("accuracy"),
                    metrics.get("precision"),
                    metrics.get("recall"),
                    metrics.get("f1_score"),
                    drift_score,
                    Json(metadata),
                    job_id,
                ),
            )
            logger.info("[AI-MLOPS] training job completed model=%s job=%s", model_id, job_id)
        except Exception as exc:  # noqa: BLE001 - job must fail safely and not affect inference.
            logger.exception("[AI-MLOPS] training job failed model=%s job=%s", model_id, job_id)
            self.database.execute(
                """
                UPDATE model_training_jobs
                SET status = 'failed',
                    completed_at = NOW(),
                    training_metadata = COALESCE(training_metadata, '{}'::jsonb) || %s::jsonb
                WHERE id = %s
                """,
                (Json({"error": str(exc)}), job_id),
            )

    def training_history(self, model_id: str, limit: int = 20) -> list[dict[str, Any]]:
        return self.database.fetch_all(
            """
            SELECT id::text, model_id, model_version, analysis_level, status, training_mode,
                   started_at::text, completed_at::text, dataset_start::text, dataset_end::text,
                   sample_size, accuracy, precision_score, recall_score, f1_score, drift_score,
                   triggered_by, recommendation_reason, training_metadata, created_at::text
            FROM model_training_jobs
            WHERE model_id = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (model_id, limit),
        )

    def policy(self, model_id: str) -> dict[str, Any]:
        row = self.database.fetch_one(
            """
            SELECT model_id, enabled, frequency, drift_threshold, min_new_events,
                   max_training_frequency_days, updated_at::text
            FROM model_retraining_policies
            WHERE model_id = %s
            """,
            (model_id,),
        )
        if row:
            return row
        return {
            "model_id": model_id,
            "enabled": False,
            "frequency": "monthly",
            "drift_threshold": 0.30,
            "min_new_events": 20000,
            "max_training_frequency_days": 14,
            "updated_at": None,
        }

    def drift_series(self, model_id: str) -> list[dict[str, Any]]:
        rows = self.database.fetch_all(
            """
            SELECT COALESCE(completed_at, created_at)::date::text AS date,
                   COALESCE(drift_score, 0)::float AS drift_score
            FROM model_training_jobs
            WHERE model_id = %s
            ORDER BY COALESCE(completed_at, created_at) DESC
            LIMIT 12
            """,
            (model_id,),
        )
        return list(reversed(rows))

    def last_completed_job(self, model_id: str) -> dict[str, Any] | None:
        return self.database.fetch_one(
            """
            SELECT *
            FROM model_training_jobs
            WHERE model_id = %s AND status = 'completed'
            ORDER BY completed_at DESC NULLS LAST, created_at DESC
            LIMIT 1
            """,
            (model_id,),
        )

    def new_events_since_training(self, last_job: dict[str, Any] | None) -> int:
        if not last_job or not last_job.get("completed_at"):
            row = self.database.fetch_one("SELECT COUNT(*)::int AS count FROM api_calls") or {"count": 0}
            return int(row["count"])

        row = self.database.fetch_one(
            "SELECT COUNT(*)::int AS count FROM api_calls WHERE called_at > %s",
            (last_job["completed_at"],),
        ) or {"count": 0}
        return int(row["count"])

    def days_since_training(self, last_job: dict[str, Any] | None) -> int | None:
        if not last_job or not last_job.get("completed_at"):
            return None
        completed_at = last_job["completed_at"]
        if isinstance(completed_at, str):
            completed_at = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
        return max(0, (datetime.now(timezone.utc) - completed_at).days)

    def freshness_score(self, days_since: int | None, new_events: int, policy: dict[str, Any]) -> float:
        if days_since is None:
            return 0.0
        max_days = max(1, int(policy["max_training_frequency_days"]))
        max_events = max(1, int(policy["min_new_events"]))
        age_penalty = min(1.0, days_since / max_days)
        event_penalty = min(1.0, new_events / max_events)
        return max(0.0, 1.0 - ((age_penalty * 0.55) + (event_penalty * 0.45)))

    def drift_score(self, model_id: str, last_job: dict[str, Any] | None) -> float:
        del model_id
        recent = self._feature_snapshot(timedelta(hours=6))
        baseline = self._baseline_snapshot(last_job)
        return self._snapshot_distance(recent, baseline)

    def _mark_job_training(self, job_id: str) -> None:
        self.database.execute(
            """
            UPDATE model_training_jobs
            SET status = 'training', started_at = NOW()
            WHERE id = %s AND status = 'pending'
            """,
            (job_id,),
        )

    def _load_training_records(self, job: dict[str, Any]) -> list[dict[str, Any]]:
        where = ["latency_ms IS NOT NULL"]
        params: list[Any] = []
        training_options = self._training_options(job)
        analysis_level = str(job.get("analysis_level") or "").lower()
        if analysis_level in {"event", "temporal", "flow", "graph", "actor", "platform"}:
            params.append(analysis_level)
            where.append("(is_anomaly = FALSE OR analysis_level IS NULL OR analysis_level = %s)")
        if job.get("dataset_start"):
            params.append(job["dataset_start"])
            where.append(f"called_at >= %s")
        if job.get("dataset_end"):
            params.append(job["dataset_end"])
            where.append(f"called_at <= %s")
        if training_options.get("flow_code"):
            params.append(str(training_options["flow_code"]))
            where.append("flow_code = %s")
        params.append(int(job.get("sample_size") or 20000))

        return self.database.fetch_all(
            f"""
            SELECT flow_id::text, flow_code, called_at::text,
                   latency_ms, status_code, success, error_type, is_sla_breach,
                   sla_latency_ms, api_criticality, producer_criticality,
                   consumer_criticality, flow_criticality, expected_calls_per_minute,
                   metadata, is_anomaly, anomaly_type
            FROM api_calls
            WHERE {' AND '.join(where)}
            ORDER BY called_at ASC
            LIMIT %s
            """,
            tuple(params),
        )

    @staticmethod
    def _training_options(job: dict[str, Any]) -> dict[str, Any]:
        metadata = job.get("training_metadata") or {}
        if not isinstance(metadata, dict):
            return {}
        options = metadata.get("training_options") or {}
        return options if isinstance(options, dict) else {}

    def _next_version(self, model_id: str) -> str:
        row = self.database.fetch_one(
            """
            SELECT COUNT(*)::int AS count
            FROM model_training_jobs
            WHERE model_id = %s AND status = 'completed'
            """,
            (model_id,),
        ) or {"count": 0}
        return f"v1.0.{int(row['count']) + 1}"

    @staticmethod
    def _metrics_from_training(training: dict[str, Any], evaluation: dict[str, Any]) -> dict[str, float | None]:
        training_metrics = training.get("metrics") or {}
        report_metrics = (training_metrics.get("classification_report") or {}).get("macro avg") or {}
        direct_precision = training_metrics.get("precision")
        direct_recall = training_metrics.get("recall")
        direct_f1 = training_metrics.get("f1_score")
        direct_accuracy = training_metrics.get("accuracy")
        return {
            "accuracy": direct_accuracy,
            "precision": report_metrics.get("precision") or direct_precision,
            "recall": report_metrics.get("recall") or direct_recall,
            "f1_score": report_metrics.get("f1-score") or direct_f1 or (evaluation.get("metrics") or {}).get("f1_score"),
        }

    def _feature_snapshot(self, window: timedelta) -> dict[str, Any]:
        row = self.database.fetch_one(
            """
            SELECT COALESCE(AVG(latency_ms / NULLIF(sla_latency_ms, 0)), 0)::float AS avg_latency_ratio,
                   COALESCE(AVG(CASE WHEN success = FALSE OR status_code >= 400 THEN 1 ELSE 0 END), 0)::float AS error_rate,
                   COALESCE(AVG(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END), 0)::float AS server_error_rate,
                   COUNT(*)::int AS sample_count
            FROM api_calls
            WHERE called_at >= NOW() - %s::interval
            """,
            (f"{int(window.total_seconds())} seconds",),
        ) or {}
        by_status = self.database.fetch_all(
            """
            SELECT COALESCE(status_code, 0)::text AS label, COUNT(*)::int AS count
            FROM api_calls
            WHERE called_at >= NOW() - %s::interval
            GROUP BY status_code
            """,
            (f"{int(window.total_seconds())} seconds",),
        )
        row["status_distribution"] = {item["label"]: item["count"] for item in by_status}
        return row

    def _baseline_snapshot(self, last_job: dict[str, Any] | None) -> dict[str, Any]:
        if not last_job or not last_job.get("dataset_start") or not last_job.get("dataset_end"):
            return self._feature_snapshot(timedelta(hours=24))
        row = self.database.fetch_one(
            """
            SELECT COALESCE(AVG(latency_ms / NULLIF(sla_latency_ms, 0)), 0)::float AS avg_latency_ratio,
                   COALESCE(AVG(CASE WHEN success = FALSE OR status_code >= 400 THEN 1 ELSE 0 END), 0)::float AS error_rate,
                   COALESCE(AVG(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END), 0)::float AS server_error_rate,
                   COUNT(*)::int AS sample_count
            FROM api_calls
            WHERE called_at BETWEEN %s AND %s
            """,
            (last_job["dataset_start"], last_job["dataset_end"]),
        ) or {}
        return row

    @staticmethod
    def _snapshot_distance(recent: dict[str, Any], baseline: dict[str, Any]) -> float:
        if not recent or not baseline:
            return 0.0
        distance = 0.0
        distance += abs(float(recent.get("avg_latency_ratio") or 0) - float(baseline.get("avg_latency_ratio") or 0)) * 0.35
        distance += abs(float(recent.get("error_rate") or 0) - float(baseline.get("error_rate") or 0)) * 1.4
        distance += abs(float(recent.get("server_error_rate") or 0) - float(baseline.get("server_error_rate") or 0)) * 1.2
        return min(1.0, distance)

    @staticmethod
    def _dt(value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value.isoformat()
        return str(value)
