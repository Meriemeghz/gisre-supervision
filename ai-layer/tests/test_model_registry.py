from app.ai_models.factory import ModelFactory
from app.ai_models.registry import ModelRegistry


def test_all_registered_models_are_loadable(tmp_path):
    factory = ModelFactory(tmp_path)
    model_classes = ModelRegistry.list_model_classes()

    assert len(model_classes) >= 20

    for model_class in model_classes:
        model = factory.create(model_class.model_id)
        metadata = model.get_metadata()
        assert metadata["id"] == model_class.model_id
        assert "predict" in metadata["functions"]


def test_prediction_contract(tmp_path):
    factory = ModelFactory(tmp_path)
    model = factory.create("isolation_forest")
    prediction = model.predict({
        "latency_ms": 950,
        "sla_latency_ms": 300,
        "status_code": 504,
        "success": False,
        "error_type": "timeout",
    })

    assert prediction["anomaly_detected"] is True
    assert prediction["anomaly_type"] == "TIMEOUT"
    assert prediction["model_id"] == "isolation_forest"
    assert 0 <= prediction["risk_score"] <= 100
