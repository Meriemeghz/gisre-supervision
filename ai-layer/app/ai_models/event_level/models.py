from __future__ import annotations

from typing import Any

from app.ai_models.base import BaseAIModel
from app.ai_models.simple_models import MockExperimentalModel

try:
    from sklearn.ensemble import IsolationForest
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
    from sklearn.model_selection import train_test_split
    from sklearn.neighbors import LocalOutlierFactor
    from sklearn.neural_network import MLPRegressor
    from sklearn.preprocessing import StandardScaler
except ModuleNotFoundError:  # pragma: no cover - available inside the ai-layer Docker image.
    IsolationForest = None
    RandomForestClassifier = None
    LocalOutlierFactor = None
    MLPRegressor = None
    StandardScaler = None
    accuracy_score = None
    classification_report = None
    confusion_matrix = None
    train_test_split = None

try:
    import joblib
except ModuleNotFoundError:  # pragma: no cover - Docker image installs joblib through scikit-learn.
    joblib = None


EVENT_LEVEL_ANOMALIES = [
    "TIMEOUT",
    "SLA_BREACH",
    "SERVER_ERROR",
    "PROVIDER_UNREACHABLE",
    "ACCESS_DENIED",
    "RATE_LIMIT_EXCEEDED",
    "MISSING_CORRELATION_ID",
    "MISSING_LATENCY_METRIC",
    "RESPONSE_TIME_SPIKE",
    "DUPLICATE_EVENT",
    "CORRUPTED_EVENT_PAYLOAD",
]


EVENT_LEVEL_PRIORITY = {
    "PROVIDER_UNREACHABLE": 1,
    "TIMEOUT": 2,
    "SERVER_ERROR": 3,
    "ACCESS_DENIED": 4,
    "RATE_LIMIT_EXCEEDED": 5,
    "CORRUPTED_EVENT_PAYLOAD": 6,
    "MISSING_CORRELATION_ID": 7,
    "MISSING_LATENCY_METRIC": 8,
    "DUPLICATE_EVENT": 9,
    "RESPONSE_TIME_SPIKE": 10,
    "SLA_BREACH": 11,
}


EVENT_LEVEL_RULE_DEFINITIONS = [
    {
        "anomaly_type": "SLA_BREACH",
        "condition": "is_sla_breach is true",
        "confidence": 0.88,
    },
    {
        "anomaly_type": "RESPONSE_TIME_SPIKE",
        "condition": "latency_ratio >= 1.25",
        "confidence": 0.84,
    },
    {
        "anomaly_type": "PROVIDER_UNREACHABLE",
        "condition": "status_code in 502, 503",
        "confidence": 0.86,
    },
    {
        "anomaly_type": "SERVER_ERROR",
        "condition": "status_code >= 500 except 502, 503, 504 timeout priority",
        "confidence": 0.86,
    },
    {
        "anomaly_type": "TIMEOUT",
        "condition": "error_type timeout or status_code 504",
        "confidence": 0.90,
    },
    {
        "anomaly_type": "ACCESS_DENIED",
        "condition": "status_code 401/403, access_denied, denied/failure audit outcome",
        "confidence": 0.85,
    },
    {
        "anomaly_type": "RATE_LIMIT_EXCEEDED",
        "condition": "status_code 429 or error_type rate_limit_exceeded",
        "confidence": 0.78,
    },
    {
        "anomaly_type": "MISSING_LATENCY_METRIC",
        "condition": "latency_ms missing or explicit missing latency signal",
        "confidence": 0.82,
    },
    {
        "anomaly_type": "MISSING_CORRELATION_ID",
        "condition": "correlation_id and anomaly_correlation_id missing or explicit missing correlation signal",
        "confidence": 0.82,
    },
    {
        "anomaly_type": "DUPLICATE_EVENT",
        "condition": "duplicate_event marker in error_type/action/metadata",
        "confidence": 0.80,
    },
    {
        "anomaly_type": "CORRUPTED_EVENT_PAYLOAD",
        "condition": "corrupted payload marker in error_type/action/error_code",
        "confidence": 0.84,
    },
]


SIMULATION_TO_EVENT_LABEL = {
    "sla_breach": "SLA_BREACH",
    "response_time_spike": "RESPONSE_TIME_SPIKE",
    "provider_unreachable": "PROVIDER_UNREACHABLE",
    "repeated_502_errors": "PROVIDER_UNREACHABLE",
    "access_denied_anomaly": "ACCESS_DENIED",
    "unauthorized_api_attempt": "ACCESS_DENIED",
    "authentication_abuse": "ACCESS_DENIED",
    "token_failure_pattern": "ACCESS_DENIED",
    "rate_limit_exceeded": "RATE_LIMIT_EXCEEDED",
    "corrupted_event_payload": "CORRUPTED_EVENT_PAYLOAD",
    "duplicate_event": "DUPLICATE_EVENT",
    "missing_correlation_id": "MISSING_CORRELATION_ID",
    "missing_latency_metric": "MISSING_LATENCY_METRIC",
}


EVENT_RANDOM_FOREST_LABELS = {
    "NORMAL",
    *EVENT_LEVEL_ANOMALIES,
}


EVENT_LEVEL_COMPATIBLE_LABELS = {
    *EVENT_RANDOM_FOREST_LABELS,
    *SIMULATION_TO_EVENT_LABEL.keys(),
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

        raw_latency = record.get("latency_ms")
        status_code = int(record.get("status_code") or 0)
        error_type = str(record.get("error_type") or "").lower()
        action = str(record.get("action") or "").lower()
        outcome = str(record.get("outcome") or "").lower()
        error_code = str(record.get("error_code") or "").lower()
        correlation_id = record.get("correlation_id") or record.get("anomaly_correlation_id")
        metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}

        detections: list[dict[str, Any]] = []

        if record.get("is_sla_breach"):
            detections.append(self._detection("SLA_BREACH", 0.88, "The event breached the configured SLA latency."))

        if latency_ratio is not None and float(latency_ratio) >= 1.25:
            detections.append(self._detection("RESPONSE_TIME_SPIKE", 0.84, "Latency is significantly above the SLA target."))

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

        if raw_latency is None or error_type == "missing_latency_metric" or action == "missing_latency_metric" or error_code.endswith("missing_latency_metric_signal"):
            detections.append(self._detection("MISSING_LATENCY_METRIC", 0.82, "The event does not contain a usable latency metric."))

        if not correlation_id or error_type == "missing_correlation_id" or action == "missing_correlation_id" or error_code.endswith("missing_correlation_id_signal"):
            detections.append(self._detection("MISSING_CORRELATION_ID", 0.82, "The event is missing a correlation identifier."))

        if error_type in {"duplicate_event", "duplicate"} or action == "duplicate_event" or metadata.get("duplicate") is True:
            detections.append(self._detection("DUPLICATE_EVENT", 0.8, "The event is marked as a duplicate technical event."))

        if (
            error_type in {"corrupted_event_payload", "corrupted_payload", "payload_corruption"}
            or action in {"corrupted_event_payload", "corrupted_payload"}
            or error_code.endswith("corrupted_payload")
        ):
            detections.append(self._detection("CORRUPTED_EVENT_PAYLOAD", 0.84, "The event payload is corrupted or technically inconsistent."))

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
    anomaly_types = EVENT_LEVEL_ANOMALIES
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

        if RandomForestClassifier is None or accuracy_score is None or classification_report is None or confusion_matrix is None or train_test_split is None:
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
        report = classification_report(y_test, predictions, output_dict=True, zero_division=0)
        macro = report.get("macro avg", {})
        labels_order = sorted(set(labels))
        matrix = confusion_matrix(y_test, predictions, labels=labels_order).tolist()
        normal_index = labels_order.index("NORMAL") if "NORMAL" in labels_order else 0
        tp = fp = tn = fn = 0
        for actual_index, row in enumerate(matrix):
            for predicted_index, value in enumerate(row):
                actual_anomaly = actual_index != normal_index
                predicted_anomaly = predicted_index != normal_index
                if actual_anomaly and predicted_anomaly:
                    tp += value
                elif not actual_anomaly and predicted_anomaly:
                    fp += value
                elif not actual_anomaly and not predicted_anomaly:
                    tn += value
                elif actual_anomaly and not predicted_anomaly:
                    fn += value
        precision = float(macro.get("precision", 0.0))
        recall = float(macro.get("recall", 0.0))
        f1 = float(macro.get("f1-score", 0.0))
        self.save()

        return {
            "model_id": self.model_id,
            "status": "trained",
            "sample_count": len(rows),
            "labelled_sample_count": len(labelled_rows),
            "labels": self.labels,
            "metrics": {
                "accuracy": round(float(accuracy_score(y_test, predictions)), 4),
                "precision": round(precision, 4),
                "recall": round(recall, 4),
                "f1_score": round(f1, 4),
                "classification_report": report,
                "confusion_labels": labels_order,
                "confusion_matrix": matrix,
                "true_positive": tp,
                "false_positive": fp,
                "true_negative": tn,
                "false_negative": fn,
                "labelled_eval_count": len(y_test),
                "false_positive_rate": round(fp / max(1, fp + tn), 4),
                "false_negative_rate": round(fn / max(1, fn + tp), 4),
                "validation_match_rate": round((tp + tn) / max(1, tp + fp + tn + fn), 4),
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
        analysis_level = str(record.get("analysis_level") or "").lower()
        if analysis_level and analysis_level != "event":
            return None

        label = record.get("label") or record.get("anomaly_type") or record.get("detected_anomaly_type")
        if label:
            raw_label = str(label).lower()
            normalized = SIMULATION_TO_EVENT_LABEL.get(raw_label, str(label).upper())
            if normalized in {"NORMAL", "NONE", "NULL"}:
                return "NORMAL"
            return normalized if normalized in EVENT_RANDOM_FOREST_LABELS else None

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


class _TrainableEventOutlierModel(BaseAIModel):
    family = "event_level"
    supported_analysis_levels = ["event"]
    is_mock = False
    status = "experimental"
    normal_label = "NORMAL"
    default_anomaly_type = "EVENT_OUTLIER_SIGNAL"

    def __init__(self, model_dir: str = "/app/models") -> None:
        super().__init__(model_dir)
        self.model: Any | None = None
        self.scaler: Any | None = None
        self.threshold: float | None = None
        self.training_sample_count = 0

    def _training_rows(self, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        compatible_rows = [row for row in records if not row.get("analysis_level") or str(row.get("analysis_level")).lower() == "event"]
        normal_rows = [row for row in compatible_rows if EventLevelRandomForestModel._label_for(row) == self.normal_label]
        return normal_rows if len(normal_rows) >= 20 else compatible_rows

    def _scaled_features(self, records: list[dict[str, Any]]) -> list[list[float]]:
        return [EventLevelRandomForestModel._feature_vector(record) for record in records]

    def _fit_scaler(self, features: list[list[float]]) -> list[list[float]]:
        if StandardScaler is None:
            return features
        self.scaler = StandardScaler()
        return self.scaler.fit_transform(features).tolist()

    def _transform_one(self, record: dict[str, Any]) -> list[list[float]]:
        features = [EventLevelRandomForestModel._feature_vector(record)]
        if self.scaler is not None:
            return self.scaler.transform(features).tolist()
        return features

    def _event_anomaly_type(self, record: dict[str, Any]) -> str:
        return EventLevelRandomForestModel._label_for(record) or self.default_anomaly_type

    def _binary_metrics(self, records: list[dict[str, Any]]) -> dict[str, float]:
        labelled = [row for row in records if EventLevelRandomForestModel._label_for(row)]
        if not labelled:
            return {}

        tp = fp = tn = fn = 0
        for row in labelled:
            expected_anomaly = EventLevelRandomForestModel._label_for(row) != self.normal_label
            predicted_anomaly = bool(self.predict(row).get("anomaly_detected"))
            if expected_anomaly and predicted_anomaly:
                tp += 1
            elif not expected_anomaly and predicted_anomaly:
                fp += 1
            elif not expected_anomaly and not predicted_anomaly:
                tn += 1
            else:
                fn += 1

        total = max(1, tp + fp + tn + fn)
        precision = tp / max(1, tp + fp)
        recall = tp / max(1, tp + fn)
        f1 = 2 * precision * recall / max(0.000001, precision + recall)
        return {
            "true_positive": tp,
            "false_positive": fp,
            "true_negative": tn,
            "false_negative": fn,
            "accuracy": round((tp + tn) / total, 4),
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1_score": round(f1, 4),
            "false_positive_rate": round(fp / max(1, fp + tn), 4),
            "false_negative_rate": round(fn / max(1, fn + tp), 4),
            "validation_match_rate": round((tp + tn) / total, 4),
            "labelled_eval_count": len(labelled),
        }

    @staticmethod
    def _percentile(values: list[float], percentile: float) -> float:
        if not values:
            return 0.0
        sorted_values = sorted(values)
        index = min(len(sorted_values) - 1, max(0, int(round((len(sorted_values) - 1) * percentile))))
        return float(sorted_values[index])

    def save(self) -> dict[str, Any]:
        if self.model is not None and joblib is not None:
            joblib.dump(
                {
                    "model": self.model,
                    "scaler": self.scaler,
                    "threshold": self.threshold,
                    "training_sample_count": self.training_sample_count,
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
            self.scaler = payload.get("scaler")
            self.threshold = payload.get("threshold")
            self.training_sample_count = int(payload.get("training_sample_count") or 0)
            self.is_trained = self.model is not None
            return {"model_id": self.model_id, "loaded": self.is_trained, "path": str(model_path)}
        return super().load()


class EventLevelIsolationForestModel(_TrainableEventOutlierModel):
    model_id = "event_isolation_forest"
    model_name = "Event-Level Isolation Forest"
    model_type = "unsupervised"
    status = "experimental"
    version = "0.2.0"
    objective = "Detecter les evenements individuels rares sans labels."
    anomaly_types = ["EVENT_ISOLATION_FOREST_SIGNAL", "RESPONSE_TIME_SPIKE", "SERVER_ERROR", "TIMEOUT"]
    default_anomaly_type = "EVENT_ISOLATION_FOREST_SIGNAL"

    def train(self, records: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        rows = records or []
        options = rows[0].get("_training_options") if rows and isinstance(rows[0].get("_training_options"), dict) else {}
        dataset_mode = str(options.get("dataset_mode") or "normal_only")
        compatible_rows = [row for row in rows if not row.get("analysis_level") or str(row.get("analysis_level")).lower() == "event"]
        if dataset_mode == "mixed":
            training_rows = compatible_rows
        elif dataset_mode == "recent":
            training_rows = compatible_rows[-int(options.get("sample_size") or len(compatible_rows)) :]
        else:
            training_rows = self._training_rows(rows)

        contamination = min(0.25, max(0.001, float(options.get("contamination") or 0.035)))
        random_state = int(options.get("random_state") or 42)
        bootstrap = bool(options.get("bootstrap", False))
        max_samples = options.get("max_samples") or "auto"
        if isinstance(max_samples, str) and max_samples != "auto":
            try:
                max_samples = float(max_samples) if "." in max_samples else int(max_samples)
            except ValueError:
                max_samples = "auto"

        if IsolationForest is None or StandardScaler is None or joblib is None:
            return {"model_id": self.model_id, "status": "dependency_missing", "dependency": "scikit-learn/joblib"}
        if len(training_rows) < 20:
            return {"model_id": self.model_id, "status": "not_enough_data", "sample_count": len(rows), "required": 20}

        features = self._fit_scaler(self._scaled_features(training_rows))
        self.model = IsolationForest(
            n_estimators=160,
            contamination=contamination,
            random_state=random_state,
            max_samples=max_samples,
            bootstrap=bootstrap,
        )
        self.model.fit(features)
        self.training_sample_count = len(training_rows)
        self.is_trained = True
        train_predictions = self.model.predict(features)
        decision_scores = [float(value) for value in self.model.decision_function(features)]
        anomaly_scores = [self._isolation_intensity(score) for score, prediction in zip(decision_scores, train_predictions) if prediction == -1]
        normal_scores = [self._isolation_intensity(score) for score, prediction in zip(decision_scores, train_predictions) if prediction != -1]
        anomaly_rate = sum(1 for value in train_predictions if value == -1) / len(train_predictions)
        self.save()

        metrics = {
            "anomaly_rate": round(anomaly_rate, 4),
            "observed_anomaly_ratio": round(anomaly_rate, 4),
            "contamination_rate": round(contamination, 4),
            "score_threshold": round(contamination, 4),
            "avg_anomaly_score": round(sum(anomaly_scores) / max(1, len(anomaly_scores)), 2),
            "avg_normal_score": round(sum(normal_scores) / max(1, len(normal_scores)), 2),
            "stability": round(1 - anomaly_rate, 4),
            "dataset_mode": dataset_mode,
            "bootstrap": bootstrap,
        }
        metrics.update(self._binary_metrics(rows))
        return {
            "model_id": self.model_id,
            "status": "trained",
            "sample_count": len(rows),
            "training_sample_count": len(training_rows),
            "metrics": metrics,
        }

    @staticmethod
    def _isolation_intensity(decision_score: float) -> float:
        # IsolationForest decision_function is positive for normal points and negative near isolated outliers.
        return round(min(100.0, max(0.0, (0.5 - decision_score) * 100)), 2)

    def predict(self, record: dict[str, Any]) -> dict[str, Any]:
        if self.model is None:
            self.load()
        if self.model is None:
            return self.default_prediction(record, False, "NORMAL", 0.0, "Event-Level Isolation Forest is not trained yet.")

        features = self._transform_one(record)
        is_anomaly = int(self.model.predict(features)[0]) == -1
        decision = float(self.model.decision_function(features)[0])
        score = min(0.98, max(0.55, 0.62 + abs(decision))) if is_anomaly else 0.0
        anomaly_type = self._event_anomaly_type(record) if is_anomaly else "NORMAL"
        return self.default_prediction(
            record,
            anomaly_detected=is_anomaly,
            anomaly_type=anomaly_type,
            score=score,
            explanation=f"{self.model_name} signale un evenement rare par isolation statistique.",
        )


class EventLevelLocalOutlierFactorModel(_TrainableEventOutlierModel):
    model_id = "event_lof"
    model_name = "Event-Level Local Outlier Factor"
    model_type = "unsupervised"
    status = "experimental"
    version = "0.2.0"
    objective = "Detecter les outliers locaux sur un evenement par comparaison a son voisinage."
    anomaly_types = ["EVENT_LOF_SIGNAL", "RESPONSE_TIME_SPIKE", "MISSING_CORRELATION_ID", "CORRUPTED_EVENT_PAYLOAD"]
    default_anomaly_type = "EVENT_LOF_SIGNAL"

    def train(self, records: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        rows = records or []
        options = rows[0].get("_training_options") if rows and isinstance(rows[0].get("_training_options"), dict) else {}
        dataset_mode = str(options.get("dataset_mode") or "normal_only")
        compatible_rows = [row for row in rows if not row.get("analysis_level") or str(row.get("analysis_level")).lower() == "event"]
        if dataset_mode == "mixed":
            training_rows = compatible_rows
        elif dataset_mode == "recent":
            training_rows = compatible_rows[-int(options.get("sample_size") or len(compatible_rows)) :]
        else:
            training_rows = self._training_rows(rows)
        if LocalOutlierFactor is None or StandardScaler is None or joblib is None:
            return {"model_id": self.model_id, "status": "dependency_missing", "dependency": "scikit-learn/joblib"}
        if len(training_rows) < 30:
            return {"model_id": self.model_id, "status": "not_enough_data", "sample_count": len(rows), "required": 30}

        features = self._fit_scaler(self._scaled_features(training_rows))
        requested_neighbors = options.get("n_neighbors")
        neighbors = int(requested_neighbors) if requested_neighbors else min(35, max(5, len(training_rows) // 20))
        neighbors = min(max(5, neighbors), max(5, len(training_rows) - 1))
        contamination = min(0.25, max(0.001, float(options.get("contamination") or 0.035)))
        self.model = LocalOutlierFactor(n_neighbors=neighbors, contamination=contamination, novelty=True)
        self.model.fit(features)
        self.training_sample_count = len(training_rows)
        self.is_trained = True
        train_predictions = self.model.predict(features)
        anomaly_rate = sum(1 for value in train_predictions if value == -1) / len(train_predictions)
        self.save()

        metrics = {
            "anomaly_rate": round(anomaly_rate, 4),
            "contamination_rate": contamination,
            "stability": round(1 - anomaly_rate, 4),
            "n_neighbors": neighbors,
            "dataset_mode": dataset_mode,
        }
        metrics.update(self._binary_metrics(rows))
        return {
            "model_id": self.model_id,
            "status": "trained",
            "sample_count": len(rows),
            "training_sample_count": len(training_rows),
            "metrics": metrics,
        }

    def predict(self, record: dict[str, Any]) -> dict[str, Any]:
        if self.model is None:
            self.load()
        if self.model is None:
            return self.default_prediction(record, False, "NORMAL", 0.0, "Event-Level LOF is not trained yet.")

        features = self._transform_one(record)
        is_anomaly = int(self.model.predict(features)[0]) == -1
        decision = float(self.model.decision_function(features)[0])
        score = min(0.98, max(0.55, 0.64 + abs(decision))) if is_anomaly else 0.0
        anomaly_type = self._event_anomaly_type(record) if is_anomaly else "NORMAL"
        return self.default_prediction(
            record,
            anomaly_detected=is_anomaly,
            anomaly_type=anomaly_type,
            score=score,
            explanation=f"{self.model_name} detecte un outlier local par densite de voisinage.",
        )


class EventLevelAutoencoderMLPModel(_TrainableEventOutlierModel):
    model_id = "event_autoencoder_mlp"
    model_name = "Event-Level MLP Autoencoder"
    model_type = "deep_learning"
    status = "experimental"
    version = "0.2.0"
    objective = "Detecter les evenements atypiques par erreur de reconstruction."
    anomaly_types = ["EVENT_AUTOENCODER_SIGNAL", "RESPONSE_TIME_SPIKE", "MISSING_LATENCY_METRIC", "CORRUPTED_EVENT_PAYLOAD"]
    default_anomaly_type = "EVENT_AUTOENCODER_SIGNAL"

    def train(self, records: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        rows = records or []
        options = rows[0].get("_training_options") if rows and isinstance(rows[0].get("_training_options"), dict) else {}
        dataset_mode = str(options.get("dataset_mode") or "normal_only")
        compatible_rows = [row for row in rows if not row.get("analysis_level") or str(row.get("analysis_level")).lower() == "event"]
        if dataset_mode == "mixed":
            training_rows = compatible_rows
        elif dataset_mode == "recent":
            training_rows = compatible_rows[-int(options.get("sample_size") or len(compatible_rows)) :]
        else:
            training_rows = self._training_rows(rows)
        if MLPRegressor is None or StandardScaler is None or joblib is None:
            return {"model_id": self.model_id, "status": "dependency_missing", "dependency": "scikit-learn/joblib"}
        if len(training_rows) < 30:
            return {"model_id": self.model_id, "status": "not_enough_data", "sample_count": len(rows), "required": 30}

        features = self._fit_scaler(self._scaled_features(training_rows))
        max_iter = int(options.get("max_iter") or 300)
        self.model = MLPRegressor(
            hidden_layer_sizes=(8, 4, 8),
            activation="relu",
            solver="adam",
            max_iter=max_iter,
            random_state=42,
            early_stopping=True,
        )
        self.model.fit(features, features)
        reconstruction_errors = [self._reconstruction_error_vector(row) for row in features]
        self.threshold = self._percentile(reconstruction_errors, 0.965)
        self.training_sample_count = len(training_rows)
        self.is_trained = True
        self.save()

        metrics = {
            "loss": round(float(getattr(self.model, "loss_", 0.0) or 0.0), 6),
            "reconstruction_error": round(sum(reconstruction_errors) / len(reconstruction_errors), 6),
            "detection_threshold": round(float(self.threshold), 6),
            "stability": 0.86,
            "dataset_mode": dataset_mode,
            "max_iter": max_iter,
        }
        metrics.update(self._binary_metrics(rows))
        return {
            "model_id": self.model_id,
            "status": "trained",
            "sample_count": len(rows),
            "training_sample_count": len(training_rows),
            "metrics": metrics,
        }

    def predict(self, record: dict[str, Any]) -> dict[str, Any]:
        if self.model is None:
            self.load()
        if self.model is None or self.threshold is None:
            return self.default_prediction(record, False, "NORMAL", 0.0, "Event-Level Autoencoder MLP is not trained yet.")

        features = self._transform_one(record)
        error = self._reconstruction_error_vector(features[0])
        is_anomaly = error > float(self.threshold)
        ratio = error / max(0.000001, float(self.threshold))
        score = min(0.98, max(0.55, 0.55 + (ratio - 1) * 0.25)) if is_anomaly else 0.0
        anomaly_type = self._event_anomaly_type(record) if is_anomaly else "NORMAL"
        return self.default_prediction(
            record,
            anomaly_detected=is_anomaly,
            anomaly_type=anomaly_type,
            score=score,
            explanation=f"{self.model_name} detecte une erreur de reconstruction anormale ({error:.4f}).",
        )

    def _reconstruction_error_vector(self, features: list[float]) -> float:
        if self.model is None:
            return 0.0
        predicted = self.model.predict([features])[0]
        return float(sum((float(expected) - float(actual)) ** 2 for expected, actual in zip(features, predicted)) / len(features))
