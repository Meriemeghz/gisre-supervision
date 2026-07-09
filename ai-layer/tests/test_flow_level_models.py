from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta, timezone

from app.ai_models.flow_level.models import (
    FlowAutoencoderModel,
    FlowGRUProfileModel,
    FlowKMeansProfileModel,
)


def flow_rows(flow_code: str, count: int, latency_ratio: float = 0.8) -> list[dict]:
    started_at = datetime(2026, 6, 1, tzinfo=timezone.utc)
    return [
        {
            "flow_code": flow_code,
            "called_at": (started_at + timedelta(seconds=index)).isoformat(),
            "latency_ms": latency_ratio * 300,
            "sla_latency_ms": 300,
            "status_code": 200,
            "success": True,
            "is_sla_breach": False,
            "is_anomaly": False,
            "flow_criticality": "medium",
            "metadata": {"retry_count": 0},
        }
        for index in range(count)
    ]


class FlowLevelModelTests(unittest.TestCase):
    def test_flow_profiles_are_aggregated_per_flow(self) -> None:
        rows = flow_rows("F1", 6) + flow_rows("F2", 6, latency_ratio=1.1)

        profiles = FlowKMeansProfileModel._profiles_from_records(rows)

        self.assertEqual(len(profiles), 2)
        self.assertEqual(len(profiles[0]["features"]), 7)

    def test_gru_training_sequences_use_successive_flow_windows(self) -> None:
        rows = flow_rows("F1", 40) + flow_rows("F2", 40, latency_ratio=1.05)

        sequences, targets = FlowGRUProfileModel._build_training_sequences(
            rows,
            sequence_length=3,
            window_events=5,
        )

        self.assertEqual(len(sequences), 10)
        self.assertEqual(len(sequences[0]), 3)
        self.assertEqual(len(sequences[0][0]), 7)
        self.assertEqual(len(targets[0]), 7)

    def test_real_models_require_real_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as model_dir:
            autoencoder = FlowAutoencoderModel(model_dir)
            gru = FlowGRUProfileModel(model_dir)

            self.assertFalse(autoencoder.load()["loaded"])
            self.assertFalse(gru.load()["loaded"])
            self.assertFalse(autoencoder.is_trained)
            self.assertFalse(gru.is_trained)


if __name__ == "__main__":
    unittest.main()
