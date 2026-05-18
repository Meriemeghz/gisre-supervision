from __future__ import annotations

from app.ai_models.simple_models import MockExperimentalModel


class GDNModel(MockExperimentalModel):
    model_id = "gdn"
    model_name = "Graph Deviation Network"
    model_type = "graph_ai"
    family = "graph_ai"
    status = "experimental"
    version = "0.1.0"
    objective = "Modeliser les relations entre APIs, producteurs et consommateurs."
    anomaly_types = ["GRAPH_GDN_ANOMALY", "PROVIDER_SLOWDOWN"]
    default_anomaly_type = "GRAPH_GDN_ANOMALY"


class MTADGATModel(MockExperimentalModel):
    model_id = "mtad_gat"
    model_name = "MTAD-GAT"
    model_type = "graph_ai"
    family = "graph_ai"
    status = "experimental"
    version = "0.1.0"
    objective = "Combiner attention temporelle et graphe de dependances."
    anomaly_types = ["GRAPH_MTAD_GAT_ANOMALY", "LATENCY_DRIFT"]
    default_anomaly_type = "GRAPH_MTAD_GAT_ANOMALY"


class TopoGDNModel(MockExperimentalModel):
    model_id = "topo_gdn"
    model_name = "TopoGDN"
    model_type = "graph_ai"
    family = "graph_ai"
    status = "experimental"
    version = "0.1.0"
    objective = "Exploiter la topologie GISRE pour detecter les ruptures de dependance."
    anomaly_types = ["GRAPH_TOPOLOGY_ANOMALY", "PROVIDER_UNREACHABLE"]
    default_anomaly_type = "GRAPH_TOPOLOGY_ANOMALY"
