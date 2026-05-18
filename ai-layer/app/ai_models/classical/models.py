from __future__ import annotations

from app.ai_models.simple_models import ThresholdModel


class IsolationForestModel(ThresholdModel):
    model_id = "isolation_forest"
    model_name = "Isolation Forest"
    model_type = "unsupervised"
    family = "classical_ml"
    status = "active"
    version = "1.0.0"
    objective = "Detecter les evenements rares dans les appels API GISRE."
    anomaly_types = ["ML_ISOLATION_FOREST", "SLA_BREACH", "SERVER_ERROR", "TIMEOUT"]
    is_mock = False
    threshold = 0.62
    default_anomaly_type = "ML_ISOLATION_FOREST"


class OneClassSVMModel(ThresholdModel):
    model_id = "one_class_svm"
    model_name = "One-Class SVM"
    model_type = "unsupervised"
    family = "classical_ml"
    status = "active"
    version = "1.0.0"
    objective = "Identifier les ecarts par rapport a la zone normale apprise."
    anomaly_types = ["ML_ONE_CLASS_SVM", "LATENCY_DRIFT", "PROVIDER_SLOWDOWN"]
    is_mock = False
    threshold = 0.68
    default_anomaly_type = "ML_ONE_CLASS_SVM"


class LocalOutlierFactorModel(ThresholdModel):
    model_id = "local_outlier_factor"
    model_name = "Local Outlier Factor"
    model_type = "unsupervised"
    family = "classical_ml"
    status = "experimental"
    version = "0.1.0"
    objective = "Detecter les anomalies locales par densite de voisinage."
    anomaly_types = ["ML_LOCAL_OUTLIER_FACTOR", "TRAFFIC_SPIKE", "LATENCY_SPIKE"]
    is_mock = True
    threshold = 0.7
    default_anomaly_type = "ML_LOCAL_OUTLIER_FACTOR"


class KMeansModel(ThresholdModel):
    model_id = "kmeans"
    model_name = "K-Means"
    model_type = "unsupervised"
    family = "classical_ml"
    status = "active"
    version = "1.0.0"
    objective = "Regrouper les profils de trafic et detecter les clusters rares."
    anomaly_types = ["ML_KMEANS_CLUSTER", "TRAFFIC_SPIKE"]
    is_mock = False
    threshold = 0.66
    default_anomaly_type = "ML_KMEANS_CLUSTER"


class RandomForestModel(ThresholdModel):
    model_id = "random_forest_classifier"
    model_name = "Random Forest Classifier"
    model_type = "supervised"
    family = "classical_ml"
    status = "active"
    version = "1.0.0"
    objective = "Classifier les anomalies connues a partir de signaux etiquetes."
    anomaly_types = ["TIMEOUT", "SLA_BREACH", "ACCESS_DENIED", "SERVER_ERROR", "PROVIDER_UNREACHABLE"]
    is_mock = False
    threshold = 0.6
    default_anomaly_type = "ML_RANDOM_FOREST"
