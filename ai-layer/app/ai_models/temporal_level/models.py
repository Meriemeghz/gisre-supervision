from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from app.ai_models.base import BaseAIModel
from app.ai_models.simple_models import MockExperimentalModel

try:
    import numpy as np
except ModuleNotFoundError:  # pragma: no cover - available inside the ai-layer Docker image.
    np = None

try:
    from tensorflow.keras import Sequential
    from tensorflow.keras.layers import Dense, GRU, Input
    from tensorflow.keras.models import load_model
except ModuleNotFoundError:  # pragma: no cover - available inside the ai-layer Docker image.
    Sequential = None
    Dense = None
    GRU = None
    Input = None
    load_model = None


TEMPORAL_LEVEL_ANOMALIES = [
    "latency_drift",
    "gradual_performance_degradation",
    "sla_instability",
    "timeout_burst",
    "service_flapping",
    "intermittent_failure",
    "traffic_spike",
    "traffic_drop",
    "delayed_event_ingestion",
    "consumer_profile_drift",
]

GRU_SEQUENCE_LENGTH = 8
GRU_FEATURE_COUNT = 3


class TemporalRulesEngineModel(BaseAIModel):
    model_id = "temporal_rules_engine"
    model_name = "Temporal-Level Rules Engine"
    model_type = "rules"
    family = "temporal_level"
    status = "active"
    version = "1.0.0"
    objective = "Analyser les fenetres temporelles recentes pour detecter derives, bursts et instabilites."
    anomaly_types = TEMPORAL_LEVEL_ANOMALIES
    supported_analysis_levels = ["temporal"]
    is_mock = False

    def train(self, records: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        self.is_trained = True
        self.save()
        return {
            "model_id": self.model_id,
            "status": "ready",
            "sample_count": len(records or []),
            "training_required": False,
        }

    def predict(self, record: dict[str, Any]) -> dict[str, Any]:
        stats = record.get("temporal_stats") or {}
        detections = self.detect(record, stats)
        if detections:
            return detections[0]
        return self.default_prediction(
            record,
            anomaly_detected=False,
            anomaly_type="TEMPORAL_NORMAL",
            score=0.0,
            explanation="No temporal anomaly detected in the recent 15-minute window.",
        )

    def detect(self, event: dict[str, Any], stats: dict[str, Any]) -> list[dict[str, Any]]:
        detections: list[dict[str, Any]] = []

        current_count = int(stats.get("current_count") or 0)
        previous_count = int(stats.get("previous_count") or 0)
        latency_ratio = float(stats.get("latency_ratio") or 1)
        latency_slope = float(stats.get("latency_slope") or 0)
        current_error_rate = float(stats.get("current_error_rate") or 0)
        previous_error_rate = float(stats.get("previous_error_rate") or 0)
        current_sla_rate = float(stats.get("current_sla_rate") or 0)
        previous_sla_rate = float(stats.get("previous_sla_rate") or 0)
        timeout_count = int(stats.get("timeout_count") or 0)
        availability_transitions = int(stats.get("availability_transitions") or 0)
        sla_status_transitions = int(stats.get("sla_status_transitions") or 0)
        traffic_change_rate = float(stats.get("traffic_change_rate") or 0)
        current_ingestion_delay = float(stats.get("current_ingestion_delay_ms") or 0)
        previous_ingestion_delay = float(stats.get("previous_ingestion_delay_ms") or 0)
        ingestion_delay_slope = float(stats.get("ingestion_delay_slope") or 0)
        current_consumer_share = float(stats.get("current_consumer_share") or 0)
        previous_consumer_share = float(stats.get("previous_consumer_share") or 0)
        repeated_anomaly_count = int(stats.get("repeated_anomaly_count") or 0)

        if availability_transitions >= 4:
            detections.append(
                self._detection(
                    "service_flapping",
                    min(0.96, 0.78 + availability_transitions * 0.025),
                    "The service alternates repeatedly between available and unavailable states.",
                )
            )

        if timeout_count >= 3:
            detections.append(
                self._detection(
                    "timeout_burst",
                    min(0.95, 0.72 + timeout_count * 0.03),
                    "Multiple timeouts are concentrated in the 15-minute temporal window.",
                )
            )

        if sla_status_transitions >= 4 or (
            current_sla_rate >= 0.25
            and current_sla_rate > previous_sla_rate + 0.15
        ):
            detections.append(
                self._detection(
                    "sla_instability",
                    min(0.92, 0.72 + max(current_sla_rate, sla_status_transitions / 10)),
                    "SLA compliance alternates or degrades repeatedly across the temporal window.",
                )
            )

        if latency_ratio >= 1.6:
            detections.append(
                self._detection(
                    "gradual_performance_degradation",
                    min(0.95, 0.76 + (latency_ratio - 1.6) * 0.18),
                    "Average latency increases progressively across consecutive temporal intervals.",
                )
            )
        elif latency_ratio >= 1.3 or latency_slope >= 0.08:
            detections.append(
                self._detection(
                    "latency_drift",
                    min(0.92, 0.72 + max(0.0, latency_ratio - 1.3) * 0.25),
                    "Recent latency is drifting upward relative to the preceding interval.",
                )
            )

        if (
            current_error_rate >= 0.15
            and current_error_rate > previous_error_rate + 0.08
            and availability_transitions < 4
        ):
            detections.append(
                self._detection(
                    "intermittent_failure",
                    min(0.91, 0.7 + current_error_rate * 0.35),
                    "Irregular but repeated errors increase during the recent temporal interval.",
                )
            )

        if previous_count >= 3 and traffic_change_rate >= 0.8:
            detections.append(
                self._detection(
                    "traffic_spike",
                    min(0.9, 0.74 + traffic_change_rate * 0.08),
                    "The recent event volume is substantially above the preceding baseline.",
                )
            )

        if previous_count >= 6 and traffic_change_rate <= -0.55:
            detections.append(
                self._detection(
                    "traffic_drop",
                    min(0.9, 0.74 + abs(traffic_change_rate) * 0.08),
                    "The recent event volume falls substantially below the preceding baseline.",
                )
            )

        if (
            current_ingestion_delay >= 1000
            and current_ingestion_delay > max(1.0, previous_ingestion_delay) * 1.5
        ) or ingestion_delay_slope >= 0.08:
            detections.append(
                self._detection(
                    "delayed_event_ingestion",
                    min(0.92, 0.76 + current_ingestion_delay / 50000),
                    "Event ingestion delay is increasing across the temporal window.",
                )
            )

        if (
            abs(current_consumer_share - previous_consumer_share) >= 0.30
            and max(current_count, previous_count) >= 5
        ):
            detections.append(
                self._detection(
                    "consumer_profile_drift",
                    min(
                        0.9,
                        0.74 + abs(current_consumer_share - previous_consumer_share) * 0.25,
                    ),
                    "The dominant consumer traffic share changed materially across the window.",
                )
            )

        if repeated_anomaly_count >= 3 and not detections:
            detections.append(
                self._detection(
                    "intermittent_failure",
                    min(0.88, 0.7 + repeated_anomaly_count * 0.025),
                    "The same anomaly pattern repeats across the temporal window.",
                )
            )

        return sorted(detections, key=lambda item: item["risk_score"], reverse=True)

    @staticmethod
    def _event_hour(event: dict[str, Any]) -> int | None:
        value = event.get("called_at") or event.get("timestamp")
        if not value:
            return None
        if isinstance(value, datetime):
            return value.hour
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00")).hour
        except ValueError:
            return None

    def _detection(self, anomaly_type: str, confidence: float, explanation: str) -> dict[str, Any]:
        risk_score = self._temporal_risk_score(anomaly_type, confidence)
        return {
            "anomaly_detected": True,
            "anomaly_type": anomaly_type,
            "anomaly_score": round(confidence, 4),
            "risk_score": risk_score,
            "severity": self._severity(risk_score),
            "confidence": round(confidence, 4),
            "explanation": explanation,
            "recommendation": self._recommendation(anomaly_type.upper()),
            "model_id": self.model_id,
            "model_name": self.model_name,
        }

    @staticmethod
    def _temporal_risk_score(anomaly_type: str, confidence: float) -> int:
        base_scores = {
            "latency_drift": 68,
            "gradual_performance_degradation": 78,
            "sla_instability": 65,
            "timeout_burst": 82,
            "service_flapping": 85,
            "intermittent_failure": 68,
            "traffic_spike": 55,
            "traffic_drop": 50,
            "delayed_event_ingestion": 60,
            "consumer_profile_drift": 62,
        }
        base = base_scores.get(anomaly_type, 45)
        confidence_adjustment = round((confidence - 0.75) * 20)
        return max(0, min(100, base + confidence_adjustment))


class _TemporalExperimentalModel(MockExperimentalModel):
    family = "temporal_level"
    supported_analysis_levels = ["temporal"]
    status = "experimental"
    is_mock = True

    def train(self, records: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        return {
            "model_id": self.model_id,
            "status": self.status,
            "sample_count": len(records or []),
            "message": "Modele temporel reference pour architecture sequence-level; implementation avancee planifiee.",
        }


class TemporalGRUSequenceModel(BaseAIModel):
    model_id = "temporal_gru_sequence"
    model_name = "Temporal-Level GRU Sequence"
    model_type = "deep_learning"
    family = "temporal_level"
    status = "experimental"
    version = "0.2.0"
    objective = "Detecter les ecarts de sequence sur latence, erreurs et SLA."
    anomaly_types = ["DL_GRU_SEQUENCE", "LATENCY_DRIFT", "GRADUAL_PERFORMANCE_DEGRADATION"]
    supported_analysis_levels = ["temporal"]
    is_mock = False
    default_anomaly_type = "DL_GRU_SEQUENCE"

    def __init__(self, model_dir: str = "/app/models") -> None:
        super().__init__(model_dir)
        self.model: Any | None = None
        self.feature_mean: list[float] = [0.0] * GRU_FEATURE_COUNT
        self.feature_std: list[float] = [1.0] * GRU_FEATURE_COUNT
        self.error_threshold = 0.0
        self.training_sequence_count = 0
        self.sequence_length = GRU_SEQUENCE_LENGTH

    def train(self, records: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        rows = self._compatible_rows(records or [])
        options = self._training_options(rows)
        sequence_length = self._option_int(options, "sequence_length", GRU_SEQUENCE_LENGTH, minimum=3, maximum=30)
        epochs = self._option_int(options, "epochs", 12, minimum=1, maximum=80)
        batch_size = self._option_int(options, "batch_size", 16, minimum=4, maximum=256)
        min_sequences = self._option_int(options, "min_sequences", 40, minimum=10, maximum=5000)
        validation_split = self._option_float(options, "validation_split", 0.15, minimum=0.0, maximum=0.4)
        if np is None or Sequential is None or GRU is None or Dense is None or Input is None:
            return {
                "model_id": self.model_id,
                "status": "dependency_missing",
                "dependency": "tensorflow-cpu/numpy",
                "sample_count": len(rows),
            }

        sequences, targets = self._build_training_sequences(rows, sequence_length)
        if len(sequences) < min_sequences:
            return {
                "model_id": self.model_id,
                "status": "not_enough_sequences",
                "sample_count": len(rows),
                "sequence_count": len(sequences),
                "required": min_sequences,
            }

        self.feature_mean = np.mean(sequences.reshape(-1, GRU_FEATURE_COUNT), axis=0).tolist()
        self.feature_std = np.std(sequences.reshape(-1, GRU_FEATURE_COUNT), axis=0).tolist()
        self.feature_std = [value if value > 0.000001 else 1.0 for value in self.feature_std]
        x_train = self._normalize_array(sequences)
        y_train = np.array(targets, dtype=np.float32)

        self.model = Sequential(
            [
                Input(shape=(sequence_length, GRU_FEATURE_COUNT)),
                GRU(12),
                Dense(1),
            ]
        )
        self.model.compile(optimizer="adam", loss="mse")
        history = self.model.fit(
            x_train,
            y_train,
            epochs=epochs,
            batch_size=batch_size,
            validation_split=validation_split if len(sequences) >= 80 else 0.0,
            verbose=0,
        )

        predictions = self.model.predict(x_train, verbose=0).reshape(-1)
        errors = [abs(float(actual) - float(predicted)) for actual, predicted in zip(y_train, predictions)]
        self.error_threshold = self._percentile(errors, 0.95) * 1.35
        self.training_sequence_count = len(sequences)
        self.sequence_length = sequence_length
        self.is_trained = True
        self.save()

        final_loss = float(history.history.get("loss", [0.0])[-1])
        validation_history = history.history.get("val_loss") or []
        avg_error = sum(errors) / len(errors)
        return {
            "model_id": self.model_id,
            "status": "trained",
            "sample_count": len(rows),
            "sequence_count": len(sequences),
            "metrics": {
                "loss": round(final_loss, 6),
                "validation_loss": round(float(validation_history[-1]), 6) if validation_history else None,
                "prediction_error": round(avg_error, 6),
                "prediction_threshold": round(float(self.error_threshold), 6),
                "sequence_length": sequence_length,
                "epochs": epochs,
                "batch_size": batch_size,
                "validation_split": validation_split,
                "features": ["latency_ratio", "is_error", "is_sla_breach"],
            },
        }

    def predict(self, record: dict[str, Any]) -> dict[str, Any]:
        if self.model is None:
            self.load()

        if self.model is None or np is None:
            return self.default_prediction(
                record,
                anomaly_detected=False,
                anomaly_type="NORMAL",
                score=0.0,
                explanation="Temporal-Level GRU Sequence is not trained yet.",
            )

        sequence_rows = list(record.get("temporal_sequence") or [])
        if len(sequence_rows) < self.sequence_length:
            return self.default_prediction(
                record,
                anomaly_detected=False,
                anomaly_type="NORMAL",
                score=0.0,
                explanation="Sequence temporelle insuffisante pour appliquer le GRU.",
            )

        sequence = np.array([[self._feature_vector(row) for row in sequence_rows[-self.sequence_length:]]], dtype=np.float32)
        normalized_sequence = self._normalize_array(sequence)
        predicted_ratio = float(self.model.predict(normalized_sequence, verbose=0)[0][0])
        actual_ratio = self._latency_ratio(record)
        prediction_error = abs(actual_ratio - predicted_ratio)
        is_anomaly = self.error_threshold > 0 and prediction_error > self.error_threshold

        anomaly_type = "NORMAL"
        if is_anomaly:
            anomaly_type = "LATENCY_DRIFT" if actual_ratio > predicted_ratio else "DL_GRU_SEQUENCE"
            if actual_ratio >= predicted_ratio * 1.6:
                anomaly_type = "GRADUAL_PERFORMANCE_DEGRADATION"

        error_ratio = prediction_error / max(0.000001, self.error_threshold or 1.0)
        score = min(0.96, max(0.55, 0.58 + (error_ratio - 1) * 0.22)) if is_anomaly else 0.0
        prediction = self.default_prediction(
            record,
            anomaly_detected=is_anomaly,
            anomaly_type=anomaly_type,
            score=score,
            explanation=(
                f"{self.model_name} attendait un latency_ratio proche de {predicted_ratio:.2f}, "
                f"mais l'evenement courant vaut {actual_ratio:.2f}."
            ),
        )
        prediction["metadata"] = {
            "predicted_latency_ratio": round(predicted_ratio, 4),
            "actual_latency_ratio": round(actual_ratio, 4),
            "prediction_error": round(prediction_error, 4),
            "prediction_threshold": round(float(self.error_threshold), 4),
            "sequence_length": self.sequence_length,
        }
        return prediction

    def save(self) -> dict[str, Any]:
        if self.model is not None:
            self.model.save(self.model_dir / f"{self.model_id}.keras")
        metadata = {
            "feature_mean": self.feature_mean,
            "feature_std": self.feature_std,
            "error_threshold": self.error_threshold,
            "training_sequence_count": self.training_sequence_count,
            "sequence_length": self.sequence_length,
        }
        (self.model_dir / f"{self.model_id}.training.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        return super().save()

    def load(self) -> dict[str, Any]:
        model_path = self.model_dir / f"{self.model_id}.keras"
        metadata_path = self.model_dir / f"{self.model_id}.training.json"
        if model_path.exists() and load_model is not None:
            self.model = load_model(model_path)
            if metadata_path.exists():
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                self.feature_mean = list(metadata.get("feature_mean") or self.feature_mean)
                self.feature_std = list(metadata.get("feature_std") or self.feature_std)
                self.error_threshold = float(metadata.get("error_threshold") or 0.0)
                self.training_sequence_count = int(metadata.get("training_sequence_count") or 0)
                self.sequence_length = int(metadata.get("sequence_length") or GRU_SEQUENCE_LENGTH)
            self.is_trained = True
            return {"model_id": self.model_id, "loaded": True, "path": str(model_path)}
        return super().load()

    def _build_training_sequences(self, rows: list[dict[str, Any]], sequence_length: int) -> tuple[Any, Any]:
        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            flow_key = str(row.get("flow_id") or row.get("flow_code") or "unknown")
            grouped.setdefault(flow_key, []).append(row)

        sequences: list[list[list[float]]] = []
        targets: list[float] = []
        for flow_rows in grouped.values():
            ordered = sorted(flow_rows, key=self._timestamp_key)
            if len(ordered) <= sequence_length:
                continue
            for index in range(len(ordered) - sequence_length):
                window = ordered[index : index + sequence_length]
                target = ordered[index + sequence_length]
                sequences.append([self._feature_vector(item) for item in window])
                targets.append(self._latency_ratio(target))

        return np.array(sequences, dtype=np.float32), np.array(targets, dtype=np.float32)

    @staticmethod
    def _compatible_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [row for row in rows if not row.get("analysis_level") or str(row.get("analysis_level")).lower() == "temporal"]

    @staticmethod
    def _training_options(rows: list[dict[str, Any]]) -> dict[str, Any]:
        if not rows:
            return {}
        options = rows[0].get("_training_options")
        return options if isinstance(options, dict) else {}

    @staticmethod
    def _option_int(options: dict[str, Any], key: str, default: int, minimum: int, maximum: int) -> int:
        try:
            value = int(options.get(key, default))
        except (TypeError, ValueError):
            value = default
        return max(minimum, min(maximum, value))

    @staticmethod
    def _option_float(options: dict[str, Any], key: str, default: float, minimum: float, maximum: float) -> float:
        try:
            value = float(options.get(key, default))
        except (TypeError, ValueError):
            value = default
        return max(minimum, min(maximum, value))

    def _normalize_array(self, values: Any) -> Any:
        return (values - np.array(self.feature_mean, dtype=np.float32)) / np.array(self.feature_std, dtype=np.float32)

    @staticmethod
    def _feature_vector(row: dict[str, Any]) -> list[float]:
        status_code = int(row.get("status_code") or 200)
        success = bool(row.get("success", True))
        return [
            TemporalGRUSequenceModel._latency_ratio(row),
            1.0 if (not success or status_code >= 400) else 0.0,
            1.0 if row.get("is_sla_breach") else 0.0,
        ]

    @staticmethod
    def _latency_ratio(row: dict[str, Any]) -> float:
        latency_ms = float(row.get("latency_ms") or 0)
        sla_latency_ms = float(row.get("sla_latency_ms") or 300)
        if sla_latency_ms <= 0:
            return 0.0
        return latency_ms / sla_latency_ms

    @staticmethod
    def _timestamp_key(row: dict[str, Any]) -> datetime:
        value = row.get("called_at") or row.get("detected_at") or ""
        if isinstance(value, datetime):
            return value
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return datetime.min

    @staticmethod
    def _percentile(values: list[float], percentile: float) -> float:
        if not values:
            return 0.0
        ordered = sorted(values)
        index = int(round((len(ordered) - 1) * percentile))
        return float(ordered[min(len(ordered) - 1, max(0, index))])


class TemporalLSTMSequenceModel(_TemporalExperimentalModel):
    model_id = "temporal_lstm_sequence"
    model_name = "Temporal-Level LSTM Sequence"
    model_type = "deep_learning"
    version = "0.1.0"
    objective = "Detecter les derives longues et instabilites temporelles."
    anomaly_types = ["DL_LSTM_SEQUENCE", "SLA_INSTABILITY", "SERVICE_FLAPPING"]
    default_anomaly_type = "DL_LSTM_SEQUENCE"


class TemporalTranADModel(_TemporalExperimentalModel):
    model_id = "temporal_tranad"
    model_name = "Temporal-Level TranAD"
    model_type = "transformer"
    version = "0.1.0"
    objective = "Preparer la detection par attention temporelle multivariee."
    anomaly_types = ["TRANSFORMER_TRANAD_ANOMALY", "TRAFFIC_SPIKE", "TRAFFIC_DROP"]
    default_anomaly_type = "TRANSFORMER_TRANAD_ANOMALY"
