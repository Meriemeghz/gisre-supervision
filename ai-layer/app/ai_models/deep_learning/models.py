from __future__ import annotations

from app.ai_models.simple_models import MockExperimentalModel, ThresholdModel


class MLPAutoencoderModel(ThresholdModel):
    model_id = "autoencoder_mlp"
    model_name = "MLP Autoencoder"
    model_type = "deep_learning"
    family = "deep_learning"
    status = "active"
    version = "1.0.0"
    objective = "Detecter les anomalies par erreur de reconstruction."
    anomaly_types = ["ML_AUTOENCODER", "DATA_CONSISTENCY_SIGNAL", "LATENCY_SPIKE"]
    is_mock = False
    threshold = 0.69
    default_anomaly_type = "ML_AUTOENCODER"


class GRUAutoencoderModel(MockExperimentalModel):
    model_id = "gru_autoencoder"
    model_name = "GRU Autoencoder"
    model_type = "deep_learning"
    family = "deep_learning"
    status = "experimental"
    version = "0.2.0"
    objective = "Analyser les sequences temporelles de latence et d'erreurs."
    anomaly_types = ["DL_GRU_SEQUENCE", "LATENCY_DRIFT", "PROVIDER_SLOWDOWN"]
    default_anomaly_type = "DL_GRU_SEQUENCE"


class LSTMAutoencoderModel(MockExperimentalModel):
    model_id = "lstm_autoencoder"
    model_name = "LSTM Autoencoder"
    model_type = "deep_learning"
    family = "deep_learning"
    status = "experimental"
    version = "0.1.0"
    objective = "Detecter des derives temporelles longues sur les flux GISRE."
    anomaly_types = ["DL_LSTM_SEQUENCE", "LATENCY_DRIFT"]
    default_anomaly_type = "DL_LSTM_SEQUENCE"


class VariationalAutoencoderModel(MockExperimentalModel):
    model_id = "variational_autoencoder"
    model_name = "Variational Autoencoder"
    model_type = "deep_learning"
    family = "deep_learning"
    status = "experimental"
    version = "0.1.0"
    objective = "Modeliser la distribution normale et detecter les ecarts probabilistes."
    anomaly_types = ["DL_VAE_ANOMALY", "DATA_CONSISTENCY_SIGNAL"]
    default_anomaly_type = "DL_VAE_ANOMALY"
