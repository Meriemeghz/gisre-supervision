from __future__ import annotations

from app.ai_models.simple_models import MockExperimentalModel


class TranADModel(MockExperimentalModel):
    model_id = "tranad"
    model_name = "TranAD"
    model_type = "transformer"
    family = "transformers"
    status = "experimental"
    version = "0.1.0"
    objective = "Detecter les anomalies multivariees par attention temporelle."
    anomaly_types = ["TRANSFORMER_TRANAD_ANOMALY", "PROVIDER_SLOWDOWN"]
    default_anomaly_type = "TRANSFORMER_TRANAD_ANOMALY"


class AnomalyTransformerModel(MockExperimentalModel):
    model_id = "anomaly_transformer"
    model_name = "Anomaly Transformer"
    model_type = "transformer"
    family = "transformers"
    status = "experimental"
    version = "0.1.0"
    objective = "Comparer association temporelle normale et anormale."
    anomaly_types = ["TRANSFORMER_ATTENTION_ANOMALY", "LATENCY_DRIFT"]
    default_anomaly_type = "TRANSFORMER_ATTENTION_ANOMALY"


class LogBERTModel(MockExperimentalModel):
    model_id = "logbert"
    model_name = "LogBERT"
    model_type = "transformer"
    family = "transformers"
    status = "experimental"
    version = "0.1.0"
    objective = "Detecter les sequences anormales dans les journaux et audits."
    anomaly_types = ["TRANSFORMER_LOGBERT_ANOMALY", "SECURITY_FAILURE_BURST"]
    default_anomaly_type = "TRANSFORMER_LOGBERT_ANOMALY"
