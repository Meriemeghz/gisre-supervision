from __future__ import annotations

import unittest

from app.services.triage_engine import TriageEngine


class TriageEngineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = TriageEngine()

    def decide(
        self,
        *,
        risk: int,
        confidence: float,
        severity: str,
        anomaly_type: str,
        event_anomaly: bool,
        flow_anomaly: bool,
        flow_executed: bool = True,
        repeated_occurrences: int | None = None,
    ) -> dict:
        return self.engine.decide(
            risk_score=risk,
            confidence=confidence,
            severity=severity,
            anomaly_type=anomaly_type,
            event_trace={"executed": True, "anomaly_detected": event_anomaly},
            flow_trace={
                "executed": flow_executed,
                "anomaly_detected": flow_anomaly,
                "status": "success" if flow_executed else "skipped",
            },
            repeated_occurrences=repeated_occurrences,
        )

    def test_normal_low_risk_is_auto_dismissed(self) -> None:
        decision = self.decide(
            risk=5,
            confidence=0.98,
            severity="low",
            anomaly_type="NORMAL",
            event_anomaly=False,
            flow_anomaly=False,
        )
        self.assertEqual(decision["status"], "AUTO_DISMISSED")
        self.assertFalse(decision["requires_human_review"])
        self.assertEqual(self.engine.validation_status(decision), "auto_dismissed")

    def test_auto_confirmable_with_multilevel_agreement_is_auto_confirmed(self) -> None:
        decision = self.decide(
            risk=92,
            confidence=0.97,
            severity="critical",
            anomaly_type="SLA_BREACH",
            event_anomaly=True,
            flow_anomaly=True,
        )
        self.assertEqual(decision["status"], "AUTO_CONFIRMED")
        self.assertEqual(decision["review_policy"], "auto_confirmable")
        self.assertFalse(decision["requires_human_review"])
        self.assertTrue(decision["signals"]["multi_level_agreement"])
        self.assertEqual(self.engine.validation_status(decision), "auto_confirmed")

    def test_auto_confirmable_with_repeated_occurrences_is_auto_confirmed(self) -> None:
        decision = self.decide(
            risk=76,
            confidence=0.96,
            severity="high",
            anomaly_type="PROVIDER_UNREACHABLE",
            event_anomaly=True,
            flow_anomaly=False,
            repeated_occurrences=3,
        )
        self.assertEqual(decision["status"], "AUTO_CONFIRMED")
        self.assertEqual(decision["signals"]["repeated_occurrences"], 3)

    def test_auto_confirmable_without_corroboration_requires_review(self) -> None:
        decision = self.decide(
            risk=88,
            confidence=0.97,
            severity="critical",
            anomaly_type="SLA_BREACH",
            event_anomaly=True,
            flow_anomaly=False,
        )
        self.assertEqual(decision["status"], "PENDING_REVIEW")
        self.assertTrue(decision["requires_human_review"])
        self.assertFalse(decision["signals"]["multi_level_agreement"])

    def test_auto_confirmable_low_confidence_requires_review(self) -> None:
        decision = self.decide(
            risk=91,
            confidence=0.91,
            severity="critical",
            anomaly_type="HIGH_ERROR_RATE",
            event_anomaly=True,
            flow_anomaly=True,
        )
        self.assertEqual(decision["status"], "PENDING_REVIEW")

    def test_medium_risk_requires_review(self) -> None:
        decision = self.decide(
            risk=62,
            confidence=0.96,
            severity="medium",
            anomaly_type="SLA_BREACH",
            event_anomaly=True,
            flow_anomaly=True,
        )
        self.assertEqual(decision["status"], "PENDING_REVIEW")
        self.assertTrue(decision["requires_human_review"])

    def test_security_anomaly_requires_human_review(self) -> None:
        decision = self.decide(
            risk=95,
            confidence=0.99,
            severity="critical",
            anomaly_type="ACCESS_DENIED",
            event_anomaly=True,
            flow_anomaly=True,
        )
        self.assertEqual(decision["status"], "PENDING_REVIEW")
        self.assertEqual(decision["review_policy"], "human_review_required")
        self.assertIn("sensitive or context-dependent", decision["reason"])
        self.assertEqual(decision["signals"]["family"], "Security")

    def test_behavior_anomaly_requires_human_review(self) -> None:
        decision = self.decide(
            risk=80,
            confidence=0.98,
            severity="high",
            anomaly_type="consumer_behavior_shift",
            event_anomaly=True,
            flow_anomaly=True,
        )
        self.assertEqual(decision["status"], "PENDING_REVIEW")
        self.assertEqual(decision["signals"]["family"], "Behavior")

    def test_dependency_anomaly_requires_human_review(self) -> None:
        decision = self.decide(
            risk=93,
            confidence=0.99,
            severity="critical",
            anomaly_type="cascade_failure",
            event_anomaly=True,
            flow_anomaly=True,
        )
        self.assertEqual(decision["status"], "PENDING_REVIEW")
        self.assertEqual(decision["signals"]["family"], "Dependencies")

    def test_temporal_anomaly_is_pending_by_default(self) -> None:
        decision = self.decide(
            risk=95,
            confidence=0.99,
            severity="critical",
            anomaly_type="LATENCY_DRIFT",
            event_anomaly=True,
            flow_anomaly=True,
        )
        self.assertEqual(decision["status"], "PENDING_REVIEW")
        self.assertEqual(decision["review_policy"], "pending_by_default")
        self.assertIn("Temporal anomaly", decision["reason"])

    def test_unknown_anomaly_requires_validation(self) -> None:
        decision = self.decide(
            risk=85,
            confidence=0.99,
            severity="high",
            anomaly_type="UNKNOWN_VENDOR_SIGNAL",
            event_anomaly=True,
            flow_anomaly=True,
        )
        self.assertEqual(decision["status"], "PENDING_REVIEW")
        self.assertEqual(decision["review_policy"], "unknown")
        self.assertIn("Unknown anomaly type", decision["reason"])

    def test_event_anomaly_with_skipped_flow_requires_review(self) -> None:
        decision = self.decide(
            risk=92,
            confidence=0.96,
            severity="critical",
            anomaly_type="TIMEOUT",
            event_anomaly=True,
            flow_anomaly=False,
            flow_executed=False,
        )
        self.assertEqual(decision["status"], "PENDING_REVIEW")
        self.assertFalse(decision["signals"]["multi_level_agreement"])

    def test_decision_contract_contains_persisted_metadata_fields(self) -> None:
        decision = self.decide(
            risk=91,
            confidence=0.98,
            severity="critical",
            anomaly_type="SLA_BREACH",
            event_anomaly=True,
            flow_anomaly=True,
        )
        self.assertIn("status", decision)
        self.assertIn("review_policy", decision)
        self.assertIn("requires_human_review", decision)
        self.assertIn("reason", decision)
        self.assertEqual(decision["policy_version"], "triage_policy_v1")
        self.assertIn("signals", decision)
        self.assertIn("anomaly_type", decision["signals"])
        self.assertIn("risk_score", decision["signals"])
        self.assertIn("confidence", decision["signals"])
        self.assertIn("severity", decision["signals"])
        self.assertIn("multi_level_agreement", decision["signals"])
        self.assertIn("repeated_occurrences", decision["signals"])
        self.assertIn("family", decision["signals"])


if __name__ == "__main__":
    unittest.main()
