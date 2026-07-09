from __future__ import annotations

from app.ai_models.reinforcement.rl_types import RewardResult

CONFIRMED_STATUSES = {"confirmed", "validated_true_positive", "true_positive", "resolved"}
FALSE_POSITIVE_STATUSES = {
    "false_positive",
    "validated_false_positive",
    "validated_false",
    "auto_dismissed",
}
NON_FINAL_STATUSES = {"pending_review", "needs_investigation", "partial", "unverified", ""}


class RewardEngine:
    def calculate(self, rl_action: str | None, final_validation_status: str | None) -> RewardResult:
        action = str(rl_action or "").strip().upper()
        status = str(final_validation_status or "").strip().lower()

        if not action:
            return RewardResult(None, "No RL action recorded for this result", False)
        if status in NON_FINAL_STATUSES:
            return RewardResult(None, "Validation status is not final yet", False)

        if action == "AUTO_CONFIRM" and status in CONFIRMED_STATUSES:
            return RewardResult(1.0, "AUTO_CONFIRM matched human confirmed anomaly", True)
        if action == "AUTO_CONFIRM" and status in FALSE_POSITIVE_STATUSES:
            return RewardResult(-1.0, "AUTO_CONFIRM contradicted human false-positive validation", True)
        if action == "AUTO_DISMISS" and status in FALSE_POSITIVE_STATUSES:
            return RewardResult(1.0, "AUTO_DISMISS matched human false-positive validation", True)
        if action == "AUTO_DISMISS" and status in CONFIRMED_STATUSES:
            return RewardResult(-1.0, "AUTO_DISMISS missed a human confirmed anomaly", True)
        if action == "PENDING_REVIEW" and (status in CONFIRMED_STATUSES or status in FALSE_POSITIVE_STATUSES):
            return RewardResult(0.4, "PENDING_REVIEW correctly deferred final decision to human validation", True)

        return RewardResult(None, f"No reward rule for action={action} status={status}", False)
