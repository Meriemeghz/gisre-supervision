from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.ai_models.registry import ModelRegistry
from app.services.model_activation_policy import ModelActivationPolicy


class ModelActivationPolicyTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.model_dir = Path(self.temporary_directory.name)
        self.registry_patch = patch.object(ModelRegistry, "get_model_class", return_value=None)
        self.registry_patch.start()

    def tearDown(self) -> None:
        self.registry_patch.stop()
        self.temporary_directory.cleanup()

    def test_default_active_models_are_persisted(self) -> None:
        policy = ModelActivationPolicy(self.model_dir)

        self.assertEqual(policy.active_model_id("event"), "event_rules_engine")
        self.assertEqual(policy.active_model_id("flow"), "flow_rules_engine")
        self.assertEqual(policy.active_model_id("temporal"), "temporal_rules_engine")
        self.assertEqual(policy.active_model_id("graph"), "graph_rules_engine")
        self.assertTrue((self.model_dir / "analysis_model_policy.json").exists())

    def test_temporal_legacy_policy_without_active_model_falls_back_to_rules_engine(self) -> None:
        policy_path = self.model_dir / "analysis_model_policy.json"
        policy_path.write_text(
            json.dumps(
                {
                    "temporal": {
                        "active_model_id": None,
                        "models": {
                            "temporal_rules_engine": {"enabled": True},
                            "temporal_gru_sequence": {"enabled": True},
                            "temporal_lstm_sequence": {"enabled": False},
                            "temporal_tranad": {"enabled": False},
                        },
                    }
                }
            ),
            encoding="utf-8",
        )

        policy = ModelActivationPolicy(self.model_dir)
        stored = json.loads(policy_path.read_text(encoding="utf-8"))

        self.assertEqual(policy.active_model_id("temporal"), "temporal_rules_engine")
        self.assertEqual(stored["temporal"]["active_model_id"], "temporal_rules_engine")

    def test_enabled_update_does_not_clear_active_model(self) -> None:
        policy = ModelActivationPolicy(self.model_dir)

        policy.update_level(
            "event",
            None,
            {"event_random_forest": False},
            update_active=False,
        )

        self.assertEqual(policy.active_model_id("event"), "event_rules_engine")

    def test_disabled_model_cannot_become_active(self) -> None:
        policy = ModelActivationPolicy(self.model_dir)

        with self.assertRaisesRegex(ValueError, "Disabled model cannot be active"):
            policy.update_level("event", "event_lof")

    def test_setting_active_model_replaces_previous_selection(self) -> None:
        policy = ModelActivationPolicy(self.model_dir)

        updated = policy.update_level("event", "event_random_forest")

        self.assertEqual(updated["active_model_id"], "event_random_forest")
        self.assertEqual(policy.active_model_id("event"), "event_random_forest")
        active_models = [model["model_id"] for model in updated["models"] if model["active"]]
        self.assertEqual(active_models, ["event_random_forest"])

    def test_disabling_active_model_leaves_level_without_active_model(self) -> None:
        policy = ModelActivationPolicy(self.model_dir)

        updated = policy.update_level(
            "flow",
            None,
            {"flow_rules_engine": False},
            update_active=False,
        )

        self.assertIsNone(updated["active_model_id"])
        self.assertFalse(updated["available"])
        self.assertIsNone(policy.active_model_id("flow"))

    def test_policy_survives_reload(self) -> None:
        policy = ModelActivationPolicy(self.model_dir)
        policy.update_level("event", "event_isolation_forest")

        reloaded = ModelActivationPolicy(self.model_dir)
        stored = json.loads(
            (self.model_dir / "analysis_model_policy.json").read_text(encoding="utf-8")
        )

        self.assertEqual(reloaded.active_model_id("event"), "event_isolation_forest")
        self.assertEqual(stored["event"]["active_model_id"], "event_isolation_forest")


if __name__ == "__main__":
    unittest.main()
