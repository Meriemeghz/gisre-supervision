from datetime import datetime, timezone
from types import SimpleNamespace
import unittest

from app.routes.analysis_routes import historical_analytics


class FakeDatabase:
    def fetch_all(self, query: str, params: tuple = ()) -> list[dict]:
        if "SELECT DISTINCT" in query:
            return [{
                "flow_code": "F14",
                "api_code": "verify_coverage",
                "producer_code": "CNSS",
                "consumer_code": "HOSPITAL_RABAT",
                "anomaly_type": "SLA_BREACH",
            }]
        if "date_trunc" in query and "detected_anomaly_type AS anomaly_type" in query:
            return [{
                "bucket": "2026-06-10 00:00:00+00",
                "anomaly_type": "SLA_BREACH",
                "count": 4,
            }]
        if "previous_period_count" in query:
            return [{
                "anomaly_type": "SLA_BREACH",
                "occurrences": 4,
                "first_seen": "2026-06-02 12:00:00+00",
                "last_seen": "2026-06-10 12:00:00+00",
                "previous_period_count": 1,
                "recent_period_count": 3,
            }]
        if "ranked_cell_types" in query:
            return [{
                "day": 1,
                "hour": 9,
                "anomaly_count": 4,
                "top_anomaly_type": "SLA_BREACH",
                "average_risk_score": 62.5,
            }]
        if "COUNT(DISTINCT flow_code)" in query:
            return [{
                "producer_code": "CNSS",
                "api_code": "verify_coverage",
                "anomaly_type": "SLA_BREACH",
                "anomaly_count": 4,
                "average_risk_score": 61.0,
                "max_risk_score": 80,
                "risk_sum": 244.0,
                "criticality": "high",
                "average_severity_score": 2.75,
                "first_seen": "2026-06-02 12:00:00+00",
                "last_seen": "2026-06-10 12:00:00+00",
                "impacted_flows": 1,
            }]
        return []

    def fetch_one(self, query: str, params: tuple = ()) -> dict:
        return {
            "total_results": 10,
            "anomalies_detected": 4,
            "normal_results": 6,
            "false_positives": 1,
            "true_positives": 2,
            "pending_reviews": 1,
            "reviewed_results": 3,
        }


class HistoricalAnalyticsRouteTest(unittest.TestCase):
    def test_returns_historical_contract_with_filters_and_normal_results(self) -> None:
        request = SimpleNamespace(
            app=SimpleNamespace(state=SimpleNamespace(database=FakeDatabase())),
        )

        result = historical_analytics(
            request,
            start_date=datetime(2026, 6, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 6, 11, tzinfo=timezone.utc),
            flow_code="F14",
        )

        self.assertEqual(result["period"]["bucket"], "day")
        self.assertEqual(result["filters"]["flow_code"], "F14")
        self.assertEqual(result["trends"][0]["anomaly_count"], 4)
        self.assertEqual(result["anomaly_timeline"][0]["anomaly_type"], "SLA_BREACH")
        self.assertEqual(result["evolving_anomalies"][0]["recent_period_count"], 3)
        self.assertEqual(result["temporal_heatmap"][0]["hour"], 9)
        self.assertEqual(result["temporal_heatmap"][0]["top_anomaly_type"], "SLA_BREACH")
        self.assertEqual(result["root_cause_chains"][0]["producer_code"], "CNSS")
        self.assertEqual(result["root_cause_chains"][0]["risk_sum"], 244.0)
        self.assertEqual(result["supervision_quality"]["normal_results"], 6)
        self.assertEqual(result["supervision_quality"]["validation_rate"], 0.75)
        self.assertEqual(result["filter_options"]["flow_code"], ["F14"])
        self.assertEqual(
            result["llm_ready_summary_payload"]["dominant_anomalies"][0]["anomaly_type"],
            "SLA_BREACH",
        )


if __name__ == "__main__":
    unittest.main()
