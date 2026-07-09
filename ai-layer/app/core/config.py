import os
from dataclasses import dataclass


def _get_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    kafka_bootstrap_servers: str = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
    kafka_group_id: str = os.getenv("KAFKA_GROUP_ID", "gisre-ai-consumer-group")
    kafka_api_calls_topic: str = os.getenv("KAFKA_API_CALLS_TOPIC", "gisre.api.calls")
    kafka_audit_events_topic: str = os.getenv("KAFKA_AUDIT_EVENTS_TOPIC", "gisre.audit.events")

    postgres_host: str = os.getenv("POSTGRES_HOST", "postgres")
    postgres_port: int = int(os.getenv("POSTGRES_PORT", "5432"))
    postgres_db: str = os.getenv("POSTGRES_DB", "gisre_db")
    postgres_user: str = os.getenv("POSTGRES_USER", "admin")
    postgres_password: str = os.getenv("POSTGRES_PASSWORD", "admin")

    ai_enable_realtime: bool = _get_bool("AI_ENABLE_REALTIME", True)
    ai_enable_historical: bool = _get_bool("AI_ENABLE_HISTORICAL", True)
    model_storage_dir: str = os.getenv("MODEL_STORAGE_DIR", "/app/models")
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    redis_url: str = os.getenv("REDIS_URL", "redis://redis:6379/0")
    cache_enabled: bool = _get_bool("CACHE_ENABLED", True)
    rl_triage_enabled: bool = _get_bool("RL_TRIAGE_ENABLED", False)
    rl_min_experiences: int = int(os.getenv("RL_MIN_EXPERIENCES", "30"))
    rl_confidence_threshold: float = float(os.getenv("RL_CONFIDENCE_THRESHOLD", "0.80"))
    rl_epsilon: float = float(os.getenv("RL_EPSILON", "0.10"))
    include_demo_feedback: bool = _get_bool("INCLUDE_DEMO_FEEDBACK", False)


settings = Settings()
