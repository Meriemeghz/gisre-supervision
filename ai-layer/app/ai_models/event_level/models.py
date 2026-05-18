from __future__ import annotations

from typing import Any

from app.ai_models.base import BaseAIModel
from app.ai_models.simple_models import MockExperimentalModel

try:
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.metrics import accuracy_score, classification_report
    from sklearn.model_selection import train_test_split
except ModuleNotFoundError:  # pragma: no cover - available inside the ai-layer Docker image.
    RandomForestClassifier = None
    accuracy_score = None
    classification_report = None
    train_test_split = None

try:
    import joblib
except ModuleNotFoundError:  # pragma: no cover - Docker image installs joblib through scikit-learn.
    joblib = None


EVENT_LEVEL_ANOMALIES = [
    "SLA_BREACH",
    "HIGH_LATENCY",
    "SERVER_ERROR",
    "TIMEOUT",
    "PROVIDER_UNREACHABLE",
    "ACCESS_DENIED",
    "DATA_CONSISTENCY_SIGNAL",
    "AUTHENTICATION_ABUSE",
    "SUSPICIOUS_ACCESS",
    "RATE_LIMIT_EXCEEDED",
]


EVENT_LEVEL_PRIORITY = {
    "PROVIDER_UNREACHABLE": 1,
    "TIMEOUT": 2,
    "SERVER_ERROR": 3,
    "AUTHENTICATION_ABUSE": 4,
    "ACCESS_DENIED": 5,
    "SUSPICIOUS_ACCESS": 6,
    "RATE_LIMIT_EXCEEDED": 7,
    "HIGH_LATENCY": 8,
    "DATA_CONSISTENCY_SIGNAL": 9,
    "SLA_BREACH": 10,
}


class EventLevelRulesEngineModel(BaseAIModel):
    model_id = "event_rules_engine"
    model_name = "Event-Level Rules Engine"
    model_type = "rules"
    family = "event_level"
    status = "active"
    version = "1.0.0"
    objective = "Analyser un evenement API ou audit individuel avec des regles deterministes GISRE."
    anomaly_types = EVENT_LEVEL_ANOMALIES
    is_mock = False
    supported_analysis_levels = ["event"]

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
        detections = self.detect(record)
        if detections:
            return detections[0]
        return self.default_prediction(
            record,
            anomaly_detected=False,
            anomaly_type="NORMAL",
            score=0.0,
            explanation="Aucune regle event-level ne signale une anomalie sur cet evenement.",
        )

    def detect(self, record: dict[str, Any]) -> list[dict[str, Any]]:
        features = self.features_from_record(record)
        latency_ratio = record.get("latency_ratio")
        if latency_ratio is None:
            latency_ratio = features["latency_ratio"]

        status_code = int(record.get("status_code") or 0)
        error_type = str(record.get("error_type") or "").lower()
        action = str(record.get("action") or "").lower()
        outcome = str(record.get("outcome") or "").lower()

        detections: list[dict[str, Any]] = []

        if record.get("is_sla_breach"):
            detections.append(self._detection("SLA_BREACH", 0.88, "The event breached the configured SLA latency."))

        if latency_ratio is not None and float(latency_ratio) >= 1.25:
            detections.append(self._detection("HIGH_LATENCY", 0.84, "Latency is significantly above the SLA target."))

        if status_code in {502, 503}:
            detections.append(self._detection("PROVIDER_UNREACHABLE", 0.86, f"HTTP {status_code} indicates provider unavailability."))
        elif status_code >= 500:
            detections.append(self._detection("SERVER_ERROR", 0.86, f"HTTP {status_code} indicates a producer-side failure."))

        if error_type == "timeout" or status_code == 504:
            detections.append(self._detection("TIMEOUT", 0.9, "The request ended with a timeout signal."))

        if status_code in {401, 403} or error_type == "access_denied" or outcome in {"denied", "failure"}:
            detections.append(self._detection("ACCESS_DENIED", 0.85, "The event indicates denied or forbidden access."))

        if status_code == 429 or error_type == "rate_limit_exceeded":
            detections.append(self._detection("RATE_LIMIT_EXCEEDED", 0.78, "The event exceeded an API rate limit."))

        if (
            error_type in {"metadata_inconsistency", "corrupted_payload", "missing_correlation_id"}
            or action in {"metadata_inconsistency", "corrupted_payload"}
            or str(record.get("error_code") or "").endswith("_signal")
        ):
            detections.append(self._detection("DATA_CONSISTENCY_SIGNAL", 0.82, "Technical metadata is inconsistent for the event."))

        if action in {"access_denied", "login_failure", "token_failure"} and outcome in {"failure", "denied"}:
            detections.append(self._detection("AUTHENTICATION_ABUSE", 0.78, "Security-related failures suggest abnormal authentication behavior."))

        if record.get("source_ip") and (status_code in {401, 403} or outcome in {"failure", "denied"}) and record.get("api_criticality") in {"high", "critical"}:
            detections.append(self._detection("SUSPICIOUS_ACCESS", 0.74, "Access failure targets a sensitive API or actor."))

        return sorted(
            self._deduplicate(detections),
            key=lambda item: EVENT_LEVEL_PRIORITY.get(item["anomaly_type"], 100),
        )

    def _detection(self, anomaly_type: str, confidence: float, explanation: str) -> dict[str, Any]:
        return {
            "anomaly_detected": True,
            "anomaly_type": anomaly_type,
            "anomaly_score": confidence,
            "risk_score": self._risk_score(confidence),
            "severity": self._severity(self._risk_score(confidence)),
            "confidence": confidence,
            "explanation": explanation,
            "recommendation": self._recommendation(anomaly_type),
            "model_id": self.model_id,
            "model_name": self.model_name,
        }

    @staticmethod
    def _deduplicate(detections: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[str] = set()
        unique: list[dict[str, Any]] = []
        for detection in detections:
            anomaly_type = detection["anomaly_type"]
            if anomaly_type not in seen:
                seen.add(anomaly_type)
                unique.append(detection)
        return unique


class _PlannedEventModel(MockExperimentalModel):
    family = "event_level"
    supported_analysis_levels = ["event"]
    is_mock = True

    def train(self, records: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        return {
            "model_id": self.model_id,
            "status": self.status,
            "sample_count": len(records or []),
            "message": "Modele reference comme compatible Event-Level; implementation reelle planifiee.",
        }


class EventLevelRandomForestModel(BaseAIModel):
    model_id = "event_random_forest"
    model_name = "Event-Level Random Forest"
    model_type = "supervised"
    family = "event_level"
    status = "experimental"
    version = "0.1.0"
    objective = "Classifier les anomalies event-level connues a partir de donnees etiquetees."
    anomaly_types = ["SLA_BREACH", "TIMEOUT", "SERVER_ERROR", "ACCESS_DENIED", "PROVIDER_UNREACHABLE"]
    supported_analysis_levels = ["event"]
    is_mock = False

    def __init__(self, model_dir: str = "/app/models") -> None:
        super().__init__(model_dir)
        self.model: Any | None = None
        self.labels: list[str] = []

    def train(self, records: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        rows = records or []
        labelled_rows = [row for row in rows if self._label_for(row)]
        labels = [self._label_for(row) for row in labelled_rows]

        if RandomForestClassifier is None or accuracy_score is None or classification_report is None or train_test_split is None:
            return {
                "model_id": self.model_id,
                "status": "dependency_missing",
                "sample_count": len(rows),
                "dependency": "scikit-learn",
            }

        if len(labelled_rows) < 20 or len(set(labels)) < 2:
            return {
                "model_id": self.model_id,
                "status": "not_enough_labelled_data",
                "sample_count": len(rows),
                "labelled_sample_count": len(labelled_rows),
                "required": "At least 20 labelled records and 2 classes are required.",
            }

        features = [self._feature_vector(row) for row in labelled_rows]
        if joblib is None:
            return {
                "model_id": self.model_id,
                "status": "dependency_missing",
                "sample_count": len(rows),
                "dependency": "joblib",
            }

        stratify = labels if min(labels.count(label) for label in set(labels)) >= 2 else None
        x_train, x_test, y_train, y_test = train_test_split(
            features,
            labels,
            test_size=0.25,
            random_state=42,
            stratify=stratify,
        )

        self.model = RandomForestClassifier(
            n_estimators=160,
            max_depth=9,
            min_samples_leaf=2,
            class_weight="balanced",
            random_state=42,
        )
        self.model.fit(x_train, y_train)
        self.labels = sorted(set(labels))
        self.is_trained = True
        predictions = self.model.predict(x_test)
        self.save()

        return {
            "model_id": self.model_id,
            "status": "trained",
            "sample_count": len(rows),
            "labelled_sample_count": len(labelled_rows),
            "labels": self.labels,
            "metrics": {
                "accuracy": round(float(accuracy_score(y_test, predictions)), 4),
                "classification_report": classification_report(y_test, predictions, output_dict=True, zero_division=0),
            },
        }

    def predict(self, record: dict[str, Any]) -> dict[str, Any]:
        if self.model is None:
            self.load()

        if self.model is None:
            return self.default_prediction(
                record,
                anomaly_detected=False,
                anomaly_type="NORMAL",
                score=0.0,
                explanation="Event-Level Random Forest is not trained yet.",
            )

        features = [self._feature_vector(record)]
        predicted_label = str(self.model.predict(features)[0])
        confidence = self._prediction_confidence(features)
        anomaly_detected = predicted_label != "NORMAL"

        return self.default_prediction(
            record,
            anomaly_detected=anomaly_detected,
            anomaly_type=predicted_label,
            score=confidence if anomaly_detected else 0.0,
            explanation=(
                f"{self.model_name} classe cet evenement comme {predicted_label} "
                f"avec une confiance estimee de {confidence:.2f}."
            ),
        )

    def save(self) -> dict[str, Any]:
        if self.model is not None and joblib is not None:
            joblib.dump(
                {
                    "model": self.model,
                    "labels": self.labels,
                    "metadata": self.get_metadata(),
                },
                self.model_dir / f"{self.model_id}.joblib",
            )
        return super().save()

    def load(self) -> dict[str, Any]:
        model_path = self.model_dir / f"{self.model_id}.joblib"
        if model_path.exists() and joblib is not None:
            payload = joblib.load(model_path)
            self.model = payload.get("model")
            self.labels = list(payload.get("labels") or [])
            self.is_trained = self.model is not None
            return {"model_id": self.model_id, "loaded": self.is_trained, "path": str(model_path)}

        global_rf_path = self.model_dir / "random_forest_classifier.joblib"
        if global_rf_path.exists() and joblib is not None:
            self.model = joblib.load(global_rf_path)
            self.labels = list(getattr(self.model, "classes_", []))
            self.is_trained = True
            return {"model_id": self.model_id, "loaded": True, "path": str(global_rf_path), "source": "random_forest_classifier"}

        return super().load()

    @staticmethod
    def _feature_vector(record: dict[str, Any]) -> list[float]:
        latency_ms = float(record.get("latency_ms") or 0)
        sla_latency_ms = float(record.get("sla_latency_ms") or record.get("sla_ms") or 1)
        status_code = float(record.get("status_code") or 200)
        success = bool(record.get("success", True))
        is_sla_breach = bool(record.get("is_sla_breach"))
        is_error = (not success) or status_code >= 400
        is_server_error = status_code >= 500
        latency_ratio = float(record.get("latency_ratio") or (latency_ms / sla_latency_ms if sla_latency_ms > 0 else 0))

        return [
            latency_ms,
            status_code,
            latency_ratio,
            1.0 if is_error else 0.0,
            1.0 if is_server_error else 0.0,
            1.0 if is_sla_breach else 0.0,
            EventLevelRandomForestModel._criticality_value(record.get("api_criticality")),
            EventLevelRandomForestModel._criticality_value(record.get("producer_criticality")),
            EventLevelRandomForestModel._criticality_value(record.get("consumer_criticality")),
        ]

    @staticmethod
    def _label_for(record: dict[str, Any]) -> str | None:
        label = record.get("label") or record.get("anomaly_type") or record.get("detected_anomaly_type")
        if label:
            normalized = str(label).upper()
            return "NORMAL" if normalized in {"NORMAL", "NONE", "NULL"} else normalized

        if record.get("is_anomaly") is False:
            return "NORMAL"

        status_code = int(record.get("status_code") or 0)
        error_type = str(record.get("error_type") or "").lower()
        if status_code == 504 or error_type == "timeout":
            return "TIMEOUT"
        if status_code in {502, 503}:
            return "PROVIDER_UNREACHABLE"
        if status_code >= 500:
            return "SERVER_ERROR"
        if status_code in {401, 403} or error_type == "access_denied":
            return "ACCESS_DENIED"
        if record.get("is_sla_breach"):
            return "SLA_BREACH"
        return None

    def _prediction_confidence(self, features: list[list[float]]) -> float:
        if self.model is None or not hasattr(self.model, "predict_proba"):
            return 0.72
        probabilities = self.model.predict_proba(features)[0]
        return float(max(probabilities))

    @staticmethod
    def _criticality_value(value: Any) -> float:
        return {
            "low": 0.0,
            "medium": 1.0,
            "high": 2.0,
            "critical": 3.0,
        }.get(str(value or "medium"), 1.0)


class EventLevelIsolationForestModel(_PlannedEventModel):
    model_id = "event_isolation_forest"
    model_name = "Event-Level Isolation Forest"
    model_type = "unsupervised"
    status = "planned"
    version = "0.1.0"
    objective = "Detecter les evenements individuels rares sans labels."
    anomaly_types = ["ML_ISOLATION_FOREST", "HIGH_LATENCY", "SERVER_ERROR", "TIMEOUT"]
    default_anomaly_type = "EVENT_ISOLATION_FOREST_SIGNAL"


class EventLevelLocalOutlierFactorModel(_PlannedEventModel):
    model_id = "event_lof"
    model_name = "Event-Level Local Outlier Factor"
    model_type = "unsupervised"
    status = "experimental"
    version = "0.1.0"
    objective = "Detecter les outliers locaux sur un evenement par comparaison a son voisinage."
    anomaly_types = ["ML_LOCAL_OUTLIER_FACTOR", "HIGH_LATENCY", "DATA_CONSISTENCY_SIGNAL"]
    default_anomaly_type = "EVENT_LOF_SIGNAL"


class EventLevelAutoencoderMLPModel(_PlannedEventModel):
    model_id = "event_autoencoder_mlp"
    model_name = "Event-Level MLP Autoencoder"
    model_type = "deep_learning"
    status = "experimental"
    version = "0.1.0"
    objective = "Detecter les evenements atypiques par erreur de reconstruction."
    anomaly_types = ["ML_AUTOENCODER", "DATA_CONSISTENCY_SIGNAL", "HIGH_LATENCY"]
    default_anomaly_type = "EVENT_AUTOENCODER_SIGNAL"
