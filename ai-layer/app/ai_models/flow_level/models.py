from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime
from typing import Any

from app.ai_models.base import BaseAIModel

try:
    from sklearn.cluster import KMeans
    from sklearn.neural_network import MLPRegressor
    from sklearn.metrics import silhouette_score
    from sklearn.preprocessing import StandardScaler
except ModuleNotFoundError:  # pragma: no cover - available inside the ai-layer Docker image.
    KMeans = None
    MLPRegressor = None
    StandardScaler = None
    silhouette_score = None

try:
    import joblib
except ModuleNotFoundError:  # pragma: no cover
    joblib = None

try:
    import numpy as np
except ModuleNotFoundError:  # pragma: no cover
    np = None

try:
    from tensorflow.keras import Sequential
    from tensorflow.keras.layers import Dense, GRU, Input
    from tensorflow.keras.models import load_model
except ModuleNotFoundError:  # pragma: no cover
    Sequential = None
    Dense = None
    GRU = None
    Input = None
    load_model = None


FLOW_LEVEL_ANOMALIES = [
    "FLOW_NORMAL",
    "FLOW_SLA_DEGRADATION",
    "FLOW_LATENCY_DRIFT",
    "FLOW_ERROR_RATE_SPIKE",
    "FLOW_TRAFFIC_DROP",
    "FLOW_TRAFFIC_SPIKE",
    "FLOW_INTERMITTENT_FAILURES",
    "FLOW_PROVIDER_DEGRADATION",
    "FLOW_CONSUMER_ABUSE",
    "FLOW_HEALTH_DEGRADATION",
]


class FlowRulesEngineModel(BaseAIModel):
    model_id = "flow_rules_engine"
    model_name = "Flow-Level Rules Engine"
    model_type = "rules"
    family = "flow_level"
    status = "active"
    version = "1.0.0"
    objective = "Analyser la stabilite et la performance globale d'un flow consumer -> API -> producer."
    anomaly_types = FLOW_LEVEL_ANOMALIES
    supported_analysis_levels = ["flow"]
    is_mock = False

    def train(self, records: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        self.is_trained = True
        self.save()
        return {"model_id": self.model_id, "status": "ready", "training_required": False, "sample_count": len(records or [])}

    def predict(self, record: dict[str, Any]) -> dict[str, Any]:
        detections = self.detect(record, record.get("flow_stats") or {})
        if detections:
            return detections[0]
        return {
            "anomaly_detected": False,
            "anomaly_type": "FLOW_NORMAL",
            "anomaly_score": 0.0,
            "risk_score": 0,
            "severity": "low",
            "confidence": 1.0,
            "explanation": "No anomaly detected at flow level",
            "recommendation": "No action required",
            "model_id": self.model_id,
            "model_name": self.model_name,
        }

    def detect(self, event: dict[str, Any], stats: dict[str, Any]) -> list[dict[str, Any]]:
        total_calls = int(stats.get("total_calls") or 0)
        error_rate = float(stats.get("error_rate") or 0)
        sla_breach_rate = float(stats.get("sla_breach_rate") or 0)
        avg_latency_ms = float(stats.get("avg_latency_ms") or 0)
        p95_latency_ms = float(stats.get("p95_latency_ms") or 0)
        sla_latency_ms = float(event.get("sla_latency_ms") or 0)
        traffic_change_rate = float(stats.get("traffic_change_rate") or 0)
        latency_trend = str(stats.get("latency_trend") or "stable")
        timeout_count = int(stats.get("timeout_count") or 0)
        server_error_count = int(stats.get("server_error_count") or 0)
        consumer_traffic_share = float(stats.get("consumer_traffic_share") or 0)
        producer_criticality = str(event.get("producer_criticality") or "medium")

        latency_degraded = bool(
            latency_trend == "increasing"
            or (sla_latency_ms > 0 and avg_latency_ms >= sla_latency_ms * 1.25)
            or (sla_latency_ms > 0 and p95_latency_ms >= sla_latency_ms * 1.75)
        )
        degraded_signals = sum(
            (
                sla_breach_rate >= 0.30,
                error_rate >= 0.20,
                latency_degraded,
                abs(traffic_change_rate) >= 0.50,
                timeout_count >= 3,
                server_error_count >= 3,
            )
        )

        if degraded_signals >= 3:
            return [
                self._detection(
                    "FLOW_HEALTH_DEGRADATION",
                    0.90,
                    "Multiple flow health indicators are degraded in the current window.",
                )
            ]
        if producer_criticality in {"high", "critical"} and server_error_count >= 3:
            return [
                self._detection(
                    "FLOW_PROVIDER_DEGRADATION",
                    0.88,
                    "Frequent server errors affect a flow backed by a critical producer.",
                )
            ]
        if consumer_traffic_share >= 0.70 and total_calls >= 10:
            return [
                self._detection(
                    "FLOW_CONSUMER_ABUSE",
                    0.84,
                    "One consumer represents an excessive share of the recent flow traffic.",
                )
            ]
        if sla_breach_rate >= 0.30:
            return [
                self._detection(
                    "FLOW_SLA_DEGRADATION",
                    min(0.96, 0.76 + sla_breach_rate * 0.30),
                    "The flow exceeds its SLA on a significant share of recent calls.",
                )
            ]
        if latency_degraded:
            return [
                self._detection(
                    "FLOW_LATENCY_DRIFT",
                    0.86,
                    "Recent latency is increasing or materially above the configured SLA.",
                )
            ]
        if error_rate >= 0.20:
            return [
                self._detection(
                    "FLOW_ERROR_RATE_SPIKE",
                    min(0.95, 0.74 + error_rate * 0.40),
                    "The recent flow error rate exceeds the operational threshold.",
                )
            ]
        if timeout_count >= 3 or (int(stats.get("error_count") or 0) >= 3 and error_rate < 0.20):
            return [
                self._detection(
                    "FLOW_INTERMITTENT_FAILURES",
                    0.82,
                    "Repeated but dispersed failures indicate intermittent flow instability.",
                )
            ]
        if traffic_change_rate <= -0.50:
            return [
                self._detection(
                    "FLOW_TRAFFIC_DROP",
                    0.80,
                    "The flow traffic dropped sharply compared with the previous window.",
                )
            ]
        if traffic_change_rate >= 1.00:
            return [
                self._detection(
                    "FLOW_TRAFFIC_SPIKE",
                    0.82,
                    "The flow traffic increased sharply compared with the previous window.",
                )
            ]
        return []

    def _detection(self, anomaly_type: str, confidence: float, explanation: str) -> dict[str, Any]:
        return {
            "anomaly_detected": True,
            "anomaly_type": anomaly_type,
            "anomaly_score": round(confidence, 4),
            "risk_score": self._risk_score(confidence),
            "severity": self._severity(self._risk_score(confidence)),
            "confidence": round(confidence, 4),
            "explanation": explanation,
            "recommendation": self._recommendation(anomaly_type),
            "model_id": self.model_id,
            "model_name": self.model_name,
        }

    @staticmethod
    def _deduplicate(detections: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[str] = set()
        unique: list[dict[str, Any]] = []
        for item in detections:
            anomaly_type = item["anomaly_type"]
            if anomaly_type not in seen:
                seen.add(anomaly_type)
                unique.append(item)
        return unique


class FlowKMeansProfileModel(BaseAIModel):
    model_id = "flow_kmeans_profile"
    model_name = "Flow-Level K-Means Profile"
    model_type = "unsupervised"
    family = "flow_level"
    status = "experimental"
    version = "0.1.0"
    objective = "Apprendre des profils de flow et detecter les flows eloignes des clusters normaux."
    anomaly_types = ["ML_FLOW_CLUSTER_OUTLIER", "UNEXPECTED_VOLUME", "SLOW_API_ENDPOINT", "HIGH_ERROR_RATE"]
    supported_analysis_levels = ["flow"]
    is_mock = False

    def __init__(self, model_dir: str = "/app/models") -> None:
        super().__init__(model_dir)
        self.model: Any | None = None
        self.scaler: Any | None = None
        self.distance_threshold = 0.0
        self.cluster_count = 0

    def train(self, records: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        rows = records or []
        profiles = self._profiles_from_records(rows)
        if KMeans is None or StandardScaler is None or joblib is None:
            return {"model_id": self.model_id, "status": "dependency_missing", "dependency": "scikit-learn/joblib", "sample_count": len(rows)}
        if len(profiles) < 4:
            return {"model_id": self.model_id, "status": "not_enough_flows", "sample_count": len(rows), "flow_profile_count": len(profiles), "required": 4}

        features = [profile["features"] for profile in profiles]
        self.scaler = StandardScaler()
        scaled = self.scaler.fit_transform(features)
        self.cluster_count = max(2, min(6, int(len(profiles) ** 0.5)))
        self.model = KMeans(n_clusters=self.cluster_count, n_init=10, random_state=42)
        self.model.fit(scaled)
        distances = [self._distance(sample, self.model.cluster_centers_[int(label)]) for sample, label in zip(scaled, self.model.labels_)]
        self.distance_threshold = self._percentile(distances, 0.95) * 1.25
        self.is_trained = True
        self.save()

        metrics = {
            "flow_profile_count": len(profiles),
            "cluster_count": self.cluster_count,
            "distance_threshold": round(float(self.distance_threshold), 6),
            "silhouette_score": round(float(silhouette_score(scaled, self.model.labels_)), 4) if silhouette_score and len(set(self.model.labels_)) > 1 else None,
        }
        return {"model_id": self.model_id, "status": "trained", "sample_count": len(rows), "metrics": metrics}

    def predict(self, record: dict[str, Any]) -> dict[str, Any]:
        if self.model is None:
            self.load()
        if self.model is None or self.scaler is None:
            return self.default_prediction(record, False, "NORMAL", 0.0, "Flow K-Means Profile is not trained yet.")

        profile = record.get("flow_profile") or record.get("flow_stats") or record
        features = [self._feature_vector(profile)]
        scaled = self.scaler.transform(features)
        cluster = int(self.model.predict(scaled)[0])
        distance = self._distance(scaled[0], self.model.cluster_centers_[cluster])
        is_anomaly = self.distance_threshold > 0 and distance > self.distance_threshold
        ratio = distance / max(0.000001, self.distance_threshold or 1.0)
        score = min(0.95, max(0.55, 0.58 + (ratio - 1) * 0.2)) if is_anomaly else 0.0
        prediction = self.default_prediction(
            record,
            is_anomaly,
            "ML_FLOW_CLUSTER_OUTLIER" if is_anomaly else "NORMAL",
            score,
            f"{self.model_name} mesure une distance au cluster de {distance:.3f}.",
        )
        prediction["metadata"] = {
            "assigned_cluster": cluster,
            "distance_to_center": round(float(distance), 4),
            "distance_threshold": round(float(self.distance_threshold), 4),
            "distance_ratio": round(float(ratio), 4),
        }
        return prediction

    def save(self) -> dict[str, Any]:
        if self.model is not None and joblib is not None:
            joblib.dump(
                {
                    "model": self.model,
                    "scaler": self.scaler,
                    "distance_threshold": self.distance_threshold,
                    "cluster_count": self.cluster_count,
                    "metadata": self.get_metadata(),
                },
                self.model_dir / f"{self.model_id}.joblib",
            )
        return super().save()

    def load(self) -> dict[str, Any]:
        path = self.model_dir / f"{self.model_id}.joblib"
        if path.exists() and joblib is not None:
            payload = joblib.load(path)
            self.model = payload.get("model")
            self.scaler = payload.get("scaler")
            self.distance_threshold = float(payload.get("distance_threshold") or 0.0)
            self.cluster_count = int(payload.get("cluster_count") or 0)
            self.is_trained = self.model is not None
            return {"model_id": self.model_id, "loaded": self.is_trained, "path": str(path)}
        return super().load()

    @classmethod
    def _profiles_from_records(cls, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in cls._compatible_rows(rows):
            flow_key = str(row.get("flow_id") or row.get("flow_code") or "unknown")
            grouped[flow_key].append(row)
        profiles = []
        for flow_key, items in grouped.items():
            if len(items) < 3:
                continue
            profile = cls._aggregate(items)
            profiles.append({"flow": flow_key, "features": cls._feature_vector(profile)})
        return profiles

    @staticmethod
    def _compatible_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [row for row in rows if not row.get("analysis_level") or str(row.get("analysis_level")).lower() == "flow"]

    @staticmethod
    def _aggregate(rows: list[dict[str, Any]]) -> dict[str, Any]:
        count = len(rows)
        latency_ratios = []
        errors = 0
        sla_breaches = 0
        retries = 0
        for row in rows:
            latency = float(row.get("latency_ms") or 0)
            sla = float(row.get("sla_latency_ms") or 300)
            latency_ratios.append(latency / sla if sla > 0 else 0.0)
            status = int(row.get("status_code") or 200)
            success = bool(row.get("success", True))
            errors += 1 if (not success or status >= 400) else 0
            sla_breaches += 1 if row.get("is_sla_breach") else 0
            metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
            retries += int(metadata.get("retry_count") or row.get("retry_count") or 0)
        return {
            "total_calls": count,
            "avg_latency_ratio": sum(latency_ratios) / max(1, count),
            "max_latency_ratio": max(latency_ratios or [0.0]),
            "error_rate": errors / max(1, count),
            "sla_rate": sla_breaches / max(1, count),
            "retry_rate": retries / max(1, count),
            "flow_criticality": rows[0].get("flow_criticality"),
        }

    @staticmethod
    def _feature_vector(profile: dict[str, Any]) -> list[float]:
        total_calls = float(profile.get("total_calls") or profile.get("current_count") or 0)
        return [
            float(profile.get("avg_latency_ratio") or 0),
            float(profile.get("max_latency_ratio") or profile.get("avg_latency_ratio") or 0),
            float(profile.get("error_rate") or 0),
            float(profile.get("sla_rate") or 0),
            float(profile.get("retry_rate") or 0),
            min(5.0, total_calls / 100.0),
            FlowKMeansProfileModel._criticality_value(profile.get("flow_criticality")),
        ]

    @staticmethod
    def _criticality_value(value: Any) -> float:
        return {"low": 0.0, "medium": 1.0, "high": 2.0, "critical": 3.0}.get(str(value or "medium"), 1.0)

    @staticmethod
    def _distance(sample: Any, center: Any) -> float:
        return sum((float(left) - float(right)) ** 2 for left, right in zip(sample, center)) ** 0.5

    @staticmethod
    def _percentile(values: list[float], percentile: float) -> float:
        if not values:
            return 0.0
        ordered = sorted(values)
        index = int(round((len(ordered) - 1) * percentile))
        return float(ordered[min(len(ordered) - 1, max(0, index))])


class FlowAutoencoderModel(BaseAIModel):
    model_id = "flow_autoencoder"
    model_name = "Flow-Level Autoencoder"
    model_type = "deep_learning"
    family = "flow_level"
    status = "experimental"
    version = "0.2.0"
    objective = "Detecter les profils de flow atypiques par erreur de reconstruction."
    anomaly_types = ["DL_FLOW_AUTOENCODER", "CRITICAL_FLOW_INSTABILITY", "SLOW_API_ENDPOINT"]
    supported_analysis_levels = ["flow"]
    is_mock = False

    def __init__(self, model_dir: str = "/app/models") -> None:
        super().__init__(model_dir)
        self.model: Any | None = None
        self.scaler: Any | None = None
        self.reconstruction_threshold = 0.0
        self.training_profile_count = 0

    def train(self, records: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        rows = records or []
        options = self._training_options(rows)
        dataset_mode = str(options.get("dataset_mode") or "normal_only")
        training_rows = rows
        if dataset_mode == "normal_only":
            training_rows = [row for row in rows if not row.get("is_anomaly")]

        profiles = FlowKMeansProfileModel._profiles_from_records(training_rows)
        if MLPRegressor is None or StandardScaler is None or joblib is None or np is None:
            return {
                "model_id": self.model_id,
                "status": "dependency_missing",
                "dependency": "scikit-learn/joblib/numpy",
                "sample_count": len(rows),
            }
        if len(profiles) < 8:
            return {
                "model_id": self.model_id,
                "status": "not_enough_flows",
                "sample_count": len(rows),
                "flow_profile_count": len(profiles),
                "required": 8,
            }

        features = np.asarray([profile["features"] for profile in profiles], dtype=float)
        self.scaler = StandardScaler()
        scaled = self.scaler.fit_transform(features)
        max_iter = self._option_int(options, "max_iter", 400, minimum=50, maximum=2000)
        self.model = MLPRegressor(
            hidden_layer_sizes=(6, 3, 6),
            activation="relu",
            solver="adam",
            max_iter=max_iter,
            random_state=42,
            early_stopping=len(profiles) >= 20,
        )
        self.model.fit(scaled, scaled)
        reconstructed = self.model.predict(scaled)
        errors = np.mean(np.square(scaled - reconstructed), axis=1)
        self.reconstruction_threshold = self._percentile(errors.tolist(), 0.95) * 1.2
        self.training_profile_count = len(profiles)
        self.is_trained = True
        self.save()

        return {
            "model_id": self.model_id,
            "status": "trained",
            "sample_count": len(rows),
            "training_sample_count": len(training_rows),
            "metrics": {
                "flow_profile_count": len(profiles),
                "reconstruction_error": round(float(np.mean(errors)), 6),
                "reconstruction_threshold": round(float(self.reconstruction_threshold), 6),
                "loss": round(float(getattr(self.model, "loss_", 0.0) or 0.0), 6),
                "dataset_mode": dataset_mode,
                "max_iter": max_iter,
            },
        }

    def predict(self, record: dict[str, Any]) -> dict[str, Any]:
        if self.model is None:
            self.load()
        if self.model is None or self.scaler is None or np is None:
            return self.default_prediction(record, False, "NORMAL", 0.0, "Flow Autoencoder is not trained yet.")

        profile = record.get("flow_profile") or record.get("flow_stats") or record
        raw_features = FlowKMeansProfileModel._feature_vector(profile)
        scaled = self.scaler.transform([raw_features])
        reconstructed = self.model.predict(scaled)
        feature_errors = np.square(scaled[0] - reconstructed[0])
        reconstruction_error = float(np.mean(feature_errors))
        ratio = reconstruction_error / max(0.000001, self.reconstruction_threshold or 1.0)
        is_anomaly = self.reconstruction_threshold > 0 and reconstruction_error > self.reconstruction_threshold
        score = min(0.98, max(0.55, 0.58 + (ratio - 1.0) * 0.22)) if is_anomaly else 0.0
        anomaly_type = self._anomaly_type(profile) if is_anomaly else "NORMAL"
        prediction = self.default_prediction(
            record,
            is_anomaly,
            anomaly_type,
            score,
            (
                f"{self.model_name} observe une erreur de reconstruction de "
                f"{reconstruction_error:.4f} pour le profil courant."
            ),
        )
        feature_names = [
            "avg_latency_ratio",
            "max_latency_ratio",
            "error_rate",
            "sla_rate",
            "retry_rate",
            "traffic_volume",
            "flow_criticality",
        ]
        prediction["metadata"] = {
            "reconstruction_error": round(reconstruction_error, 6),
            "reconstruction_threshold": round(float(self.reconstruction_threshold), 6),
            "error_ratio": round(float(ratio), 4),
            "feature_contributions": [
                {"feature": name, "contribution": round(float(value), 6)}
                for name, value in sorted(
                    zip(feature_names, feature_errors),
                    key=lambda item: float(item[1]),
                    reverse=True,
                )
            ],
        }
        return prediction

    def save(self) -> dict[str, Any]:
        if self.model is not None and joblib is not None:
            joblib.dump(
                {
                    "model": self.model,
                    "scaler": self.scaler,
                    "reconstruction_threshold": self.reconstruction_threshold,
                    "training_profile_count": self.training_profile_count,
                    "metadata": self.get_metadata(),
                },
                self.model_dir / f"{self.model_id}.joblib",
            )
        return super().save()

    def load(self) -> dict[str, Any]:
        path = self.model_dir / f"{self.model_id}.joblib"
        if path.exists() and joblib is not None:
            payload = joblib.load(path)
            self.model = payload.get("model")
            self.scaler = payload.get("scaler")
            self.reconstruction_threshold = float(payload.get("reconstruction_threshold") or 0.0)
            self.training_profile_count = int(payload.get("training_profile_count") or 0)
            self.is_trained = self.model is not None and self.scaler is not None
            return {"model_id": self.model_id, "loaded": self.is_trained, "path": str(path)}
        self.is_trained = False
        return {"model_id": self.model_id, "loaded": False, "path": str(path)}

    @staticmethod
    def _anomaly_type(profile: dict[str, Any]) -> str:
        if float(profile.get("error_rate") or 0) >= 0.15 or float(profile.get("sla_rate") or 0) >= 0.25:
            return "CRITICAL_FLOW_INSTABILITY"
        if float(profile.get("avg_latency_ratio") or 0) >= 1.25:
            return "SLOW_API_ENDPOINT"
        return "DL_FLOW_AUTOENCODER"

    @staticmethod
    def _training_options(rows: list[dict[str, Any]]) -> dict[str, Any]:
        if rows and isinstance(rows[0].get("_training_options"), dict):
            return rows[0]["_training_options"]
        return {}

    @staticmethod
    def _option_int(options: dict[str, Any], key: str, default: int, minimum: int, maximum: int) -> int:
        try:
            return min(maximum, max(minimum, int(options.get(key) or default)))
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _percentile(values: list[float], percentile: float) -> float:
        return FlowKMeansProfileModel._percentile(values, percentile)


class FlowGRUProfileModel(BaseAIModel):
    model_id = "flow_gru_profile"
    model_name = "Flow-Level GRU Profile"
    model_type = "deep_learning"
    family = "flow_level"
    status = "experimental"
    version = "0.2.0"
    objective = "Analyser la stabilite d'un flow sur des fenetres successives."
    anomaly_types = [
        "DL_FLOW_SEQUENCE",
        "GRADUAL_PERFORMANCE_DEGRADATION",
        "LATENCY_DRIFT",
        "ERROR_RATE_INCREASE",
        "SLA_BREACH_TREND",
        "INTERMITTENT_INSTABILITY",
        "RECOVERY_FAILURE",
        "TRAFFIC_ASYMMETRY",
        "API_UNDERUSE",
    ]
    supported_analysis_levels = ["flow"]
    is_mock = False

    def __init__(self, model_dir: str = "/app/models") -> None:
        super().__init__(model_dir)
        self.model: Any | None = None
        self.feature_mean: list[float] = [0.0] * 7
        self.feature_std: list[float] = [1.0] * 7
        self.prediction_threshold = 0.0
        self.sequence_length = 6
        self.training_sequence_count = 0
        self.window_events = 5

    def train(self, records: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        rows = records or []
        options = self._training_options(rows)
        sequence_length = self._option_int(options, "sequence_length", 6, 3, 24)
        window_events = self._option_int(options, "window_events", 5, 3, 100)
        epochs = self._option_int(options, "epochs", 16, 1, 100)
        batch_size = self._option_int(options, "batch_size", 16, 4, 256)
        min_sequences = self._option_int(options, "min_sequences", 20, 10, 5000)
        validation_split = self._option_float(options, "validation_split", 0.15, 0.0, 0.4)

        if np is None or Sequential is None or GRU is None or Dense is None or Input is None:
            return {
                "model_id": self.model_id,
                "status": "dependency_missing",
                "dependency": "tensorflow-cpu/numpy",
                "sample_count": len(rows),
            }

        sequences, targets = self._build_training_sequences(rows, sequence_length, window_events)
        if len(sequences) < min_sequences:
            return {
                "model_id": self.model_id,
                "status": "not_enough_sequences",
                "sample_count": len(rows),
                "sequence_count": len(sequences),
                "required": min_sequences,
            }

        x_train = np.asarray(sequences, dtype=np.float32)
        y_train = np.asarray(targets, dtype=np.float32)
        combined = np.concatenate([x_train.reshape(-1, 7), y_train], axis=0)
        self.feature_mean = np.mean(combined, axis=0).tolist()
        self.feature_std = np.std(combined, axis=0).tolist()
        self.feature_std = [value if value > 0.000001 else 1.0 for value in self.feature_std]
        normalized_x = self._normalize(x_train)
        normalized_y = self._normalize(y_train)

        self.model = Sequential(
            [
                Input(shape=(sequence_length, 7)),
                GRU(16),
                Dense(7),
            ]
        )
        self.model.compile(optimizer="adam", loss="mse")
        history = self.model.fit(
            normalized_x,
            normalized_y,
            epochs=epochs,
            batch_size=batch_size,
            validation_split=validation_split if len(sequences) >= 80 else 0.0,
            verbose=0,
        )
        predicted = self.model.predict(normalized_x, verbose=0)
        errors = np.mean(np.abs(normalized_y - predicted), axis=1)
        self.prediction_threshold = FlowKMeansProfileModel._percentile(errors.tolist(), 0.95) * 1.25
        self.sequence_length = sequence_length
        self.window_events = window_events
        self.training_sequence_count = len(sequences)
        self.is_trained = True
        self.save()

        validation_history = history.history.get("val_loss") or []
        return {
            "model_id": self.model_id,
            "status": "trained",
            "sample_count": len(rows),
            "sequence_count": len(sequences),
            "metrics": {
                "loss": round(float(history.history.get("loss", [0.0])[-1]), 6),
                "validation_loss": round(float(validation_history[-1]), 6) if validation_history else None,
                "prediction_error": round(float(np.mean(errors)), 6),
                "prediction_threshold": round(float(self.prediction_threshold), 6),
                "sequence_length": sequence_length,
                "window_events": window_events,
                "epochs": epochs,
                "batch_size": batch_size,
                "validation_split": validation_split,
            },
        }

    def predict(self, record: dict[str, Any]) -> dict[str, Any]:
        if self.model is None:
            self.load()
        if self.model is None or np is None:
            return self.default_prediction(record, False, "NORMAL", 0.0, "Flow GRU Profile is not trained yet.")

        profiles = list(record.get("flow_profile_sequence") or [])
        if len(profiles) < self.sequence_length + 1:
            return self.default_prediction(
                record,
                False,
                "NORMAL",
                0.0,
                "Sequence de profils Flow-Level insuffisante pour appliquer le GRU.",
            )

        sequence_profiles = profiles[-(self.sequence_length + 1) : -1]
        actual_profile = profiles[-1]
        sequence = np.asarray(
            [[FlowKMeansProfileModel._feature_vector(profile) for profile in sequence_profiles]],
            dtype=np.float32,
        )
        actual = np.asarray([FlowKMeansProfileModel._feature_vector(actual_profile)], dtype=np.float32)
        predicted_normalized = self.model.predict(self._normalize(sequence), verbose=0)
        actual_normalized = self._normalize(actual)
        feature_errors = np.abs(actual_normalized[0] - predicted_normalized[0])
        prediction_error = float(np.mean(feature_errors))
        ratio = prediction_error / max(0.000001, self.prediction_threshold or 1.0)
        is_anomaly = self.prediction_threshold > 0 and prediction_error > self.prediction_threshold
        score = min(0.98, max(0.56, 0.6 + (ratio - 1.0) * 0.2)) if is_anomaly else 0.0
        anomaly_type = self._resolve_anomaly_type(profiles) if is_anomaly else "NORMAL"
        prediction = self.default_prediction(
            record,
            is_anomaly,
            anomaly_type,
            score,
            (
                f"{self.model_name} observe un ecart sequentiel de {prediction_error:.4f} "
                f"sur les {self.sequence_length} dernieres fenetres."
            ),
        )
        feature_names = [
            "avg_latency_ratio",
            "max_latency_ratio",
            "error_rate",
            "sla_rate",
            "retry_rate",
            "traffic_volume",
            "flow_criticality",
        ]
        prediction["metadata"] = {
            "prediction_error": round(prediction_error, 6),
            "prediction_threshold": round(float(self.prediction_threshold), 6),
            "error_ratio": round(float(ratio), 4),
            "sequence_length": self.sequence_length,
            "observed_windows": len(profiles),
            "feature_contributions": [
                {"feature": name, "contribution": round(float(value), 6)}
                for name, value in sorted(
                    zip(feature_names, feature_errors),
                    key=lambda item: float(item[1]),
                    reverse=True,
                )
            ],
        }
        return prediction

    def save(self) -> dict[str, Any]:
        if self.model is not None:
            self.model.save(self.model_dir / f"{self.model_id}.keras")
        training_metadata = {
            "feature_mean": self.feature_mean,
            "feature_std": self.feature_std,
            "prediction_threshold": self.prediction_threshold,
            "sequence_length": self.sequence_length,
            "training_sequence_count": self.training_sequence_count,
            "window_events": self.window_events,
        }
        (self.model_dir / f"{self.model_id}.training.json").write_text(
            json.dumps(training_metadata, indent=2),
            encoding="utf-8",
        )
        return super().save()

    def load(self) -> dict[str, Any]:
        model_path = self.model_dir / f"{self.model_id}.keras"
        metadata_path = self.model_dir / f"{self.model_id}.training.json"
        if not model_path.exists() or not metadata_path.exists() or load_model is None:
            self.is_trained = False
            return {"model_id": self.model_id, "loaded": False, "path": str(model_path)}
        self.model = load_model(model_path)
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        self.feature_mean = [float(value) for value in metadata.get("feature_mean") or [0.0] * 7]
        self.feature_std = [float(value) for value in metadata.get("feature_std") or [1.0] * 7]
        self.prediction_threshold = float(metadata.get("prediction_threshold") or 0.0)
        self.sequence_length = int(metadata.get("sequence_length") or 6)
        self.training_sequence_count = int(metadata.get("training_sequence_count") or 0)
        self.window_events = int(metadata.get("window_events") or 5)
        self.is_trained = self.model is not None and self.prediction_threshold > 0
        return {"model_id": self.model_id, "loaded": self.is_trained, "path": str(model_path)}

    @classmethod
    def _build_training_sequences(
        cls,
        rows: list[dict[str, Any]],
        sequence_length: int,
        window_events: int,
    ) -> tuple[list[list[list[float]]], list[list[float]]]:
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in FlowKMeansProfileModel._compatible_rows(rows):
            key = str(row.get("flow_id") or row.get("flow_code") or "unknown")
            grouped[key].append(row)

        sequences: list[list[list[float]]] = []
        targets: list[list[float]] = []
        for flow_rows in grouped.values():
            ordered = sorted(flow_rows, key=cls._timestamp_value)
            profiles = []
            for index in range(0, len(ordered), window_events):
                window = ordered[index : index + window_events]
                if len(window) >= 3:
                    profiles.append(FlowKMeansProfileModel._aggregate(window))
            vectors = [FlowKMeansProfileModel._feature_vector(profile) for profile in profiles]
            for index in range(sequence_length, len(vectors)):
                sequences.append(vectors[index - sequence_length : index])
                targets.append(vectors[index])
        return sequences, targets

    def _normalize(self, values: Any) -> Any:
        mean = np.asarray(self.feature_mean, dtype=np.float32)
        std = np.asarray(self.feature_std, dtype=np.float32)
        return (values - mean) / std

    @staticmethod
    def _resolve_anomaly_type(profiles: list[dict[str, Any]]) -> str:
        recent = profiles[-3:]
        first = recent[0]
        last = recent[-1]
        latency_delta = float(last.get("avg_latency_ratio") or 0) - float(first.get("avg_latency_ratio") or 0)
        error_delta = float(last.get("error_rate") or 0) - float(first.get("error_rate") or 0)
        sla_delta = float(last.get("sla_rate") or 0) - float(first.get("sla_rate") or 0)
        first_volume = float(first.get("total_calls") or 0)
        last_volume = float(last.get("total_calls") or 0)
        if latency_delta >= 0.35 and error_delta >= 0.05:
            return "GRADUAL_PERFORMANCE_DEGRADATION"
        if latency_delta >= 0.3:
            return "LATENCY_DRIFT"
        if error_delta >= 0.12:
            return "ERROR_RATE_INCREASE"
        if sla_delta >= 0.15:
            return "SLA_BREACH_TREND"
        if first_volume >= 10 and last_volume <= first_volume * 0.3:
            return "API_UNDERUSE"
        if first_volume > 0 and last_volume >= first_volume * 2.5:
            return "TRAFFIC_ASYMMETRY"
        return "DL_FLOW_SEQUENCE"

    @staticmethod
    def _timestamp_value(row: dict[str, Any]) -> float:
        value = row.get("called_at")
        if isinstance(value, datetime):
            return value.timestamp()
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
            except ValueError:
                return 0.0
        return 0.0

    @staticmethod
    def _training_options(rows: list[dict[str, Any]]) -> dict[str, Any]:
        if rows and isinstance(rows[0].get("_training_options"), dict):
            return rows[0]["_training_options"]
        return {}

    @staticmethod
    def _option_int(options: dict[str, Any], key: str, default: int, minimum: int, maximum: int) -> int:
        try:
            return min(maximum, max(minimum, int(options.get(key) or default)))
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _option_float(options: dict[str, Any], key: str, default: float, minimum: float, maximum: float) -> float:
        try:
            return min(maximum, max(minimum, float(options.get(key) or default)))
        except (TypeError, ValueError):
            return default
