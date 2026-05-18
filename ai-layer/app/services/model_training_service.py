from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
from sklearn.cluster import KMeans
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import OneClassSVM

from app.core.database import Database

logger = logging.getLogger(__name__)


class ModelTrainingService:
    def __init__(self, database: Database, model_dir: str) -> None:
        self.database = database
        self.model_dir = Path(model_dir)
        self.model_dir.mkdir(parents=True, exist_ok=True)

    def train_all(self) -> dict[str, Any]:
        rows = self._load_training_rows()
        if len(rows) < 100:
            report = {
                "status": "not_enough_data",
                "message": "At least 100 api_calls are required to train stable models.",
                "sample_count": len(rows),
                "trained_at": datetime.now(timezone.utc).isoformat(),
            }
            self._write_report(report)
            return report

        features = [self._features(row) for row in rows]
        labels = [self._label_for(row) for row in rows]
        label_counts = dict(Counter(labels))

        trained_models: list[str] = []
        metrics: dict[str, Any] = {}

        trained_models.append(self._train_isolation_forest(features))
        trained_models.append(self._train_one_class_svm(features))
        trained_models.append(self._train_kmeans(features))
        trained_models.append(self._train_autoencoder(features))

        if len(set(labels)) >= 2:
            rf_metrics = self._train_random_forest(features, labels)
            trained_models.append("random_forest_classifier")
            metrics["random_forest_classifier"] = rf_metrics

        report = {
            "status": "trained",
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "sample_count": len(rows),
            "label_counts": label_counts,
            "trained_models": trained_models,
            "metrics": metrics,
            "model_dir": str(self.model_dir),
        }
        self._write_report(report)
        logger.info("[AI-TRAINING] models trained samples=%s", len(rows))
        return report

    def status(self) -> dict[str, Any]:
        report_path = self.model_dir / "training_report.json"
        if not report_path.exists():
            return {
                "status": "not_trained",
                "model_dir": str(self.model_dir),
                "models": self._model_files(),
            }

        with report_path.open("r", encoding="utf-8") as file:
            report = json.load(file)
        return {
            **report,
            "models": self._model_files(),
        }

    def _train_isolation_forest(self, features: list[list[float]]) -> str:
        model = Pipeline(
            [
                ("scaler", StandardScaler()),
                ("model", IsolationForest(n_estimators=160, contamination=0.08, random_state=42)),
            ]
        )
        model.fit(features)
        joblib.dump(model, self.model_dir / "isolation_forest.joblib")
        return "isolation_forest"

    def _train_one_class_svm(self, features: list[list[float]]) -> str:
        model = Pipeline(
            [
                ("scaler", StandardScaler()),
                ("model", OneClassSVM(kernel="rbf", gamma="scale", nu=0.05)),
            ]
        )
        model.fit(features)
        joblib.dump(model, self.model_dir / "one_class_svm.joblib")
        return "one_class_svm"

    def _train_kmeans(self, features: list[list[float]]) -> str:
        cluster_count = max(2, min(6, int(len(features) ** 0.5)))
        model = Pipeline(
            [
                ("scaler", StandardScaler()),
                ("model", KMeans(n_clusters=cluster_count, n_init=10, random_state=42)),
            ]
        )
        model.fit(features)
        joblib.dump(model, self.model_dir / "kmeans.joblib")
        return "kmeans"

    def _train_autoencoder(self, features: list[list[float]]) -> str:
        model = Pipeline(
            [
                ("scaler", StandardScaler()),
                (
                    "model",
                    MLPRegressor(
                        hidden_layer_sizes=(4, 2, 4),
                        activation="relu",
                        solver="adam",
                        alpha=0.001,
                        learning_rate_init=0.005,
                        max_iter=400,
                        random_state=42,
                    ),
                ),
            ]
        )
        model.fit(features, features)
        joblib.dump(model, self.model_dir / "autoencoder_mlp.joblib")
        return "autoencoder_mlp"

    def _train_random_forest(self, features: list[list[float]], labels: list[str]) -> dict[str, Any]:
        x_train, x_test, y_train, y_test = train_test_split(
            features,
            labels,
            test_size=0.2,
            random_state=42,
            stratify=labels if min(Counter(labels).values()) >= 2 else None,
        )
        model = RandomForestClassifier(
            n_estimators=180,
            max_depth=10,
            min_samples_leaf=3,
            class_weight="balanced",
            random_state=42,
        )
        model.fit(x_train, y_train)
        predictions = model.predict(x_test)
        joblib.dump(model, self.model_dir / "random_forest_classifier.joblib")
        return {
            "accuracy": round(float(accuracy_score(y_test, predictions)), 4),
            "classification_report": classification_report(y_test, predictions, output_dict=True, zero_division=0),
        }

    def _load_training_rows(self) -> list[dict[str, Any]]:
        return self.database.fetch_all(
            """
            SELECT
                ac.latency_ms,
                ac.status_code,
                ac.success,
                ac.error_type,
                ac.is_sla_breach,
                COALESCE(f.sla_latency_ms, a.sla_latency_ms) AS sla_latency_ms,
                a.criticality AS api_criticality,
                producer.criticality AS producer_criticality,
                consumer.criticality AS consumer_criticality
            FROM api_calls ac
            JOIN flows f ON f.id = ac.flow_id
            JOIN apis a ON a.id = ac.api_id
            JOIN actors producer ON producer.id = ac.producer_actor_id
            JOIN actors consumer ON consumer.id = ac.consumer_actor_id
            WHERE ac.latency_ms IS NOT NULL
            ORDER BY ac.called_at DESC
            LIMIT 20000
            """
        )

    @staticmethod
    def _features(row: dict[str, Any]) -> list[float]:
        latency_ms = float(row.get("latency_ms") or 0)
        sla_latency_ms = float(row.get("sla_latency_ms") or 1)
        status_code = float(row.get("status_code") or 0)
        success = bool(row.get("success"))
        is_sla_breach = bool(row.get("is_sla_breach"))
        is_error = (not success) or status_code >= 400
        is_server_error = status_code >= 500
        latency_ratio = latency_ms / sla_latency_ms if sla_latency_ms > 0 else 0.0

        return [
            latency_ms,
            status_code,
            latency_ratio,
            1.0 if is_error else 0.0,
            1.0 if is_server_error else 0.0,
            1.0 if is_sla_breach else 0.0,
            ModelTrainingService._criticality_value(row.get("api_criticality")),
            ModelTrainingService._criticality_value(row.get("producer_criticality")),
            ModelTrainingService._criticality_value(row.get("consumer_criticality")),
        ]

    @staticmethod
    def _label_for(row: dict[str, Any]) -> str:
        status_code = int(row.get("status_code") or 0)
        error_type = row.get("error_type")
        success = bool(row.get("success"))
        is_sla_breach = bool(row.get("is_sla_breach"))

        if status_code == 504 or error_type == "timeout":
            return "TIMEOUT"
        if status_code in {502, 503}:
            return "PROVIDER_UNREACHABLE"
        if status_code >= 500:
            return "SERVER_ERROR"
        if status_code == 403 or error_type == "access_denied":
            return "ACCESS_DENIED"
        if is_sla_breach:
            return "SLA_BREACH"
        if not success or status_code >= 400:
            return "API_ERROR"
        return "NORMAL"

    @staticmethod
    def _criticality_value(value: Any) -> float:
        return {
            "low": 0.0,
            "medium": 1.0,
            "high": 2.0,
            "critical": 3.0,
        }.get(str(value or "medium"), 1.0)

    def _write_report(self, report: dict[str, Any]) -> None:
        with (self.model_dir / "training_report.json").open("w", encoding="utf-8") as file:
            json.dump(report, file, indent=2)

    def _model_files(self) -> list[str]:
        return sorted(path.name for path in self.model_dir.glob("*") if path.is_file())
