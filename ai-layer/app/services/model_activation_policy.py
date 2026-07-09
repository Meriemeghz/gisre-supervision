from __future__ import annotations

import json
from pathlib import Path
from threading import RLock
from typing import Any

from app.ai_models.registry import ModelRegistry


DEFAULT_POLICY: dict[str, dict[str, Any]] = {
    "event": {
        "active_model_id": "event_rules_engine",
        "models": {
            "event_rules_engine": {"enabled": True},
            "event_random_forest": {"enabled": True},
            "event_isolation_forest": {"enabled": True},
            "event_lof": {"enabled": False},
            "event_autoencoder_mlp": {"enabled": False},
        },
    },
    "flow": {
        "active_model_id": "flow_rules_engine",
        "models": {
            "flow_rules_engine": {"enabled": True},
            "flow_kmeans_profile": {"enabled": True},
            "flow_autoencoder": {"enabled": False},
            "flow_gru_profile": {"enabled": False},
        },
    },
    "temporal": {
        "active_model_id": "temporal_rules_engine",
        "models": {
            "temporal_rules_engine": {"enabled": True},
            "temporal_gru_sequence": {"enabled": True},
            "temporal_lstm_sequence": {"enabled": False},
            "temporal_tranad": {"enabled": False},
        },
    },
    "graph": {
        "active_model_id": "graph_rules_engine",
        "models": {
            "graph_rules_engine": {"enabled": True},
            "graph_gdn": {"enabled": False},
            "graph_mtad_gat": {"enabled": False},
        },
    },
}


class ModelActivationPolicy:
    def __init__(self, model_dir: str | Path = "/app/models") -> None:
        self.path = Path(model_dir) / "analysis_model_policy.json"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._policy = self._load()

    def get_policy(self) -> dict[str, Any]:
        with self._lock:
            return self._enriched_policy()

    def active_model_id(self, analysis_level: str) -> str | None:
        with self._lock:
            level = self._policy.get(analysis_level) or {}
            return self._effective_active_model_id(analysis_level, level)

    def update_level(
        self,
        analysis_level: str,
        active_model_id: str | None,
        enabled_models: dict[str, bool] | None = None,
        update_active: bool = True,
    ) -> dict[str, Any]:
        with self._lock:
            if analysis_level not in self._policy:
                raise ValueError(f"Unsupported analysis level: {analysis_level}")

            level = self._policy[analysis_level]
            models = level["models"]
            if enabled_models:
                for model_id, enabled in enabled_models.items():
                    if model_id not in models:
                        raise ValueError(f"Model {model_id} does not belong to {analysis_level}")
                    models[model_id]["enabled"] = bool(enabled)
                    if not enabled and level.get("active_model_id") == model_id:
                        level["active_model_id"] = None

            if update_active:
                if active_model_id:
                    if active_model_id not in models:
                        raise ValueError(f"Model {active_model_id} does not belong to {analysis_level}")
                    if not models[active_model_id].get("enabled"):
                        raise ValueError(f"Disabled model cannot be active: {active_model_id}")
                level["active_model_id"] = active_model_id
            self._save()
            return self._enriched_level(analysis_level, level)

    def _load(self) -> dict[str, Any]:
        if self.path.exists():
            try:
                stored = json.loads(self.path.read_text(encoding="utf-8"))
                policy = self._merge_defaults(stored)
                self._policy = policy
                self._save()
                return policy
            except (OSError, ValueError, TypeError):
                pass
        policy = self._merge_defaults({})
        self._policy = policy
        self._save()
        return policy

    def _merge_defaults(self, stored: dict[str, Any]) -> dict[str, Any]:
        merged = json.loads(json.dumps(DEFAULT_POLICY))
        for level_name, level in stored.items():
            if level_name not in merged or not isinstance(level, dict):
                continue
            if "active_model_id" in level:
                merged[level_name]["active_model_id"] = level["active_model_id"]
            stored_models = level.get("models")
            if isinstance(stored_models, dict):
                for model_id, config in stored_models.items():
                    if model_id in merged[level_name]["models"] and isinstance(config, dict):
                        merged[level_name]["models"][model_id]["enabled"] = bool(config.get("enabled"))
        self._apply_temporal_fallback(merged)
        self._apply_graph_fallback(merged)
        return merged

    @staticmethod
    def _apply_temporal_fallback(policy: dict[str, Any]) -> None:
        temporal = policy.get("temporal") or {}
        models = temporal.get("models") or {}
        active_model_id = temporal.get("active_model_id")
        active_enabled = bool(active_model_id and (models.get(active_model_id) or {}).get("enabled"))
        fallback_enabled = bool((models.get("temporal_rules_engine") or {}).get("enabled"))
        if not active_enabled and fallback_enabled:
            temporal["active_model_id"] = "temporal_rules_engine"

    @staticmethod
    def _apply_graph_fallback(policy: dict[str, Any]) -> None:
        graph = policy.get("graph") or {}
        models = graph.get("models") or {}
        active_model_id = graph.get("active_model_id")
        active_enabled = bool(active_model_id and (models.get(active_model_id) or {}).get("enabled"))
        fallback_enabled = bool((models.get("graph_rules_engine") or {}).get("enabled"))
        if not active_enabled and fallback_enabled:
            graph["active_model_id"] = "graph_rules_engine"

    @staticmethod
    def _effective_active_model_id(analysis_level: str, level: dict[str, Any]) -> str | None:
        active_model_id = level.get("active_model_id")
        models = level.get("models") or {}
        if active_model_id and (models.get(active_model_id) or {}).get("enabled"):
            return str(active_model_id)
        if analysis_level == "temporal" and (models.get("temporal_rules_engine") or {}).get("enabled"):
            return "temporal_rules_engine"
        if analysis_level == "graph" and (models.get("graph_rules_engine") or {}).get("enabled"):
            return "graph_rules_engine"
        return None

    def _save(self) -> None:
        temporary_path = self.path.with_suffix(f"{self.path.suffix}.tmp")
        temporary_path.write_text(json.dumps(self._policy, indent=2), encoding="utf-8")
        temporary_path.replace(self.path)

    def _enriched_policy(self) -> dict[str, Any]:
        return {
            level_name: self._enriched_level(level_name, level)
            for level_name, level in self._policy.items()
        }

    def _enriched_level(self, level_name: str, level: dict[str, Any]) -> dict[str, Any]:
        active_model_id = self._effective_active_model_id(level_name, level)
        models = []
        for model_id, config in (level.get("models") or {}).items():
            model_class = ModelRegistry.get_model_class(model_id)
            model = model_class(self.path.parent) if model_class else None
            if model:
                model.load()
            models.append(
                {
                    "model_id": model_id,
                    "model_name": model_class.model_name if model_class else model_id,
                    "analysis_level": level_name,
                    "enabled": bool(config.get("enabled")),
                    "active": model_id == active_model_id and bool(config.get("enabled")),
                    "version": model_class.version if model_class else None,
                    "trained_status": (
                        "not_required"
                        if model and model.model_type == "rules"
                        else "trained"
                        if model and model.is_trained
                        else "not_trained"
                    ),
                    "last_trained_at": None,
                    "freshness_score": None,
                    "drift_score": None,
                    "retraining_recommended": None,
                }
            )
        active_available = bool(
            active_model_id
            and ((level.get("models") or {}).get(active_model_id) or {}).get("enabled")
        )
        return {
            "analysis_level": level_name,
            "active_model_id": active_model_id,
            "available": active_available,
            "models": models,
        }
