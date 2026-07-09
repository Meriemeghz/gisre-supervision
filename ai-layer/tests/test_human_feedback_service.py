from __future__ import annotations

import unittest

from app.services.human_feedback_service import HumanFeedbackService


class FakeDatabase:
    def __init__(self, rows):
        self.rows = rows

    def fetch_one(self, query, _params=()):
        if "total_validated" not in query:
            return None
        labels = [HumanFeedbackService.human_label(item["validation_status"]) for item in self.rows]
        return {
            "total_validated": len(self.rows),
            "confirmed_anomalies": labels.count("anomaly"),
            "false_positives": labels.count("normal"),
        }

    def fetch_all(self, query, _params=()):
        if "GROUP BY 1, 2" in query:
            grouped = {}
            for item in self.rows:
                label = HumanFeedbackService.human_label(item["validation_status"])
                if label is None:
                    continue
                key = (item["model_id"], item["analysis_level"])
                current = grouped.setdefault(
                    key,
                    {
                        "model_id": item["model_id"],
                        "analysis_level": item["analysis_level"],
                        "usable_samples": 0,
                        "anomaly_labels": 0,
                        "normal_labels": 0,
                    },
                )
                current["usable_samples"] += 1
                current[f"{label}_labels"] += 1
            return list(grouped.values())
        if "GROUP BY 1" in query:
            grouped = {}
            for item in self.rows:
                if HumanFeedbackService.human_label(item["validation_status"]) is None:
                    continue
                anomaly_type = item["anomaly_type"]
                grouped[anomaly_type] = grouped.get(anomaly_type, 0) + 1
            return [
                {"anomaly_type": anomaly_type, "count": count}
                for anomaly_type, count in grouped.items()
            ]
        return list(self.rows)


class FakeModel:
    def __init__(self, model_type="supervised", is_mock=False):
        self.model_type = model_type
        self.is_mock = is_mock


class FakeFactory:
    def __init__(self, models):
        self.models = models

    def create(self, model_id):
        if model_id not in self.models:
            raise KeyError(model_id)
        return self.models[model_id]


def row(status, anomaly_type="TIMEOUT", model_id="event_random_forest"):
    return {
        "result_id": f"{status}-{anomaly_type}",
        "model_id": model_id,
        "analysis_level": "event",
        "anomaly_type": anomaly_type,
        "risk_score": 80 if anomaly_type != "NORMAL" else 0,
        "confidence": 0.9,
        "validation_status": status,
        "validated_at": "2026-06-14T10:00:00+00:00",
        "validation_comment": None,
        "validation_source": "human",
        "metadata": {},
        "status_code": 504 if anomaly_type != "NORMAL" else 200,
        "latency_ms": 900 if anomaly_type != "NORMAL" else 120,
        "is_sla_breach": anomaly_type != "NORMAL",
        "flow_code": "F1",
        "api_code": "API1",
        "consumer_code": "C1",
        "producer_code": "P1",
    }


class HumanFeedbackServiceTests(unittest.TestCase):
    def service(self, rows, models=None):
        return HumanFeedbackService(
            FakeDatabase(rows),
            FakeFactory(models or {"event_random_forest": FakeModel()}),
        )

    def test_confirmed_is_anomaly_label(self):
        records = self.service([row("confirmed")]).dataset()
        self.assertEqual(records[0]["human_label"], "anomaly")

    def test_false_positive_is_normal_label(self):
        records = self.service([row("false_positive")]).dataset()
        self.assertEqual(records[0]["human_label"], "normal")

    def test_pending_review_is_excluded(self):
        service = self.service([row("pending_review")])
        self.assertEqual(service.dataset(), [])
        self.assertEqual(service.summary()["excluded_pending"], 1)

    def test_needs_investigation_is_excluded(self):
        service = self.service([row("needs_investigation")])
        self.assertEqual(service.dataset(), [])
        self.assertEqual(service.summary()["excluded_pending"], 1)

    def test_auto_triage_statuses_are_mapped(self):
        records = self.service(
            [
                row("auto_confirmed"),
                row("auto_dismissed", "NORMAL"),
            ]
        ).dataset()
        self.assertEqual(
            [record["human_label"] for record in records],
            ["anomaly", "normal"],
        )

    def test_rules_engine_feedback_is_calibration_only(self):
        service = self.service(
            [row("confirmed", model_id="event_rules_engine")],
            {"event_rules_engine": FakeModel(model_type="rules")},
        )
        report = service.training_readiness("event_rules_engine")
        self.assertFalse(report["trainable"])
        self.assertIn("rule calibration", report["message"])

    def test_supervised_model_is_ready_with_balanced_minimum(self):
        rows = [row("confirmed") for _ in range(60)]
        rows += [row("false_positive", "NORMAL") for _ in range(40)]
        report = self.service(rows).training_readiness("event_random_forest")
        self.assertTrue(report["ready"])
        self.assertEqual(report["usable_samples"], 100)

    def test_supervised_model_is_not_ready_with_too_few_samples(self):
        rows = [row("confirmed") for _ in range(8)]
        rows += [row("false_positive", "NORMAL") for _ in range(2)]
        report = self.service(rows).training_readiness("event_random_forest")
        self.assertFalse(report["ready"])
        self.assertTrue(report["warnings"])


if __name__ == "__main__":
    unittest.main()
