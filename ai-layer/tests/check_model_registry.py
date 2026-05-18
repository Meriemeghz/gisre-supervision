from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.ai_models.factory import ModelFactory
from app.ai_models.registry import ModelRegistry


def main() -> None:
    factory = ModelFactory(ROOT / "models")
    model_classes = ModelRegistry.list_model_classes()
    print(f"registered_models={len(model_classes)}")

    for model_class in model_classes:
        model = factory.create(model_class.model_id)
        prediction = model.predict({
            "latency_ms": 720,
            "sla_latency_ms": 300,
            "status_code": 504,
            "success": False,
            "error_type": "timeout",
        })
        print(f"OK {model.model_id} -> {prediction['anomaly_type']} score={prediction['risk_score']}")


if __name__ == "__main__":
    main()
