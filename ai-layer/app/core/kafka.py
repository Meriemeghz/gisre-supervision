import json
from typing import Any


def decode_kafka_value(value: bytes) -> dict[str, Any]:
    decoded = value.decode("utf-8")
    payload = json.loads(decoded)
    if not isinstance(payload, dict):
        raise ValueError("Kafka message must be a JSON object")
    return payload
