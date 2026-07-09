from __future__ import annotations

from typing import Any

from app.ai_models.reinforcement.rl_decision_agent import RLDecisionAgent, state_from_result


class RLPolicyAdapter:
    """Thin integration layer between baseline triage metadata and RL agent."""

    def __init__(self, agent: RLDecisionAgent) -> None:
        self.agent = agent

    def adapt_from_result(self, baseline_decision: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
        return self.agent.adapt(baseline_decision, state_from_result(result, baseline_decision))
