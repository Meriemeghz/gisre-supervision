from types import SimpleNamespace
import unittest

from app.routes.analysis_routes import (
    ValidationUpdateRequest,
    demo_validation_decision,
    list_results,
    update_result_validation,
)


class FakeDatabase:
    def __init__(self) -> None:
        self.query = ""
        self.params: tuple = ()

    def fetch_all(self, query: str, params: tuple = ()) -> list[dict]:
        self.query = query
        self.params = params
        return [
            {
                "id": "result-normal",
                "detected_anomaly_type": "NORMAL",
                "metadata": {
                    "analysis_trace": {
                        "event": {"status": "success"},
                        "flow": {"status": "skipped"},
                    },
                    "risk_fusion": {
                        "final_risk_score": 5,
                        "executed_levels": ["event"],
                        "skipped_levels": ["flow"],
                    },
                },
            },
        ]


class FakeValidationDatabase:
    def __init__(self) -> None:
        self.query = ""
        self.params: tuple = ()

    def fetch_one(self, query: str, params: tuple = ()) -> dict:
        self.query = query
        self.params = params
        return {
            "id": "result-critical",
            "validation_status": params[0],
            "validated_by": params[1],
            "validation_comment": params[3],
            "validation_source": "human",
        }


class AnalysisResultsRouteTest(unittest.TestCase):
    def test_include_normal_returns_rows_without_anomaly_filter(self) -> None:
        database = FakeDatabase()
        request = SimpleNamespace(
            app=SimpleNamespace(state=SimpleNamespace(database=database)),
        )

        rows = list_results(request, limit=10, include_normal=True)

        self.assertEqual(rows[0]["detected_anomaly_type"], "NORMAL")
        self.assertEqual(rows[0]["metadata"]["analysis_trace"]["event"]["status"], "success")
        self.assertEqual(rows[0]["metadata"]["analysis_trace"]["flow"]["status"], "skipped")
        self.assertEqual(rows[0]["metadata"]["risk_fusion"]["final_risk_score"], 5)
        self.assertNotIn("detected_anomaly_type <> 'NORMAL'", database.query)
        self.assertIn("results.validation_status", database.query)
        self.assertEqual(database.params, (10,))

    def test_default_excludes_normal_results(self) -> None:
        database = FakeDatabase()
        request = SimpleNamespace(
            app=SimpleNamespace(state=SimpleNamespace(database=database)),
        )

        list_results(request, limit=10, include_normal=False)

        self.assertIn("results.detected_anomaly_type <> 'NORMAL'", database.query)
        self.assertEqual(database.params, (10,))

    def test_resolved_status_is_persisted_as_human_validation(self) -> None:
        database = FakeValidationDatabase()
        request = SimpleNamespace(
            app=SimpleNamespace(state=SimpleNamespace(database=database)),
        )

        result = update_result_validation(
            "result-critical",
            request,
            ValidationUpdateRequest(
                validation_status="resolved",
                validation_comment="Incident closed after remediation",
                validated_by="supervisor",
            ),
        )

        self.assertEqual(result["validation_status"], "resolved")
        self.assertEqual(result["validation_source"], "human")
        self.assertIn("validation_source = 'human'", database.query)
        self.assertEqual(database.params[0], "resolved")
        self.assertEqual(database.params[-1], "result-critical")

    def test_demo_validation_confirms_obvious_technical_anomaly(self) -> None:
        decision = demo_validation_decision(
            {"detected_anomaly_type": "SERVER_ERROR", "risk_score": 92, "severity": "critical"},
            index=0,
        )

        self.assertEqual(decision["status"], "confirmed")
        self.assertIn("Demo feedback", decision["comment"])

    def test_demo_validation_dismisses_normal_low_risk(self) -> None:
        decision = demo_validation_decision(
            {"detected_anomaly_type": "NORMAL", "risk_score": 0, "severity": "low"},
            index=0,
        )

        self.assertEqual(decision["status"], "auto_dismissed")

    def test_demo_validation_security_anomaly_remains_cautious(self) -> None:
        pending = demo_validation_decision(
            {"detected_anomaly_type": "ACCESS_DENIED", "risk_score": 55, "severity": "medium"},
            index=0,
        )
        reviewed = demo_validation_decision(
            {"detected_anomaly_type": "ACCESS_DENIED", "risk_score": 55, "severity": "medium"},
            index=1,
        )

        self.assertEqual(pending["status"], "pending_review")
        self.assertIn(reviewed["status"], {"confirmed", "false_positive"})


if __name__ == "__main__":
    unittest.main()
