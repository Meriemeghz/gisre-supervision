from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.ai_models.reinforcement.experience_memory import ExperienceMemory
from app.ai_models.reinforcement.reward_engine import RewardEngine
from app.ai_models.reinforcement.rl_decision_agent import RLDecisionAgent
from app.ai_models.reinforcement.rl_types import DecisionState


class RLDecisionAgentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = ExperienceMemory(model_storage_dir=self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def state(self, **overrides) -> DecisionState:
        base = {
            "anomaly_type": "SLA_BREACH",
            "anomaly_family": "Performance",
            "severity": "critical",
            "review_policy": "auto_confirmable",
            "baseline_decision": "PENDING_REVIEW",
            "event_level_detected": True,
            "flow_level_detected": True,
            "multi_level_agreement": True,
        }
        base.update(overrides)
        return DecisionState(**base)

    def agent(self, *, enabled=True, min_experiences=3, threshold=0.80) -> RLDecisionAgent:
        return RLDecisionAgent(
            enabled=enabled,
            min_experiences=min_experiences,
            confidence_threshold=threshold,
            epsilon=0.0,
            memory=self.memory,
        )

    def test_rl_disabled_uses_baseline_decision(self) -> None:
        decision = self.agent(enabled=False).adapt({"status": "PENDING_REVIEW", "reason": "baseline"}, self.state())
        self.assertEqual(decision["source"], "baseline")
        self.assertEqual(decision["status"], "PENDING_REVIEW")
        self.assertIsNone(decision["rl_action"])
        self.assertIn("disabled", decision["reason"])

    def test_rl_enabled_with_low_experience_keeps_baseline(self) -> None:
        decision = self.agent(enabled=True, min_experiences=30).adapt({"status": "PENDING_REVIEW"}, self.state())
        self.assertEqual(decision["source"], "baseline")
        self.assertEqual(decision["status"], "PENDING_REVIEW")
        self.assertEqual(decision["rl_confidence"], 0.0)

    def test_rl_enabled_with_strong_experience_can_adjust(self) -> None:
        agent = self.agent(enabled=True, min_experiences=3, threshold=0.75)
        state = self.state()
        for _ in range(5):
            agent.update_policy(state, "AUTO_CONFIRM", 1.0)
        decision = agent.adapt({"status": "PENDING_REVIEW"}, state)
        self.assertEqual(decision["source"], "rl_adjusted")
        self.assertEqual(decision["status"], "AUTO_CONFIRMED")
        self.assertEqual(decision["rl_action"], "AUTO_CONFIRM")
        self.assertGreaterEqual(decision["rl_confidence"], 0.75)

    def test_security_anomaly_uses_safety_override(self) -> None:
        decision = self.agent().adapt(
            {"status": "AUTO_CONFIRMED"},
            self.state(anomaly_type="ACCESS_DENIED", anomaly_family="Security"),
        )
        self.assertEqual(decision["status"], "PENDING_REVIEW")
        self.assertTrue(decision["safety_override"])
        self.assertTrue(decision["requires_human_review"])

    def test_behavior_anomaly_uses_safety_override(self) -> None:
        decision = self.agent().adapt(
            {"status": "AUTO_CONFIRMED"},
            self.state(anomaly_type="consumer_behavior_shift", anomaly_family="Behavior"),
        )
        self.assertEqual(decision["status"], "PENDING_REVIEW")
        self.assertTrue(decision["safety_override"])

    def test_reward_rules(self) -> None:
        reward = RewardEngine()
        self.assertEqual(reward.calculate("AUTO_CONFIRM", "confirmed").reward, 1.0)
        self.assertEqual(reward.calculate("AUTO_CONFIRM", "false_positive").reward, -1.0)
        self.assertEqual(reward.calculate("AUTO_DISMISS", "false_positive").reward, 1.0)
        self.assertEqual(reward.calculate("AUTO_DISMISS", "confirmed").reward, -1.0)
        self.assertEqual(reward.calculate("PENDING_REVIEW", "confirmed").reward, 0.4)
        self.assertIsNone(reward.calculate("PENDING_REVIEW", "pending_review").reward)

    def test_experience_memory_fallback_writes_json(self) -> None:
        experience = {"rl_action": "PENDING_REVIEW", "reward": 0.4}
        self.memory.append_experience(experience)
        path = Path(self.tmp.name) / "rl_experience_memory.json"
        self.assertTrue(path.exists())
        self.assertEqual(self.memory.load_experiences()[0]["rl_action"], "PENDING_REVIEW")

    def test_policy_update_changes_average_reward(self) -> None:
        agent = self.agent()
        state = self.state()
        agent.update_policy(state, "AUTO_CONFIRM", 1.0)
        agent.update_policy(state, "AUTO_CONFIRM", -1.0)
        context = self.memory.load_policy()[state.context_key()]["AUTO_CONFIRM"]
        self.assertEqual(context["count"], 2)
        self.assertEqual(context["average_reward"], 0.0)

    def test_learn_from_validation_records_experience(self) -> None:
        agent = self.agent()
        result = {
            "detected_anomaly_type": "SLA_BREACH",
            "risk_score": 92,
            "confidence": 0.97,
            "severity": "critical",
            "validation_status": "pending_review",
            "metadata": {
                "analysis_trace": {
                    "event": {"anomaly_detected": True, "selected_model_id": "event_rules_engine"},
                    "flow": {"anomaly_detected": True, "selected_model_id": "flow_rules_engine"},
                },
                "triage_decision": {
                    "status": "AUTO_CONFIRMED",
                    "baseline_status": "PENDING_REVIEW",
                    "rl_action": "AUTO_CONFIRM",
                    "signals": {
                        "family": "Performance",
                        "confidence": 0.97,
                        "risk_score": 92,
                        "severity": "critical",
                        "multi_level_agreement": True,
                    },
                },
            },
        }
        update = agent.learn_from_validation(result=result, final_validation_status="confirmed")
        self.assertIsNotNone(update)
        self.assertEqual(self.memory.load_experiences()[0]["reward"], 1.0)

    def test_learn_from_validation_bootstraps_when_rl_action_missing(self) -> None:
        agent = self.agent()
        result = {
            "detected_anomaly_type": "PROVIDER_UNREACHABLE",
            "risk_score": 95,
            "confidence": 0.86,
            "severity": "critical",
            "validation_status": "pending_review",
            "metadata": {
                "analysis_trace": {
                    "event": {"anomaly_detected": True, "selected_model_id": "event_rules_engine"},
                    "flow": {"anomaly_detected": True, "selected_model_id": "flow_rules_engine"},
                },
                "triage_decision": {
                    "status": "PENDING_REVIEW",
                    "baseline_status": "PENDING_REVIEW",
                    "signals": {
                        "family": "reliability",
                        "confidence": 0.86,
                        "risk_score": 95,
                        "severity": "critical",
                    },
                },
            },
        }

        update = agent.learn_from_validation(result=result, final_validation_status="confirmed")

        self.assertIsNotNone(update)
        experience = self.memory.load_experiences()[0]
        self.assertEqual(experience["rl_action"], "AUTO_CONFIRM")
        self.assertEqual(experience["reward"], 1.0)

    def test_metadata_triage_decision_contains_rl_fields(self) -> None:
        decision = self.agent(enabled=False).adapt({"status": "AUTO_DISMISSED"}, self.state())
        for key in [
            "source",
            "baseline_status",
            "rl_action",
            "rl_confidence",
            "expected_reward",
            "rl_policy_version",
            "safety_override",
        ]:
            self.assertIn(key, decision)


if __name__ == "__main__":
    unittest.main()
