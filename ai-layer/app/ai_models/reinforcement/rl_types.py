from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

RLAction = Literal["AUTO_CONFIRM", "PENDING_REVIEW", "AUTO_DISMISS"]

ACTION_TO_VALIDATION_STATUS: dict[str, str] = {
    "AUTO_CONFIRM": "auto_confirmed",
    "PENDING_REVIEW": "pending_review",
    "AUTO_DISMISS": "auto_dismissed",
}

VALIDATION_STATUS_TO_ACTION: dict[str, str] = {
    "AUTO_CONFIRMED": "AUTO_CONFIRM",
    "PENDING_REVIEW": "PENDING_REVIEW",
    "AUTO_DISMISSED": "AUTO_DISMISS",
}


@dataclass(frozen=True)
class DecisionState:
    anomaly_type: str = "UNKNOWN"
    anomaly_family: str = "Unknown"
    analysis_level: str = "event"
    risk_score: int = 0
    confidence: float = 0.0
    severity: str = "low"
    selected_model_id: str = "unknown"
    selected_model_name: str = "unknown"
    event_level_detected: bool = False
    flow_level_detected: bool = False
    temporal_level_detected: bool = False
    graph_level_detected: bool = False
    multi_level_agreement: bool = False
    review_policy: str = "unknown"
    repeated_occurrences: int = 0
    flow_code: str = "unknown"
    api_code: str = "unknown"
    producer_code: str = "unknown"
    consumer_code: str = "unknown"
    baseline_decision: str = "PENDING_REVIEW"
    validation_status_initial: str = "pending_review"

    def context_key(self) -> str:
        return "|".join(
            [
                self.anomaly_type.lower(),
                self.anomaly_family.lower(),
                self.severity.lower(),
                self.review_policy.lower(),
                self.baseline_decision.upper(),
            ]
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "anomaly_type": self.anomaly_type,
            "anomaly_family": self.anomaly_family,
            "analysis_level": self.analysis_level,
            "risk_score": self.risk_score,
            "confidence": self.confidence,
            "severity": self.severity,
            "selected_model_id": self.selected_model_id,
            "selected_model_name": self.selected_model_name,
            "event_level_detected": self.event_level_detected,
            "flow_level_detected": self.flow_level_detected,
            "temporal_level_detected": self.temporal_level_detected,
            "graph_level_detected": self.graph_level_detected,
            "multi_level_agreement": self.multi_level_agreement,
            "review_policy": self.review_policy,
            "repeated_occurrences": self.repeated_occurrences,
            "flow_code": self.flow_code,
            "api_code": self.api_code,
            "producer_code": self.producer_code,
            "consumer_code": self.consumer_code,
            "baseline_decision": self.baseline_decision,
            "validation_status_initial": self.validation_status_initial,
        }


@dataclass(frozen=True)
class RLDecision:
    action: str
    confidence: float
    expected_reward: float
    source: str
    reason: str
    safety_override: bool = False
    policy_version: str = "rl_policy_v1"
    context_key: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RewardResult:
    reward: float | None
    reason: str
    final: bool


@dataclass(frozen=True)
class Experience:
    state: dict[str, Any]
    baseline_decision: str
    rl_action: str
    final_validation_status: str
    reward: float
    reward_reason: str
    policy_version: str
    timestamp: str
