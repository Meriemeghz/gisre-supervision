from __future__ import annotations

import logging
import random
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from app.ai_models.reinforcement.experience_memory import ExperienceMemory
from app.ai_models.reinforcement.reward_engine import RewardEngine
from app.ai_models.reinforcement.reward_engine import CONFIRMED_STATUSES, FALSE_POSITIVE_STATUSES
from app.ai_models.reinforcement.rl_types import (
    ACTION_TO_VALIDATION_STATUS,
    DecisionState,
    Experience,
    RLDecision,
    VALIDATION_STATUS_TO_ACTION,
)

logger = logging.getLogger(__name__)

POLICY_VERSION = "rl_policy_v1"
ACTIONS = ("AUTO_CONFIRM", "PENDING_REVIEW", "AUTO_DISMISS")
SENSITIVE_FAMILIES = {"security", "behavior", "dependencies", "graph", "platform", "unknown", "temporal"}


class RLDecisionAgent:
    """Contextual-bandit adapter for post-fusion triage decisions.

    It optimizes triage actions only. It does not detect anomalies and does not
    update Event/Flow/Temporal/Graph models.
    """

    def __init__(
        self,
        *,
        enabled: bool = False,
        min_experiences: int = 30,
        confidence_threshold: float = 0.80,
        epsilon: float = 0.10,
        memory: ExperienceMemory,
        reward_engine: RewardEngine | None = None,
    ) -> None:
        self.enabled = enabled
        self.min_experiences = min_experiences
        self.confidence_threshold = confidence_threshold
        self.epsilon = epsilon
        self.memory = memory
        self.reward_engine = reward_engine or RewardEngine()

    def adapt(self, baseline_decision: dict[str, Any], state: DecisionState) -> dict[str, Any]:
        baseline_status = str(baseline_decision.get("status") or "PENDING_REVIEW").upper()
        baseline_action = VALIDATION_STATUS_TO_ACTION.get(baseline_status, "PENDING_REVIEW")
        base = dict(baseline_decision)
        base.update(
            {
                "source": "baseline",
                "baseline_status": baseline_status,
                "rl_action": None,
                "rl_confidence": 0.0,
                "expected_reward": 0.0,
                "rl_policy_version": POLICY_VERSION,
                "safety_override": False,
            }
        )

        if not self.enabled:
            base["reason"] = f"{base.get('reason', 'Baseline triage decision used')} RL Decision Agent disabled."
            return base

        safety = self._safety_override(state)
        if safety:
            base.update(
                {
                    "status": "PENDING_REVIEW",
                    "source": "baseline",
                    "baseline_status": baseline_status,
                    "rl_action": "PENDING_REVIEW",
                    "rl_confidence": 1.0,
                    "expected_reward": 0.0,
                    "rl_policy_version": POLICY_VERSION,
                    "requires_human_review": True,
                    "safety_override": True,
                    "reason": safety,
                }
            )
            return base

        decision = self.recommend(state, baseline_action)
        if decision.source != "rl_adjusted":
            base.update(
                {
                    "rl_action": decision.action,
                    "rl_confidence": decision.confidence,
                    "expected_reward": decision.expected_reward,
                    "reason": f"{base.get('reason', 'Baseline triage decision used')} {decision.reason}",
                    "safety_override": decision.safety_override,
                }
            )
            return base

        base.update(
            {
                "status": _action_to_status(decision.action),
                "source": "rl_adjusted",
                "baseline_status": baseline_status,
                "rl_action": decision.action,
                "rl_confidence": decision.confidence,
                "expected_reward": decision.expected_reward,
                "requires_human_review": decision.action == "PENDING_REVIEW",
                "reason": decision.reason,
                "safety_override": False,
            }
        )
        return base

    def recommend(self, state: DecisionState, baseline_action: str) -> RLDecision:
        policy = self.memory.load_policy()
        context_key = state.context_key()
        context = policy.get(context_key) or {}
        total = int(sum((context.get(action) or {}).get("count", 0) for action in ACTIONS))
        if total < self.min_experiences:
            return RLDecision(
                action=baseline_action,
                confidence=0.0,
                expected_reward=0.0,
                source="baseline",
                reason="RL kept baseline decision because similar experience count is below threshold.",
                context_key=context_key,
            )

        if random.random() < self.epsilon:
            action = random.choice(ACTIONS)
        else:
            action = max(ACTIONS, key=lambda item: float((context.get(item) or {}).get("average_reward", 0.0)))
        stats = context.get(action) or {}
        expected_reward = float(stats.get("average_reward") or 0.0)
        confidence = self._confidence(context, action, total)
        if confidence < self.confidence_threshold:
            return RLDecision(
                action=baseline_action,
                confidence=confidence,
                expected_reward=expected_reward,
                source="baseline",
                reason="RL kept baseline decision because policy confidence is below threshold.",
                context_key=context_key,
            )
        return RLDecision(
            action=action,
            confidence=confidence,
            expected_reward=expected_reward,
            source="rl_adjusted",
            reason=f"RL policy selected {action} for context {context_key}.",
            context_key=context_key,
        )

    def learn_from_validation(
        self,
        *,
        result: dict[str, Any],
        final_validation_status: str,
    ) -> dict[str, Any] | None:
        metadata = result.get("metadata") or {}
        triage = metadata.get("triage_decision") or {}
        rl_action = triage.get("rl_action") or _bootstrap_action_from_validation(final_validation_status)
        if not rl_action:
            return None
        reward = self.reward_engine.calculate(str(rl_action), final_validation_status)
        if reward.reward is None:
            return None
        state = state_from_result(result, triage)
        experience = Experience(
            state=state.to_dict(),
            baseline_decision=str(triage.get("baseline_status") or triage.get("status") or "PENDING_REVIEW"),
            rl_action=str(rl_action),
            final_validation_status=final_validation_status,
            reward=reward.reward,
            reward_reason=reward.reason,
            policy_version=POLICY_VERSION,
            timestamp=datetime.now(timezone.utc).isoformat(),
        ).__dict__
        self.memory.append_experience(experience)
        policy = self.update_policy(state, str(rl_action), reward.reward)
        return {"experience": experience, "policy_context": policy.get(state.context_key())}

    def update_policy(self, state: DecisionState, action: str, reward: float) -> dict[str, Any]:
        policy = self.memory.load_policy()
        context_key = state.context_key()
        context = policy.setdefault(context_key, {})
        stats = context.setdefault(action, {"count": 0, "total_reward": 0.0, "average_reward": 0.0})
        stats["count"] = int(stats.get("count") or 0) + 1
        stats["total_reward"] = float(stats.get("total_reward") or 0.0) + float(reward)
        stats["average_reward"] = round(stats["total_reward"] / max(stats["count"], 1), 4)
        context[action] = stats
        context["last_update"] = datetime.now(timezone.utc).isoformat()
        self.memory.save_policy(policy)
        return policy

    def status(self) -> dict[str, Any]:
        experiences = self.memory.load_experiences()
        policy = self.memory.load_policy()
        rewards = [float(item.get("reward") or 0.0) for item in experiences]
        distribution = Counter(str(item.get("rl_action") or "UNKNOWN") for item in experiences)
        human_overrides = sum(1 for item in experiences if str(item.get("baseline_decision")) != str(item.get("rl_action")))
        return {
            "enabled": self.enabled,
            "algorithm": "contextual_bandit",
            "policy_version": POLICY_VERSION,
            "total_experiences": len(experiences),
            "average_reward": round(sum(rewards) / len(rewards), 4) if rewards else 0,
            "cumulative_reward": round(sum(rewards), 4),
            "decision_distribution": dict(distribution),
            "human_override_rate": round(human_overrides / len(experiences), 4) if experiences else 0,
            "top_contexts_learned": self._top_contexts(policy),
            "last_policy_update": _last_policy_update(policy),
            "config": {
                "min_experiences": self.min_experiences,
                "confidence_threshold": self.confidence_threshold,
                "epsilon": self.epsilon,
            },
        }

    def policy_summary(self) -> dict[str, Any]:
        policy = self.memory.load_policy()
        return {
            "policy_version": POLICY_VERSION,
            "contexts": self._top_contexts(policy, limit=50),
        }

    @staticmethod
    def _confidence(context: dict[str, Any], action: str, total: int) -> float:
        stats = context.get(action) or {}
        count = int(stats.get("count") or 0)
        dominance = count / max(total, 1)
        reward_quality = max(0.0, min(1.0, (float(stats.get("average_reward") or 0.0) + 1.0) / 2.0))
        experience_quality = min(1.0, total / 100.0)
        return round((0.45 * dominance) + (0.35 * reward_quality) + (0.20 * experience_quality), 4)

    @staticmethod
    def _safety_override(state: DecisionState) -> str | None:
        family = state.anomaly_family.strip().lower()
        if family in SENSITIVE_FAMILIES:
            return f"Safety override: {state.anomaly_family} anomalies remain pending review."
        if state.analysis_level.strip().lower() == "temporal":
            return "Safety override: Temporal anomalies remain pending review in RL v1."
        return None

    @staticmethod
    def _top_contexts(policy: dict[str, Any], limit: int = 10) -> list[dict[str, Any]]:
        rows = []
        for key, context in policy.items():
            if not isinstance(context, dict):
                continue
            action_stats = {
                action: context.get(action)
                for action in ACTIONS
                if isinstance(context.get(action), dict)
            }
            total = sum(int(stats.get("count") or 0) for stats in action_stats.values())
            best_action = max(action_stats, key=lambda item: action_stats[item].get("average_reward", 0), default=None)
            rows.append(
                {
                    "context": key,
                    "total_experiences": total,
                    "best_action": best_action,
                    "best_average_reward": action_stats.get(best_action, {}).get("average_reward") if best_action else None,
                    "last_update": context.get("last_update"),
                }
            )
        return sorted(rows, key=lambda item: item["total_experiences"], reverse=True)[:limit]


def state_from_result(result: dict[str, Any], triage: dict[str, Any] | None = None) -> DecisionState:
    metadata = result.get("metadata") or {}
    analysis_trace = metadata.get("analysis_trace") or {}
    event = analysis_trace.get("event") or {}
    flow = analysis_trace.get("flow") or {}
    temporal = analysis_trace.get("temporal") or {}
    graph = analysis_trace.get("graph") or {}
    signals = (triage or metadata.get("triage_decision") or {}).get("signals") or {}
    selected = graph or temporal or flow or event
    return DecisionState(
        anomaly_type=str(result.get("detected_anomaly_type") or signals.get("anomaly_type") or "UNKNOWN"),
        anomaly_family=str(signals.get("family") or metadata.get("anomaly_family") or "Unknown"),
        analysis_level=str(metadata.get("analysis_level") or result.get("analysis_type") or "event"),
        risk_score=_bounded_int(result.get("risk_score") or signals.get("risk_score")),
        confidence=_bounded_float(result.get("confidence") or signals.get("confidence")),
        severity=str(result.get("severity") or signals.get("severity") or "low"),
        selected_model_id=str(selected.get("selected_model_id") or metadata.get("model_id") or "unknown"),
        selected_model_name=str(selected.get("selected_model_name") or metadata.get("model_name") or "unknown"),
        event_level_detected=bool(event.get("anomaly_detected")),
        flow_level_detected=bool(flow.get("anomaly_detected")),
        temporal_level_detected=bool(temporal.get("anomaly_detected")),
        graph_level_detected=bool(graph.get("anomaly_detected")),
        multi_level_agreement=bool(signals.get("multi_level_agreement")),
        review_policy=str((triage or {}).get("review_policy") or "unknown"),
        repeated_occurrences=int(signals.get("repeated_occurrences") or 0),
        flow_code=str(result.get("flow_code") or metadata.get("flow_code") or "unknown"),
        api_code=str(metadata.get("api_code") or "unknown"),
        producer_code=str(metadata.get("producer_code") or "unknown"),
        consumer_code=str(metadata.get("consumer_code") or "unknown"),
        baseline_decision=str((triage or {}).get("baseline_status") or (triage or {}).get("status") or "PENDING_REVIEW"),
        validation_status_initial=str(result.get("validation_status") or "pending_review"),
    )


def _action_to_status(action: str) -> str:
    return {
        "AUTO_CONFIRM": "AUTO_CONFIRMED",
        "PENDING_REVIEW": "PENDING_REVIEW",
        "AUTO_DISMISS": "AUTO_DISMISSED",
    }.get(str(action), "PENDING_REVIEW")


def _bootstrap_action_from_validation(final_validation_status: str | None) -> str | None:
    status = str(final_validation_status or "").strip().lower()
    if status in CONFIRMED_STATUSES:
        return "AUTO_CONFIRM"
    if status in FALSE_POSITIVE_STATUSES:
        return "AUTO_DISMISS"
    return None


def _bounded_int(value: Any) -> int:
    try:
        return max(0, min(100, int(round(float(value or 0)))))
    except (TypeError, ValueError):
        return 0


def _bounded_float(value: Any) -> float:
    try:
        return max(0.0, min(1.0, float(value or 0.0)))
    except (TypeError, ValueError):
        return 0.0


def _last_policy_update(policy: dict[str, Any]) -> str | None:
    values = [
        str(context.get("last_update"))
        for context in policy.values()
        if isinstance(context, dict) and context.get("last_update")
    ]
    return max(values) if values else None
