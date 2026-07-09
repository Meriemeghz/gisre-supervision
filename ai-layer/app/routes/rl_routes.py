from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter(prefix="/ai/rl")


@router.get("/status")
def rl_status(request: Request) -> dict:
    agent = getattr(request.app.state.engine, "rl_decision_agent", None)
    if agent is None:
        return {
            "enabled": False,
            "algorithm": "contextual_bandit",
            "policy_version": "rl_policy_v1",
            "total_experiences": 0,
            "average_reward": 0,
            "cumulative_reward": 0,
            "decision_distribution": {},
            "human_override_rate": 0,
            "top_contexts_learned": [],
            "last_policy_update": None,
        }
    return agent.status()


@router.get("/policy")
def rl_policy(request: Request) -> dict:
    agent = getattr(request.app.state.engine, "rl_decision_agent", None)
    if agent is None:
        return {"policy_version": "rl_policy_v1", "contexts": []}
    return agent.policy_summary()
