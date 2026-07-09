from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class ExperienceMemory:
    def __init__(
        self,
        *,
        model_storage_dir: str,
        cache_service: Any | None = None,
        max_experiences: int = 50000,
    ) -> None:
        self.cache_service = cache_service
        self.max_experiences = max_experiences
        self.storage_dir = Path(model_storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.memory_path = self.storage_dir / "rl_experience_memory.json"
        self.policy_path = self.storage_dir / "rl_policy.json"
        self.memory_key = "rl:experience_memory"
        self.policy_key = "rl:policy"

    def load_experiences(self) -> list[dict[str, Any]]:
        value = self._load_json(self.memory_key, self.memory_path, default=[])
        return value if isinstance(value, list) else []

    def append_experience(self, experience: dict[str, Any]) -> list[dict[str, Any]]:
        experiences = self.load_experiences()
        experiences.append(experience)
        if len(experiences) > self.max_experiences:
            experiences = experiences[-self.max_experiences:]
        self._save_json(self.memory_key, self.memory_path, experiences)
        return experiences

    def load_policy(self) -> dict[str, Any]:
        value = self._load_json(self.policy_key, self.policy_path, default={})
        return value if isinstance(value, dict) else {}

    def save_policy(self, policy: dict[str, Any]) -> None:
        self._save_json(self.policy_key, self.policy_path, policy)

    def _load_json(self, key: str, path: Path, *, default: Any) -> Any:
        if self.cache_service is not None:
            cached = self.cache_service.get_json(key)
            if cached is not None:
                return cached
        if not path.exists():
            return default
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("[RL] failed to read %s: %s", path, exc)
            return default

    def _save_json(self, key: str, path: Path, value: Any) -> None:
        if self.cache_service is not None:
            self.cache_service.set_json(key, value, ttl=24 * 60 * 60)
        try:
            path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        except Exception as exc:
            logger.warning("[RL] failed to write %s: %s", path, exc)
