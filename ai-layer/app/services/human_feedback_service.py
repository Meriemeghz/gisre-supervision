from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

from app.ai_models.factory import ModelFactory

if TYPE_CHECKING:
    from app.core.database import Database


ANOMALY_LABEL_STATUSES = {
    "confirmed",
    "validated_true_positive",
    "auto_confirmed",
    "resolved",
}
NORMAL_LABEL_STATUSES = {
    "false_positive",
    "validated_false_positive",
    "auto_dismissed",
}
EXCLUDED_STATUSES = {
    "pending_review",
    "needs_investigation",
    "unverified",
    "partial",
    "ignored",
}

MINIMUM_FEEDBACK_SAMPLES = {
    "supervised": 100,
    "unsupervised": 100,
    "deep_learning": 200,
    "transformer": 250,
    "graph_ai": 250,
}


class HumanFeedbackService:
    """Project validated AI results into a labeled dataset without retraining."""

    def __init__(
        self,
        database: Database,
        model_factory: ModelFactory | None = None,
    ) -> None:
        self.database = database
        self.model_factory = model_factory or ModelFactory()

    @staticmethod
    def human_label(validation_status: str | None) -> str | None:
        status = str(validation_status or "unverified").strip().lower()
        if status in ANOMALY_LABEL_STATUSES:
            return "anomaly"
        if status in NORMAL_LABEL_STATUSES:
            return "normal"
        return None

    def dataset(
        self,
        *,
        model_id: str | None = None,
        analysis_level: str | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        include_excluded: bool = False,
    ) -> list[dict[str, Any]]:
        rows = self._load_rows(
            model_id=model_id,
            analysis_level=analysis_level,
            start_date=start_date,
            end_date=end_date,
        )
        records = [self._record(row) for row in rows]
        if include_excluded:
            return records
        return [record for record in records if record["human_label"] is not None]

    def summary(
        self,
        *,
        model_id: str | None = None,
        analysis_level: str | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
    ) -> dict[str, Any]:
        where, params, model_expression, level_expression = self._summary_filters(
            model_id=model_id,
            analysis_level=analysis_level,
            start_date=start_date,
            end_date=end_date,
        )
        anomaly_statuses = sorted(ANOMALY_LABEL_STATUSES)
        normal_statuses = sorted(NORMAL_LABEL_STATUSES)
        usable_statuses = sorted(ANOMALY_LABEL_STATUSES | NORMAL_LABEL_STATUSES)

        totals = self.database.fetch_one(
            f"""
            SELECT
                COUNT(*)::int AS total_validated,
                COUNT(*) FILTER (
                    WHERE COALESCE(results.validation_status, 'unverified') = ANY(%s)
                )::int AS confirmed_anomalies,
                COUNT(*) FILTER (
                    WHERE COALESCE(results.validation_status, 'unverified') = ANY(%s)
                )::int AS false_positives
            FROM ai_analysis_results AS results
            WHERE {' AND '.join(where)}
            """,
            tuple([anomaly_statuses, normal_statuses, *params]),
        ) or {}

        by_model_rows = self.database.fetch_all(
            f"""
            SELECT
                {model_expression} AS model_id,
                {level_expression} AS analysis_level,
                COUNT(*)::int AS usable_samples,
                COUNT(*) FILTER (
                    WHERE COALESCE(results.validation_status, 'unverified') = ANY(%s)
                )::int AS anomaly_labels,
                COUNT(*) FILTER (
                    WHERE COALESCE(results.validation_status, 'unverified') = ANY(%s)
                )::int AS normal_labels
            FROM ai_analysis_results AS results
            WHERE {' AND '.join(where)}
              AND COALESCE(results.validation_status, 'unverified') = ANY(%s)
            GROUP BY 1, 2
            ORDER BY usable_samples DESC
            """,
            tuple([anomaly_statuses, normal_statuses, *params, usable_statuses]),
        )

        by_anomaly_rows = self.database.fetch_all(
            f"""
            SELECT
                COALESCE(results.detected_anomaly_type, 'UNKNOWN') AS anomaly_type,
                COUNT(*)::int AS count
            FROM ai_analysis_results AS results
            WHERE {' AND '.join(where)}
              AND COALESCE(results.validation_status, 'unverified') = ANY(%s)
            GROUP BY 1
            ORDER BY count DESC
            """,
            tuple([*params, usable_statuses]),
        )

        total_validated = int(totals.get("total_validated") or 0)
        confirmed_anomalies = int(totals.get("confirmed_anomalies") or 0)
        false_positives = int(totals.get("false_positives") or 0)
        usable_for_training = confirmed_anomalies + false_positives

        return {
            "total_validated": total_validated,
            "usable_for_training": usable_for_training,
            "confirmed_anomalies": confirmed_anomalies,
            "false_positives": false_positives,
            "excluded_pending": max(0, total_validated - usable_for_training),
            "label_distribution": {
                "anomaly": confirmed_anomalies,
                "normal": false_positives,
            },
            "by_model": [
                {
                    "model_id": str(row.get("model_id") or "unknown"),
                    "analysis_level": str(row.get("analysis_level") or "unknown"),
                    "usable_samples": int(row.get("usable_samples") or 0),
                    "anomaly_labels": int(row.get("anomaly_labels") or 0),
                    "normal_labels": int(row.get("normal_labels") or 0),
                    "validation_acceptance_rate": round(
                        int(row.get("anomaly_labels") or 0)
                        / int(row.get("usable_samples") or 1),
                        4,
                    ),
                }
                for row in by_model_rows
            ],
            "by_anomaly_type": [
                {
                    "anomaly_type": str(row.get("anomaly_type") or "UNKNOWN"),
                    "count": int(row.get("count") or 0),
                }
                for row in by_anomaly_rows
            ],
        }

    def training_readiness(self, model_id: str) -> dict[str, Any]:
        try:
            model = self.model_factory.create(model_id)
        except KeyError:
            return {
                "model_id": model_id,
                "ready": False,
                "trainable": False,
                "usable_samples": 0,
                "min_required_samples": 0,
                "label_distribution": {"anomaly": 0, "normal": 0},
                "warnings": ["Unknown AI model"],
                "message": "Model is not registered.",
            }

        summary = self.summary(model_id=model_id)
        distribution = summary["label_distribution"]
        model_type = str(model.model_type or "").lower()
        minimum = MINIMUM_FEEDBACK_SAMPLES.get(model_type, 100)

        if model_type == "rules":
            return {
                "model_id": model_id,
                "ready": False,
                "trainable": False,
                "usable_samples": summary["usable_for_training"],
                "min_required_samples": 0,
                "label_distribution": distribution,
                "warnings": [],
                "message": "Feedback can be used for rule calibration, not model training.",
            }

        if model.is_mock:
            return {
                "model_id": model_id,
                "ready": False,
                "trainable": False,
                "usable_samples": summary["usable_for_training"],
                "min_required_samples": minimum,
                "label_distribution": distribution,
                "warnings": ["The selected model is a placeholder and cannot be trained."],
                "message": "Feedback training is unavailable for this placeholder model.",
            }

        warnings: list[str] = []
        if summary["usable_for_training"] < minimum:
            warnings.append(
                f"At least {minimum} usable validated samples are required."
            )
        if distribution["anomaly"] == 0 or distribution["normal"] == 0:
            warnings.append("Both anomaly and normal labels are required.")
        elif min(distribution.values()) / max(1, sum(distribution.values())) < 0.15:
            warnings.append("Label distribution is strongly imbalanced.")

        ready = (
            summary["usable_for_training"] >= minimum
            and distribution["anomaly"] > 0
            and distribution["normal"] > 0
        )
        return {
            "model_id": model_id,
            "ready": ready,
            "trainable": True,
            "usable_samples": summary["usable_for_training"],
            "min_required_samples": minimum,
            "label_distribution": distribution,
            "warnings": warnings,
            "message": (
                "Validated feedback is ready for a future manual training job."
                if ready
                else "More or better-balanced human feedback is required."
            ),
        }

    def _load_rows(
        self,
        *,
        model_id: str | None,
        analysis_level: str | None,
        start_date: datetime | None,
        end_date: datetime | None,
    ) -> list[dict[str, Any]]:
        where = [
            "COALESCE(results.validation_status, 'unverified') = ANY(%s)",
        ]
        params: list[Any] = [
            sorted(
                ANOMALY_LABEL_STATUSES
                | NORMAL_LABEL_STATUSES
                | EXCLUDED_STATUSES
            )
        ]
        model_expression = """
            COALESCE(
                results.metadata->>'model_id',
                results.metadata->'model'->>'id',
                results.metadata->>'selected_model_id',
                results.metadata->'analysis_trace'->'event'->>'selected_model_id',
                results.metadata->'analysis_trace'->'flow'->>'selected_model_id',
                results.metadata->'analysis_trace'->'temporal'->>'selected_model_id',
                results.metadata->'analysis_trace'->'graph'->>'selected_model_id',
                'unknown'
            )
        """
        level_expression = """
            COALESCE(
                results.metadata->>'analysis_level',
                to_jsonb(results)->>'analysis_level',
                'event'
            )
        """

        if model_id:
            where.append(f"{model_expression} = %s")
            params.append(model_id)
        if analysis_level:
            where.append(f"{level_expression} = %s")
            params.append(analysis_level)
        if start_date:
            where.append("COALESCE(results.validated_at, results.detected_at) >= %s")
            params.append(start_date)
        if end_date:
            where.append("COALESCE(results.validated_at, results.detected_at) <= %s")
            params.append(end_date)

        return self.database.fetch_all(
            f"""
            SELECT
                results.id::text AS result_id,
                {model_expression} AS model_id,
                {level_expression} AS analysis_level,
                results.detected_anomaly_type AS anomaly_type,
                results.risk_score,
                results.confidence::float AS confidence,
                COALESCE(results.validation_status, 'unverified') AS validation_status,
                results.validated_at::text AS validated_at,
                results.validation_comment,
                results.validation_source,
                results.metadata,
                calls.status_code,
                calls.latency_ms,
                calls.is_sla_breach,
                calls.flow_code,
                calls.api_code,
                calls.consumer_code,
                calls.producer_code
            FROM ai_analysis_results AS results
            LEFT JOIN api_calls AS calls
              ON calls.id = results.source_event_id
            WHERE {' AND '.join(where)}
            ORDER BY COALESCE(results.validated_at, results.detected_at) DESC
            """,
            tuple(params),
        )

    def _summary_filters(
        self,
        *,
        model_id: str | None,
        analysis_level: str | None,
        start_date: datetime | None,
        end_date: datetime | None,
    ) -> tuple[list[str], list[Any], str, str]:
        all_statuses = sorted(
            ANOMALY_LABEL_STATUSES | NORMAL_LABEL_STATUSES | EXCLUDED_STATUSES
        )
        where = [
            "COALESCE(results.validation_status, 'unverified') = ANY(%s)",
        ]
        params: list[Any] = [all_statuses]
        model_expression = """
            COALESCE(
                results.metadata->>'model_id',
                results.metadata->'model'->>'id',
                results.metadata->>'selected_model_id',
                results.metadata->'analysis_trace'->'event'->>'selected_model_id',
                results.metadata->'analysis_trace'->'flow'->>'selected_model_id',
                results.metadata->'analysis_trace'->'temporal'->>'selected_model_id',
                results.metadata->'analysis_trace'->'graph'->>'selected_model_id',
                'unknown'
            )
        """
        level_expression = """
            COALESCE(
                results.metadata->>'analysis_level',
                to_jsonb(results)->>'analysis_level',
                'event'
            )
        """

        if model_id:
            where.append(f"{model_expression} = %s")
            params.append(model_id)
        if analysis_level:
            where.append(f"{level_expression} = %s")
            params.append(analysis_level)
        if start_date:
            where.append("COALESCE(results.validated_at, results.detected_at) >= %s")
            params.append(start_date)
        if end_date:
            where.append("COALESCE(results.validated_at, results.detected_at) <= %s")
            params.append(end_date)
        return where, params, model_expression, level_expression

    def _record(self, row: dict[str, Any]) -> dict[str, Any]:
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        status_code = row.get("status_code")
        latency_ms = row.get("latency_ms")
        sla_breach = row.get("is_sla_breach")
        return {
            "result_id": str(row.get("result_id") or ""),
            "model_id": str(row.get("model_id") or "unknown"),
            "analysis_level": str(row.get("analysis_level") or "unknown"),
            "features": {
                "status_code": status_code,
                "latency_ms": latency_ms,
                "sla_breach": sla_breach,
                "risk_score": int(row.get("risk_score") or 0),
                "confidence": (
                    float(row["confidence"])
                    if row.get("confidence") is not None
                    else None
                ),
                "flow_code": row.get("flow_code") or metadata.get("flow_code"),
                "api_code": row.get("api_code") or metadata.get("api_code"),
                "consumer_code": row.get("consumer_code")
                or metadata.get("consumer_code"),
                "producer_code": row.get("producer_code")
                or metadata.get("producer_code"),
            },
            "model_prediction": (
                "normal"
                if str(row.get("anomaly_type") or "NORMAL")
                in {"NORMAL", "FLOW_NORMAL", "TEMPORAL_NORMAL"}
                else "anomaly"
            ),
            "anomaly_type": str(row.get("anomaly_type") or "NORMAL"),
            "human_label": self.human_label(row.get("validation_status")),
            "validation_status": str(
                row.get("validation_status") or "unverified"
            ),
            "validated_at": row.get("validated_at"),
            "validation_comment": row.get("validation_comment"),
            "validation_source": row.get("validation_source"),
        }
