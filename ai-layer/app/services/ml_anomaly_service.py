from __future__ import annotations

import logging
import math
from typing import Any

import numpy as np
from sklearn.cluster import KMeans
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.svm import OneClassSVM

from app.core.database import Database

logger = logging.getLogger(__name__)

try:
    from tensorflow.keras import Sequential
    from tensorflow.keras.layers import Dense, GRU
except ImportError:  # pragma: no cover - keeps the API alive before Docker rebuild.
    Sequential = None
    Dense = None
    GRU = None


MIN_TRAINING_SAMPLES = 30
SVM_MIN_TRAINING_SAMPLES = 50
RF_MIN_TRAINING_SAMPLES = 80
KMEANS_MIN_TRAINING_SAMPLES = 60
AUTOENCODER_MIN_TRAINING_SAMPLES = 80
GRU_MIN_TRAINING_SAMPLES = 90
GRU_SEQUENCE_LENGTH = 8
RF_LABEL_TO_ANOMALY = {
    "timeout": "TIMEOUT",
    "server_error": "SERVER_ERROR",
    "access_denied": "ACCESS_DENIED",
    "sla_breach": "SLA_BREACH",
}


class MLAnomalyService:
    def __init__(self, database: Database) -> None:
        self.database = database

    def analyze(self, event: dict[str, Any]) -> list[dict[str, Any]]:
        if event.get("event_type") != "api_call":
            return []

        flow_id = event.get("flow_id")
        if not flow_id or event.get("latency_ms") is None:
            return []

        training_rows = self._load_training_rows(flow_id)
        if len(training_rows) < MIN_TRAINING_SAMPLES:
            return []

        training_matrix = [self._features(row) for row in training_rows]
        current_features = self._features(event)

        anomalies: list[dict[str, Any]] = []
        anomalies.extend(self._analyze_with_isolation_forest(training_matrix, current_features, len(training_rows), event))
        anomalies.extend(self._analyze_with_one_class_svm(training_matrix, current_features, len(training_rows), event))
        anomalies.extend(self._analyze_with_random_forest(training_rows, training_matrix, current_features, event))
        anomalies.extend(self._analyze_with_kmeans(training_matrix, current_features, len(training_rows), event))
        anomalies.extend(self._analyze_with_autoencoder(training_matrix, current_features, len(training_rows), event))
        anomalies.extend(self._analyze_with_gru_sequence(training_rows, event))

        return anomalies

    def _analyze_with_isolation_forest(
        self,
        training_matrix: list[list[float]],
        current_features: list[float],
        training_count: int,
        event: dict[str, Any],
    ) -> list[dict[str, Any]]:
        model = IsolationForest(
            n_estimators=100,
            contamination=0.08,
            random_state=42,
        )
        model.fit(training_matrix)

        prediction = int(model.predict([current_features])[0])
        if prediction != -1:
            return []

        anomaly_score = float(-model.decision_function([current_features])[0])
        confidence = max(0.65, min(0.95, 0.7 + anomaly_score))

        logger.info("[AI-ML] IsolationForest anomaly detected flow=%s", event.get("flow_code"))
        return [
            {
                "detected_anomaly_type": "ML_ISOLATION_FOREST",
                "confidence": round(confidence, 2),
                "explanation": "Isolation Forest detected an unusual combination of latency, status and error indicators.",
                "analysis_type": "historical",
                "model": {
                    "name": "IsolationForest",
                    "training_samples": training_count,
                    "contamination": 0.08,
                    "anomaly_score": round(anomaly_score, 4),
                },
            }
        ]

    def _analyze_with_one_class_svm(
        self,
        training_matrix: list[list[float]],
        current_features: list[float],
        training_count: int,
        event: dict[str, Any],
    ) -> list[dict[str, Any]]:
        if training_count < SVM_MIN_TRAINING_SAMPLES:
            return []

        scaler = StandardScaler()
        scaled_training = scaler.fit_transform(training_matrix)
        scaled_current = scaler.transform([current_features])

        model = OneClassSVM(
            kernel="rbf",
            gamma="scale",
            nu=0.05,
        )
        model.fit(scaled_training)

        prediction = int(model.predict(scaled_current)[0])
        decision_score = float(model.decision_function(scaled_current)[0])
        if prediction != -1 or decision_score > -0.02:
            return []

        confidence = max(0.68, min(0.94, 0.72 + abs(decision_score)))

        logger.info("[AI-ML] OneClassSVM anomaly detected flow=%s", event.get("flow_code"))
        return [
            {
                "detected_anomaly_type": "ML_ONE_CLASS_SVM",
                "confidence": round(confidence, 2),
                "explanation": "One-Class SVM detected that this API call is outside the learned normal behavior boundary.",
                "analysis_type": "historical",
                "model": {
                    "name": "OneClassSVM",
                    "training_samples": training_count,
                    "kernel": "rbf",
                    "nu": 0.05,
                    "decision_score": round(decision_score, 4),
                },
            }
        ]

    def _analyze_with_random_forest(
        self,
        training_rows: list[dict[str, Any]],
        training_matrix: list[list[float]],
        current_features: list[float],
        event: dict[str, Any],
    ) -> list[dict[str, Any]]:
        if len(training_rows) < RF_MIN_TRAINING_SAMPLES:
            return []

        labels = [self._label_for(row) for row in training_rows]
        distinct_labels = set(labels)
        if len(distinct_labels) < 2 or distinct_labels == {"normal"}:
            return []

        model = RandomForestClassifier(
            n_estimators=120,
            max_depth=8,
            min_samples_leaf=3,
            class_weight="balanced",
            random_state=42,
        )
        model.fit(training_matrix, labels)

        predicted_label = str(model.predict([current_features])[0])
        if predicted_label == "normal":
            return []

        probabilities = model.predict_proba([current_features])[0]
        class_probabilities = {
            str(label): float(probability)
            for label, probability in zip(model.classes_, probabilities)
        }
        confidence = class_probabilities.get(predicted_label, 0.0)
        if confidence < 0.65:
            return []

        mapped_type = RF_LABEL_TO_ANOMALY.get(predicted_label, "ML_RANDOM_FOREST")

        logger.info(
            "[AI-ML] RandomForest classification detected flow=%s label=%s",
            event.get("flow_code"),
            predicted_label,
        )
        return [
            {
                "detected_anomaly_type": "ML_RANDOM_FOREST",
                "confidence": round(confidence, 2),
                "explanation": "Random Forest classified this API call as an incident based on previously observed labeled behavior.",
                "analysis_type": "historical",
                "model": {
                    "name": "RandomForestClassifier",
                    "training_samples": len(training_rows),
                    "predicted_label": predicted_label,
                    "predicted_anomaly_type": mapped_type,
                    "class_probabilities": {
                        label: round(probability, 4)
                        for label, probability in class_probabilities.items()
                    },
                },
            }
        ]

    def _analyze_with_kmeans(
        self,
        training_matrix: list[list[float]],
        current_features: list[float],
        training_count: int,
        event: dict[str, Any],
    ) -> list[dict[str, Any]]:
        if training_count < KMEANS_MIN_TRAINING_SAMPLES:
            return []

        scaler = StandardScaler()
        scaled_training = scaler.fit_transform(training_matrix)
        scaled_current = scaler.transform([current_features])

        cluster_count = max(2, min(4, int(math.sqrt(training_count))))
        model = KMeans(
            n_clusters=cluster_count,
            n_init=10,
            random_state=42,
        )
        model.fit(scaled_training)

        training_distances = [
            self._distance_to_center(sample, model.cluster_centers_[int(label)])
            for sample, label in zip(scaled_training, model.labels_)
        ]
        distance_threshold = self._percentile(training_distances, 95) * 1.25

        current_cluster = int(model.predict(scaled_current)[0])
        current_distance = self._distance_to_center(scaled_current[0], model.cluster_centers_[current_cluster])
        if current_distance <= distance_threshold:
            return []

        distance_ratio = current_distance / distance_threshold if distance_threshold > 0 else current_distance
        confidence = max(0.66, min(0.93, 0.68 + (distance_ratio - 1) * 0.2))

        logger.info("[AI-ML] KMeans distance anomaly detected flow=%s", event.get("flow_code"))
        return [
            {
                "detected_anomaly_type": "ML_KMEANS_CLUSTER",
                "confidence": round(confidence, 2),
                "explanation": "K-Means clustering detected that this API call is far from the learned behavior clusters.",
                "analysis_type": "historical",
                "model": {
                    "name": "KMeans",
                    "training_samples": training_count,
                    "n_clusters": cluster_count,
                    "assigned_cluster": current_cluster,
                    "distance_to_center": round(current_distance, 4),
                    "distance_threshold": round(distance_threshold, 4),
                    "distance_ratio": round(distance_ratio, 4),
                },
            }
        ]

    def _analyze_with_autoencoder(
        self,
        training_matrix: list[list[float]],
        current_features: list[float],
        training_count: int,
        event: dict[str, Any],
    ) -> list[dict[str, Any]]:
        if training_count < AUTOENCODER_MIN_TRAINING_SAMPLES:
            return []

        scaler = StandardScaler()
        scaled_training = scaler.fit_transform(training_matrix)
        scaled_current = scaler.transform([current_features])

        model = MLPRegressor(
            hidden_layer_sizes=(4, 2, 4),
            activation="relu",
            solver="adam",
            alpha=0.001,
            learning_rate_init=0.005,
            max_iter=300,
            random_state=42,
        )
        model.fit(scaled_training, scaled_training)

        reconstructed_training = model.predict(scaled_training)
        training_errors = [
            self._mean_squared_error(original, reconstructed)
            for original, reconstructed in zip(scaled_training, reconstructed_training)
        ]
        reconstruction_threshold = self._percentile(training_errors, 95) * 1.4

        reconstructed_current = model.predict(scaled_current)[0]
        reconstruction_error = self._mean_squared_error(scaled_current[0], reconstructed_current)
        if reconstruction_error <= reconstruction_threshold:
            return []

        error_ratio = reconstruction_error / reconstruction_threshold if reconstruction_threshold > 0 else reconstruction_error
        confidence = max(0.68, min(0.95, 0.7 + (error_ratio - 1) * 0.18))

        logger.info("[AI-ML] Autoencoder reconstruction anomaly detected flow=%s", event.get("flow_code"))
        return [
            {
                "detected_anomaly_type": "ML_AUTOENCODER",
                "confidence": round(confidence, 2),
                "explanation": "Autoencoder reconstruction error indicates that this API call does not match the learned normal pattern.",
                "analysis_type": "historical",
                "model": {
                    "name": "MLPRegressorAutoencoder",
                    "training_samples": training_count,
                    "hidden_layers": [4, 2, 4],
                    "reconstruction_error": round(reconstruction_error, 4),
                    "reconstruction_threshold": round(reconstruction_threshold, 4),
                    "error_ratio": round(error_ratio, 4),
                },
            }
        ]

    def _analyze_with_gru_sequence(self, training_rows: list[dict[str, Any]], event: dict[str, Any]) -> list[dict[str, Any]]:
        if Sequential is None or GRU is None or Dense is None:
            logger.warning("[AI-ML] TensorFlow is unavailable; GRU sequence model skipped")
            return []

        if len(training_rows) < GRU_MIN_TRAINING_SAMPLES:
            return []

        latencies = [float(row.get("latency_ms") or 0) for row in reversed(training_rows)]
        current_latency = float(event.get("latency_ms") or 0)
        if len(latencies) <= GRU_SEQUENCE_LENGTH + 5:
            return []

        mean_latency = sum(latencies) / len(latencies)
        variance = sum((value - mean_latency) ** 2 for value in latencies) / len(latencies)
        std_latency = math.sqrt(variance) or 1.0
        normalized_latencies = [(value - mean_latency) / std_latency for value in latencies]

        sequences: list[list[list[float]]] = []
        targets: list[float] = []
        for index in range(len(normalized_latencies) - GRU_SEQUENCE_LENGTH):
            window = normalized_latencies[index : index + GRU_SEQUENCE_LENGTH]
            target = normalized_latencies[index + GRU_SEQUENCE_LENGTH]
            sequences.append([[value] for value in window])
            targets.append(target)

        if len(sequences) < GRU_MIN_TRAINING_SAMPLES - GRU_SEQUENCE_LENGTH:
            return []

        x_train = np.array(sequences, dtype=np.float32)
        y_train = np.array(targets, dtype=np.float32)

        model = Sequential(
            [
                GRU(8, input_shape=(GRU_SEQUENCE_LENGTH, 1)),
                Dense(1),
            ]
        )
        model.compile(optimizer="adam", loss="mse")
        model.fit(x_train, y_train, epochs=8, batch_size=16, verbose=0)

        train_predictions = model.predict(x_train, verbose=0).reshape(-1)
        train_errors = [abs(float(actual) - float(predicted)) for actual, predicted in zip(y_train, train_predictions)]
        prediction_threshold = self._percentile(train_errors, 95) * 1.4

        current_window = normalized_latencies[-GRU_SEQUENCE_LENGTH:]
        x_current = np.array([[[value] for value in current_window]], dtype=np.float32)
        predicted_normalized = float(model.predict(x_current, verbose=0)[0][0])
        actual_normalized = (current_latency - mean_latency) / std_latency
        prediction_error = abs(actual_normalized - predicted_normalized)
        if prediction_error <= prediction_threshold:
            return []

        error_ratio = prediction_error / prediction_threshold if prediction_threshold > 0 else prediction_error
        predicted_latency = predicted_normalized * std_latency + mean_latency
        confidence = max(0.68, min(0.95, 0.7 + (error_ratio - 1) * 0.18))

        logger.info("[AI-ML] GRU sequence anomaly detected flow=%s", event.get("flow_code"))
        return [
            {
                "detected_anomaly_type": "DL_GRU_SEQUENCE",
                "confidence": round(confidence, 2),
                "explanation": "GRU temporal model predicted a normal latency pattern, but the current call deviates from that sequence.",
                "analysis_type": "historical",
                "model": {
                    "name": "KerasGRU",
                    "training_samples": len(training_rows),
                    "sequence_length": GRU_SEQUENCE_LENGTH,
                    "epochs": 8,
                    "predicted_latency_ms": round(predicted_latency, 2),
                    "actual_latency_ms": round(current_latency, 2),
                    "prediction_error": round(prediction_error, 4),
                    "prediction_threshold": round(prediction_threshold, 4),
                    "error_ratio": round(error_ratio, 4),
                },
            }
        ]

    def _load_training_rows(self, flow_id: str) -> list[dict[str, Any]]:
        return self.database.fetch_all(
            """
            SELECT
                latency_ms,
                status_code,
                success,
                error_type,
                is_sla_breach
            FROM api_calls
            WHERE flow_id = %s
              AND called_at >= NOW() - INTERVAL '60 minutes'
              AND latency_ms IS NOT NULL
            ORDER BY called_at DESC
            LIMIT 500
            """,
            (flow_id,),
        )

    @staticmethod
    def _features(row: dict[str, Any]) -> list[float]:
        latency_ms = float(row.get("latency_ms") or 0)
        status_code = float(row.get("status_code") or 0)
        success = bool(row.get("success"))
        is_sla_breach = bool(row.get("is_sla_breach"))
        is_error = (not success) or status_code >= 400
        is_server_error = status_code >= 500

        return [
            latency_ms,
            status_code,
            1.0 if is_error else 0.0,
            1.0 if is_server_error else 0.0,
            1.0 if is_sla_breach else 0.0,
        ]

    @staticmethod
    def _label_for(row: dict[str, Any]) -> str:
        status_code = int(row.get("status_code") or 0)
        error_type = row.get("error_type")
        success = bool(row.get("success"))
        is_sla_breach = bool(row.get("is_sla_breach"))

        if status_code == 504 or error_type == "timeout":
            return "timeout"
        if status_code >= 500:
            return "server_error"
        if status_code == 403 or error_type == "access_denied":
            return "access_denied"
        if is_sla_breach:
            return "sla_breach"
        if not success or status_code >= 400:
            return "api_error"
        return "normal"

    @staticmethod
    def _distance_to_center(sample: Any, center: Any) -> float:
        return math.sqrt(sum((float(left) - float(right)) ** 2 for left, right in zip(sample, center)))

    @staticmethod
    def _percentile(values: list[float], percentile: int) -> float:
        if not values:
            return 0.0

        ordered = sorted(values)
        index = int(round((len(ordered) - 1) * percentile / 100))
        return float(ordered[index])

    @staticmethod
    def _mean_squared_error(left: Any, right: Any) -> float:
        values = [(float(first) - float(second)) ** 2 for first, second in zip(left, right)]
        if not values:
            return 0.0
        return sum(values) / len(values)
