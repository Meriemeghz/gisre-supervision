from __future__ import annotations

from typing import Any

from app.core.database import Database


CRITICALITY_WEIGHTS = {
    "critical": 25,
    "high": 15,
    "medium": 5,
    "low": 0,
}


class PreprocessingService:
    def __init__(self, database: Database) -> None:
        self.database = database

    def preprocess(self, topic: str, event: dict[str, Any]) -> dict[str, Any]:
        context = self._load_context(event)

        latency_ms = self._to_int(event.get("latency_ms"))
        sla_latency_ms = self._to_int(event.get("sla_latency_ms") or context.get("sla_latency_ms"))
        expected_calls_per_minute = self._to_int(event.get("expected_calls_per_minute") or context.get("expected_calls_per_minute"))
        simulated_calls_per_minute = self._to_int(event.get("simulated_calls_per_minute"))
        status_code = self._to_int(event.get("status_code"))
        success = self._to_bool(event.get("success"), default=event.get("outcome") == "success")
        error_type = event.get("error_type")
        action = event.get("action")
        outcome = event.get("outcome")

        latency_ratio = None
        if latency_ms is not None and sla_latency_ms and sla_latency_ms > 0:
            latency_ratio = latency_ms / sla_latency_ms

        traffic_ratio = None
        if simulated_calls_per_minute is not None and expected_calls_per_minute and expected_calls_per_minute > 0:
            traffic_ratio = simulated_calls_per_minute / expected_calls_per_minute

        is_error = success is False or (status_code is not None and status_code >= 400) or outcome in {"failure", "denied", "timeout"}
        is_server_error = status_code is not None and status_code >= 500
        is_timeout = status_code == 504 or error_type == "timeout" or action == "timeout" or outcome == "timeout"
        is_security_failure = status_code == 403 or error_type == "access_denied" or outcome == "denied" or action == "access_denied"

        criticalities = [
            event.get("api_criticality") or context.get("api_criticality"),
            event.get("producer_criticality") or context.get("producer_criticality"),
            event.get("consumer_criticality") or context.get("consumer_criticality"),
            event.get("flow_criticality") or context.get("flow_criticality"),
        ]
        criticality_weight = max(CRITICALITY_WEIGHTS.get(value or "medium", 5) for value in criticalities)

        return {
            **event,
            **context,
            "flow_code": event.get("flow_code") or context.get("flow_code"),
            "api_code": event.get("api_code") or context.get("api_code"),
            "consumer_code": event.get("consumer_code") or context.get("consumer_code"),
            "producer_code": event.get("producer_code") or context.get("producer_code"),
            "program_code": event.get("program_code") or context.get("program_code"),
            "topic": topic,
            "latency_ms": latency_ms,
            "sla_latency_ms": sla_latency_ms,
            "expected_calls_per_minute": expected_calls_per_minute,
            "simulated_calls_per_minute": simulated_calls_per_minute,
            "status_code": status_code,
            "success": success,
            "error_type": error_type,
            "action": action,
            "outcome": outcome,
            "source_ip": event.get("source_ip"),
            "latency_ratio": latency_ratio,
            "traffic_ratio": traffic_ratio,
            "is_error": is_error,
            "is_server_error": is_server_error,
            "is_timeout": is_timeout,
            "is_security_failure": is_security_failure,
            "api_criticality": event.get("api_criticality") or context.get("api_criticality"),
            "consumer_criticality": event.get("consumer_criticality") or context.get("consumer_criticality"),
            "producer_criticality": event.get("producer_criticality") or context.get("producer_criticality"),
            "flow_criticality": event.get("flow_criticality") or context.get("flow_criticality"),
            "analysis_level": event.get("analysis_level"),
            "anomaly_family": event.get("anomaly_family"),
            "anomaly_scope": event.get("anomaly_scope"),
            "simulation_mode": event.get("simulation_mode"),
            "is_anomaly": self._to_bool(event.get("is_anomaly"), default=False),
            "criticality_weight": criticality_weight,
        }

    def _load_context(self, event: dict[str, Any]) -> dict[str, Any]:
        flow_id = event.get("flow_id")
        flow_code = event.get("flow_code")
        if not flow_id and not flow_code:
            return {}

        where_clause = "f.id = %s" if flow_id else "f.code = %s"
        value = flow_id or flow_code
        row = self.database.fetch_one(
            f"""
            SELECT
                f.id AS flow_id,
                f.code AS flow_code,
                f.sla_latency_ms AS flow_sla_latency_ms,
                f.expected_calls_per_minute,
                a.id AS api_id,
                a.code AS api_code,
                a.sla_latency_ms AS api_sla_latency_ms,
                a.criticality AS api_criticality,
                producer.id AS producer_actor_id,
                producer.code AS producer_code,
                producer.criticality AS producer_criticality,
                consumer.id AS consumer_actor_id,
                consumer.code AS consumer_code,
                consumer.criticality AS consumer_criticality,
                p.code AS program_code,
                p.criticality AS program_criticality
            FROM flows f
            JOIN apis a ON a.id = f.api_id
            JOIN actors producer ON producer.id = f.producer_actor_id
            JOIN actors consumer ON consumer.id = f.consumer_actor_id
            LEFT JOIN programs p ON p.id = consumer.program_id
            WHERE {where_clause}
            LIMIT 1
            """,
            (value,),
        )
        if not row:
            return {}

        return {
            "flow_id": str(row["flow_id"]),
            "flow_code": row["flow_code"],
            "api_id": str(row["api_id"]),
            "api_code": row["api_code"],
            "producer_actor_id": str(row["producer_actor_id"]),
            "producer_code": row["producer_code"],
            "consumer_actor_id": str(row["consumer_actor_id"]),
            "consumer_code": row["consumer_code"],
            "actor_id": event.get("actor_id") or str(row["consumer_actor_id"]),
            "program_code": row["program_code"],
            "sla_latency_ms": row["flow_sla_latency_ms"] or row["api_sla_latency_ms"],
            "expected_calls_per_minute": row["expected_calls_per_minute"],
            "api_criticality": row["api_criticality"],
            "producer_criticality": row["producer_criticality"],
            "consumer_criticality": row["consumer_criticality"],
            "flow_criticality": self._max_criticality([
                row["program_criticality"],
                row["api_criticality"],
                row["producer_criticality"],
                row["consumer_criticality"],
            ]),
        }

    @staticmethod
    def _max_criticality(values: list[Any]) -> str:
        rank = {"low": 0, "medium": 1, "high": 2, "critical": 3}
        clean = [str(value) for value in values if value]
        if not clean:
            return "medium"
        return max(clean, key=lambda value: rank.get(value, 1))

    @staticmethod
    def _to_int(value: Any) -> int | None:
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _to_bool(value: Any, default: bool = False) -> bool:
        if isinstance(value, bool):
            return value
        if value is None:
            return default
        if isinstance(value, str):
            return value.lower() in {"true", "1", "yes"}
        return bool(value)
