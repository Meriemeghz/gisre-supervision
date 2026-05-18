from __future__ import annotations

from app.ai_models.simple_models import MockExperimentalModel


class ADWINModel(MockExperimentalModel):
    model_id = "adwin"
    model_name = "ADWIN"
    model_type = "streaming"
    family = "streaming_online"
    status = "experimental"
    version = "0.1.0"
    objective = "Detecter les changements de distribution en flux continu."
    anomaly_types = ["STREAM_ADWIN_DRIFT", "LATENCY_DRIFT"]
    default_anomaly_type = "STREAM_ADWIN_DRIFT"


class HalfSpaceTreesModel(MockExperimentalModel):
    model_id = "half_space_trees"
    model_name = "Half-Space Trees"
    model_type = "streaming"
    family = "streaming_online"
    status = "experimental"
    version = "0.1.0"
    objective = "Detecter les anomalies online avec des arbres aleatoires."
    anomaly_types = ["STREAM_HST_ANOMALY", "TRAFFIC_SPIKE"]
    default_anomaly_type = "STREAM_HST_ANOMALY"


class RiverModel(MockExperimentalModel):
    model_id = "river_online"
    model_name = "River Online Model"
    model_type = "streaming"
    family = "streaming_online"
    status = "experimental"
    version = "0.1.0"
    objective = "Preparer l'integration progressive de modeles River."
    anomaly_types = ["STREAM_RIVER_ANOMALY"]
    default_anomaly_type = "STREAM_RIVER_ANOMALY"
