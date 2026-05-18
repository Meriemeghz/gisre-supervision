import json
import os
import random
import time
import uuid
from datetime import datetime, timezone

import psycopg2
from kafka import KafkaProducer
from kafka.errors import NoBrokersAvailable
from psycopg2.extras import RealDictCursor

from anomaly_catalog import ANOMALY_CATALOG, get_anomaly
from anomaly_levels import ACTOR_LEVEL, DEPENDENCY_LEVEL, EVENT_LEVEL, FLOW_LEVEL, PLATFORM_LEVEL, TEMPORAL_LEVEL


API_CALL_TOPIC = "gisre.api.calls"
AUDIT_EVENT_TOPIC = "gisre.audit.events"

ENABLE_ANOMALIES = True
ANOMALY_PROBABILITY = 0.15
TRAFFIC_MULTIPLIER = 3
BASE_SLEEP_SECONDS = 1

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "postgres"),
    "port": os.getenv("DB_PORT", "5432"),
    "dbname": os.getenv("DB_NAME", "gisre_db"),
    "user": os.getenv("DB_USER", "admin"),
    "password": os.getenv("DB_PASSWORD", "admin"),
}

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")

SOURCE_IPS = [
    "10.10.1.12",
    "10.10.1.25",
    "10.20.3.8",
    "172.16.5.44",
    "192.168.10.21",
]

FLOW_ANOMALY_MAPPING = {
    "F1": "sla_breach",
    "F4": "traffic_spike",
    "F7": "high_error_rate",
    "F13": "provider_slowdown",
    "F14": "timeout_burst",
    "F18": "authentication_abuse",
    "F23": "repeated_502_errors",
    "F24": "provider_unreachable",
    "F27": "latency_drift",
    "F29": "access_denied_anomaly",
    "F35": "unexpected_volume",
    "F36": "corrupted_event_payload",
}

ACTIVE_SCENARIOS = []
EVENT_SEQUENCE_NUMBER = 0

SOURCE_REGIONS = [
    "Rabat-Sale-Kenitra",
    "Casablanca-Settat",
    "Fes-Meknes",
    "Marrakech-Safi",
]

LEVEL_CONTRACT = {
    EVENT_LEVEL: "event",
    TEMPORAL_LEVEL: "temporal",
    FLOW_LEVEL: "flow",
    ACTOR_LEVEL: "actor",
    DEPENDENCY_LEVEL: "graph",
    PLATFORM_LEVEL: "platform",
}

DEGRADED_MODE_ANOMALIES = {
    "sla_breach",
    "response_time_spike",
    "latency_drift",
    "gradual_performance_degradation",
    "traffic_spike",
    "traffic_drop",
    "provider_slowdown",
    "slow_api_endpoint",
    "consumer_behavior_shift",
    "api_usage_pattern_change",
}

LOCAL_RULES = {
    "latency_normal": "Latency between 60% and 95% of SLA.",
    "latency_near_sla": "Latency between 95% and 110% of SLA.",
    "sla_breach": "Latency above SLA.",
    "normal_success": "HTTP 200 with success=true.",
    "server_error": "HTTP 500/502/503 with success=false.",
    "timeout": "HTTP 504 with error_type=timeout.",
    "normal_volume": "Frequency close to expected_calls_per_minute.",
    "traffic_spike": "Temporary traffic increase.",
    "unexpected_volume": "Volume above normal behavior.",
    "authentication_abuse": "Audit outcome failure or denied.",
    "access_denied_anomaly": "HTTP 403 access denied.",
    "data_consistency_signal": "Intentional metadata inconsistency.",
    "high_error_rate": "Burst of server errors on a flow.",
    "provider_slowdown": "Provider latency degradation.",
    "timeout_burst": "Burst of timeout responses.",
    "repeated_502_errors": "Repeated 502 server errors.",
    "provider_unreachable": "Provider unavailable signal.",
    "latency_drift": "Progressive latency increase.",
}


def utc_timestamp():
    return datetime.now(timezone.utc).isoformat()


def wait_for_postgres(max_retries=30, delay_seconds=2):
    for attempt in range(1, max_retries + 1):
        try:
            conn = psycopg2.connect(connect_timeout=5, **DB_CONFIG)
            print("[POSTGRES] connexion reussie")
            return conn
        except Exception as exc:
            print(
                f"[POSTGRES] attente de PostgreSQL "
                f"({attempt}/{max_retries}) - {repr(exc)}"
            )
            time.sleep(delay_seconds)

    raise RuntimeError("PostgreSQL n'est pas accessible.")


def wait_for_kafka(max_retries=40, delay_seconds=3):
    for attempt in range(1, max_retries + 1):
        try:
            producer = KafkaProducer(
                bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
                value_serializer=lambda value: json.dumps(value).encode("utf-8"),
                key_serializer=lambda value: value.encode("utf-8"),
                retries=5,
                acks="all",
            )
            print(f"[KAFKA] Kafka pret sur {KAFKA_BOOTSTRAP_SERVERS}")
            return producer
        except NoBrokersAvailable as exc:
            print(
                f"[KAFKA] attente de Kafka "
                f"({attempt}/{max_retries}) - {repr(exc)}"
            )
            time.sleep(delay_seconds)

    raise RuntimeError("Kafka n'est pas accessible.")


def load_flows(conn):
    with conn.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute(
            """
            SELECT
                f.id AS flow_id,
                f.code AS flow_code,
                f.api_id,
                f.consumer_actor_id,
                f.producer_actor_id,
                COALESCE(f.sla_latency_ms, a.sla_latency_ms) AS sla_latency_ms,
                COALESCE(f.expected_calls_per_minute, 5) AS expected_calls_per_minute,
                GREATEST(
                    CASE p.criticality WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END,
                    CASE a.criticality WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END,
                    CASE consumer.criticality WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END,
                    CASE producer.criticality WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END
                ) AS flow_criticality_rank,
                a.code AS api_code,
                a.criticality AS api_criticality,
                a.base_path,
                consumer.code AS consumer_code,
                consumer.criticality AS consumer_criticality,
                producer.code AS producer_code,
                producer.criticality AS producer_criticality,
                p.code AS program_code,
                p.criticality AS program_criticality
            FROM flows f
            JOIN apis a ON a.id = f.api_id
            JOIN actors consumer ON consumer.id = f.consumer_actor_id
            JOIN actors producer ON producer.id = f.producer_actor_id
            LEFT JOIN programs p ON p.id = consumer.program_id
            WHERE f.is_active = TRUE
              AND a.is_active = TRUE
              AND f.code ~ '^F[0-9]+$'
            ORDER BY CAST(SUBSTRING(f.code FROM 2) AS INTEGER)
            """
        )
        flows = cursor.fetchall()

    if not flows:
        raise RuntimeError("Aucun flow actif F1-F38 trouve dans PostgreSQL.")

    print(f"[POSTGRES] {len(flows)} flows charges")
    return flows


def load_database_rules(conn):
    rules = {}
    with conn.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute(
            """
            SELECT code, name, description
            FROM detection_rules
            WHERE is_active = TRUE
            """
        )
        for row in cursor.fetchall():
            rules[row["code"]] = row["description"] or row["name"]

        cursor.execute(
            """
            SELECT metric_name, threshold_value, unit
            FROM thresholds
            WHERE status = 'active'
            """
        )
        thresholds = cursor.fetchall()

    print(f"[POSTGRES] {len(rules)} detection_rules chargees")
    print(f"[POSTGRES] {len(thresholds)} thresholds charges")
    return rules, thresholds


def get_rule_description(rule_code, database_rules):
    if rule_code in database_rules:
        return database_rules[rule_code]
    if rule_code in LOCAL_RULES:
        return LOCAL_RULES[rule_code]
    try:
        return get_anomaly(rule_code).description
    except KeyError:
        return "Simulation rule"


def choose_scenario(flow, flows):
    active = _active_scenario_for_flow(flow)
    if active:
        return _scenario_payload(active, flow)

    if ENABLE_ANOMALIES and random.random() < ANOMALY_PROBABILITY:
        definition = _choose_anomaly_definition(flow)
        scenario = _start_anomaly_scenario(definition, flow, flows)
        return _scenario_payload(scenario, flow)

    return {
        "scenario_type": "normal",
        "injected_anomaly_type": None,
        "rule_code": random.choice(["latency_normal", "normal_success", "normal_volume"]),
        "analysis_level": None,
        "anomaly_family": None,
        "anomaly_scope": None,
        "anomaly_origin": None,
        "anomaly_correlation_id": None,
        "scenario_step": None,
        "scenario_total_steps": None,
        "scenario_id": None,
        "is_anomaly": False,
        "simulation_mode": "normal",
    }


def _choose_anomaly_definition(flow):
    mapped = FLOW_ANOMALY_MAPPING.get(flow["flow_code"])
    if mapped and mapped in {item.code for item in ANOMALY_CATALOG} and random.random() < 0.55:
        return get_anomaly(mapped)

    level_weights = [
        (EVENT_LEVEL, 0.32),
        (TEMPORAL_LEVEL, 0.22),
        (FLOW_LEVEL, 0.18),
        (ACTOR_LEVEL, 0.12),
        (DEPENDENCY_LEVEL, 0.10),
        (PLATFORM_LEVEL, 0.06),
    ]
    roll = random.random()
    cumulative = 0
    selected_level = EVENT_LEVEL
    for level, weight in level_weights:
        cumulative += weight
        if roll <= cumulative:
            selected_level = level
            break
    candidates = [item for item in ANOMALY_CATALOG if item.analysis_level == selected_level]
    return random.choice(candidates)


def _start_anomaly_scenario(definition, flow, flows):
    affected_flows = _affected_flows(definition, flow, flows)
    duration = random.randint(definition.min_duration_events, definition.max_duration_events)
    origin = _scenario_origin(definition, flow)
    scenario = {
        "definition": definition,
        "scenario_id": f"scenario_{definition.code}_{uuid.uuid4().hex[:8]}",
        "anomaly_correlation_id": str(uuid.uuid4()),
        "origin": origin,
        "scope": definition.default_scope,
        "affected_flow_codes": {item["flow_code"] for item in affected_flows},
        "remaining": duration,
        "total": duration,
    }

    key = _scenario_key(scenario)
    if any(_scenario_key(item) == key for item in ACTIVE_SCENARIOS):
        return random.choice([item for item in ACTIVE_SCENARIOS if _scenario_key(item) == key])

    ACTIVE_SCENARIOS.append(scenario)
    return scenario


def _active_scenario_for_flow(flow):
    for scenario in list(ACTIVE_SCENARIOS):
        if scenario["remaining"] <= 0:
            ACTIVE_SCENARIOS.remove(scenario)
            continue
        if flow["flow_code"] in scenario["affected_flow_codes"]:
            return scenario
    return None


def _scenario_payload(scenario, flow):
    definition = scenario["definition"]
    scenario["remaining"] -= 1
    if scenario["remaining"] <= 0 and scenario in ACTIVE_SCENARIOS:
        ACTIVE_SCENARIOS.remove(scenario)

    return {
        "scenario_type": "anomalous",
        "injected_anomaly_type": definition.code,
        "rule_code": definition.code,
        "analysis_level": LEVEL_CONTRACT.get(definition.analysis_level, "event"),
        "anomaly_family": definition.anomaly_family,
        "anomaly_scope": scenario["scope"],
        "anomaly_origin": scenario["origin"],
        "anomaly_correlation_id": scenario["anomaly_correlation_id"],
        "scenario_id": scenario["scenario_id"],
        "is_anomaly": True,
        "simulation_mode": _simulation_mode(definition.code, scenario),
        "scenario_step": scenario["total"] - scenario["remaining"],
        "scenario_total_steps": scenario["total"],
        "anomaly_indicators": list(definition.indicators),
        "anomaly_impacts": list(definition.impacts),
    }


def _affected_flows(definition, flow, flows):
    if definition.analysis_level in {EVENT_LEVEL, TEMPORAL_LEVEL, FLOW_LEVEL}:
        return [flow]
    if definition.analysis_level == ACTOR_LEVEL:
        same_actor = [item for item in flows if item["consumer_actor_id"] == flow["consumer_actor_id"]]
        return same_actor or [flow]
    if definition.analysis_level == DEPENDENCY_LEVEL:
        same_provider = [item for item in flows if item["producer_actor_id"] == flow["producer_actor_id"]]
        return same_provider or [flow]
    if definition.analysis_level == PLATFORM_LEVEL:
        sample_size = max(8, int(len(flows) * 0.45))
        return random.sample(flows, min(len(flows), sample_size))
    return [flow]


def _scenario_origin(definition, flow):
    if definition.default_scope == "actor":
        return {"type": "actor", "id": str(flow["consumer_actor_id"]), "code": flow["consumer_code"]}
    if definition.default_scope == "provider":
        return {"type": "producer", "id": str(flow["producer_actor_id"]), "code": flow["producer_code"]}
    if definition.default_scope == "platform":
        return {"type": "platform", "id": "gisre", "code": "GISRE"}
    return {"type": "flow", "id": str(flow["flow_id"]), "code": flow["flow_code"]}


def _scenario_key(scenario):
    origin = scenario["origin"]
    return scenario["definition"].code, scenario["scope"], origin.get("id")


def _simulation_mode(anomaly_code, scenario):
    remaining = int(scenario.get("remaining") or 0)
    if remaining <= 1:
        return "recovery"
    if anomaly_code in DEGRADED_MODE_ANOMALIES:
        return "degraded"
    return "incident"


def _next_sequence_number():
    global EVENT_SEQUENCE_NUMBER
    EVENT_SEQUENCE_NUMBER += 1
    return EVENT_SEQUENCE_NUMBER


def _criticality_from_rank(rank):
    return {4: "critical", 3: "high", 2: "medium", 1: "low"}.get(int(rank or 2), "medium")


def latency_for_rule(flow, rule_code, scenario=None):
    sla = int(flow["sla_latency_ms"])
    progress = _scenario_progress(scenario)

    if rule_code in ("latency_normal", "normal_success", "normal_volume"):
        return random.randint(int(sla * 0.60), max(int(sla * 0.95), 1))
    if rule_code == "latency_near_sla":
        return random.randint(int(sla * 0.95), int(sla * 1.10))
    if rule_code in PERFORMANCE_ANOMALIES:
        drift_factor = 1.05 + progress * 1.15
        return random.randint(int(sla * 0.95), max(int(sla * drift_factor), sla + 1))
    if rule_code in ("sla_breach", "provider_slowdown"):
        return random.randint(sla + 1, int(sla * 1.80))
    if rule_code == "latency_drift":
        return random.randint(int(sla * 0.95), int(sla * (1.0 + progress * 0.8)))
    if rule_code in TIMEOUT_ANOMALIES:
        return random.randint(int(sla * 1.50), int(sla * 3.00))
    if rule_code in PLATFORM_PRESSURE_ANOMALIES:
        return random.randint(int(sla * 1.10), int(sla * 2.30))

    return random.randint(int(sla * 0.60), int(sla * 1.10))


def status_for_rule(rule_code):
    if rule_code in SERVER_ERROR_ANOMALIES:
        return random.choice([500, 502, 503]), False, "server_error", "failure"
    if rule_code in PROVIDER_UNREACHABLE_ANOMALIES:
        return 502, False, "server_error", "failure"
    if rule_code in TIMEOUT_ANOMALIES:
        return 504, False, "timeout", "timeout"
    if rule_code in SECURITY_DENIED_ANOMALIES:
        return 403, False, "access_denied", random.choice(["failure", "denied"])
    if rule_code in DATA_QUALITY_ANOMALIES:
        if random.random() < 0.5:
            return 500, True, "metadata_inconsistency", "success"
        return 200, False, "metadata_inconsistency", "failure"

    return 200, True, None, "success"


PERFORMANCE_ANOMALIES = {
    "response_time_spike",
    "latency_drift",
    "gradual_performance_degradation",
    "sla_instability",
    "provider_slowdown",
    "slow_api_endpoint",
    "partial_provider_degradation",
    "queue_processing_delay",
    "dependency_chain_latency",
    "critical_service_saturation",
    "resource_exhaustion_signal",
}

SERVER_ERROR_ANOMALIES = {
    "high_error_rate",
    "repeated_retry_pattern",
    "intermittent_failure",
    "service_flapping",
    "abnormal_error_after_deployment",
    "cascade_failure",
    "dependent_service_failure",
    "shared_provider_failure",
    "cross_flow_propagation",
    "synchronized_failure_pattern",
    "critical_provider_instability",
    "platform_instability_wave",
    "systemic_interoperability_failure",
}

PROVIDER_UNREACHABLE_ANOMALIES = {
    "provider_unreachable",
    "shared_provider_failure",
    "dependent_service_failure",
    "graph_connectivity_anomaly",
}

TIMEOUT_ANOMALIES = {
    "timeout",
    "timeout_burst",
    "provider_unreachable",
    "delayed_event_ingestion",
    "stream_processing_delay",
    "event_pipeline_congestion",
}

SECURITY_DENIED_ANOMALIES = {
    "authentication_abuse",
    "access_denied_anomaly",
    "unauthorized_api_attempt",
    "token_failure_pattern",
    "endpoint_enumeration",
    "ip_reputation_anomaly",
    "geo_access_anomaly",
    "privilege_misuse",
    "credential_sharing_pattern",
    "rare_combination_access",
    "security_failure_burst",
    "suspicious_access_pattern",
    "global_security_alert",
}

DATA_QUALITY_ANOMALIES = {
    "duplicate_event",
    "corrupted_event_payload",
    "missing_correlation_id",
    "out_of_order_event",
    "audit_gap",
    "missing_latency_metric",
    "error_code_shift",
    "metric_collection_failure",
    "monitoring_blind_spot",
    "observability_failure",
}

TRAFFIC_ANOMALIES = {
    "traffic_spike",
    "traffic_drop",
    "abnormal_peak_distribution",
    "rate_limit_exceeded",
    "unexpected_volume",
    "traffic_asymmetry",
    "silent_flow",
    "rare_flow_activation",
    "api_underuse",
    "consumer_overuse",
    "dependency_hotspot",
}

PLATFORM_PRESSURE_ANOMALIES = {
    "global_risk_elevation",
    "platform_health_degradation",
    "anomaly_correlation_burst",
    "hybrid_risk_signal",
}


def _scenario_progress(scenario):
    if not scenario or not scenario.get("scenario_total_steps"):
        return 1.0
    total = max(int(scenario["scenario_total_steps"]), 1)
    step = int(scenario.get("scenario_step") or 1)
    return min(1.0, max(0.05, step / total))


def build_endpoint_path(base_path, rule_code=None):
    if rule_code == "endpoint_enumeration":
        return f"{base_path}/{random.choice(['admin', 'debug', 'internal', 'config'])}/{random.randint(1, 999)}"
    return f"{base_path}{random.choice(['', '/verify', '/status', '/check'])}"


def build_events(flow, flows, database_rules):
    scenario = choose_scenario(flow, flows)
    rule_code = scenario["rule_code"]
    rule_description = get_rule_description(rule_code, database_rules)

    correlation_id = scenario.get("anomaly_correlation_id") if rule_code == "duplicate_event" else str(uuid.uuid4())
    timestamp = utc_timestamp()
    if rule_code in {"delayed_event_ingestion", "stream_processing_delay", "event_pipeline_congestion", "out_of_order_event"}:
        timestamp = datetime.fromtimestamp(time.time() - random.randint(60, 420), timezone.utc).isoformat()

    latency_ms = latency_for_rule(flow, rule_code, scenario)
    status_code, success, error_type, outcome = status_for_rule(rule_code)
    expected_volume = int(flow["expected_calls_per_minute"])

    if rule_code in {"traffic_spike", "abnormal_peak_distribution", "consumer_overuse", "dependency_hotspot"}:
        simulated_volume = expected_volume * TRAFFIC_MULTIPLIER
    elif rule_code in {"unexpected_volume", "rate_limit_exceeded"}:
        simulated_volume = expected_volume * (TRAFFIC_MULTIPLIER + 1)
    elif rule_code in {"traffic_drop", "silent_flow", "api_underuse"}:
        simulated_volume = max(0, int(expected_volume * random.uniform(0.05, 0.25)))
    else:
        simulated_volume = random.randint(
            max(1, int(expected_volume * 0.80)),
            max(1, int(expected_volume * 1.20)),
        )

    if rule_code == "rate_limit_exceeded":
        status_code, success, error_type, outcome = 429, False, "rate_limit_exceeded", "failure"

    source_ip = random.choice(SOURCE_IPS)
    ingestion_delay_ms = _ingestion_delay_for_rule(rule_code)
    flow_criticality = _criticality_from_rank(flow.get("flow_criticality_rank"))
    common_metadata = _metadata_for_rule(rule_code, scenario, source_ip)

    common_simulation_fields = {
        "scenario_type": scenario["scenario_type"],
        "injected_anomaly_type": scenario["injected_anomaly_type"],
        "rule_code": rule_code,
        "rule_description": rule_description,
        "simulation_source": "simulator",
        "is_anomaly": scenario.get("is_anomaly", False),
        "anomaly_type": scenario["injected_anomaly_type"],
        "analysis_level": scenario.get("analysis_level"),
        "anomaly_family": scenario.get("anomaly_family"),
        "anomaly_scope": scenario.get("anomaly_scope"),
        "anomaly_origin": scenario.get("anomaly_origin"),
        "anomaly_correlation_id": scenario.get("anomaly_correlation_id"),
        "scenario_id": scenario.get("scenario_id"),
        "simulation_mode": scenario.get("simulation_mode", "normal"),
        "scenario_step": scenario.get("scenario_step"),
        "scenario_total_steps": scenario.get("scenario_total_steps"),
        "anomaly_indicators": scenario.get("anomaly_indicators"),
        "anomaly_impacts": scenario.get("anomaly_impacts"),
        "program_code": flow.get("program_code"),
        "api_code": flow.get("api_code"),
        "consumer_code": flow.get("consumer_code"),
        "producer_code": flow.get("producer_code"),
        "sla_latency_ms": int(flow["sla_latency_ms"]),
        "expected_calls_per_minute": expected_volume,
        "api_criticality": flow.get("api_criticality"),
        "consumer_criticality": flow.get("consumer_criticality"),
        "producer_criticality": flow.get("producer_criticality"),
        "flow_criticality": flow_criticality,
        "ingestion_delay_ms": ingestion_delay_ms,
    }

    api_call_event = {
        "event_id": str(uuid.uuid4()),
        "event_sequence_number": _next_sequence_number(),
        "event_type": "api_call",
        "flow_id": str(flow["flow_id"]),
        "flow_code": flow["flow_code"],
        "api_id": str(flow["api_id"]),
        "consumer_actor_id": str(flow["consumer_actor_id"]),
        "producer_actor_id": str(flow["producer_actor_id"]),
        "correlation_id": correlation_id,
        "method": random.choice(["GET", "POST"]),
        "endpoint_path": build_endpoint_path(flow["base_path"], rule_code),
        "status_code": status_code,
        "latency_ms": max(0, latency_ms),
        "success": success,
        "error_type": error_type,
        "is_sla_breach": latency_ms > int(flow["sla_latency_ms"]),
        "expected_calls_per_minute": expected_volume,
        "simulated_calls_per_minute": simulated_volume,
        "source_ip": source_ip,
        "error_code": _error_code_for_rule(rule_code, status_code),
        "metadata": common_metadata,
        "timestamp": timestamp,
        **common_simulation_fields,
    }

    if rule_code == "missing_latency_metric":
        api_call_event["latency_ms"] = 0
        api_call_event["error_code"] = "missing_latency_metric_signal"
    if rule_code == "missing_correlation_id":
        api_call_event["error_code"] = "missing_correlation_id_signal"

    audit_event = {
        "event_id": str(uuid.uuid4()),
        "event_sequence_number": _next_sequence_number(),
        "event_type": "audit_event",
        "flow_id": str(flow["flow_id"]),
        "flow_code": flow["flow_code"],
        "actor_id": str(flow["consumer_actor_id"]),
        "api_id": str(flow["api_id"]),
        "correlation_id": correlation_id,
        "action": "call_api" if success else error_type,
        "outcome": outcome,
        "source_ip": source_ip,
        "metadata": common_metadata,
        "timestamp": timestamp,
        **common_simulation_fields,
    }

    return api_call_event, audit_event


def _error_code_for_rule(rule_code, status_code):
    if rule_code in DATA_QUALITY_ANOMALIES:
        return f"{rule_code}_signal"
    if status_code >= 400:
        return f"http_{status_code}"
    return None


def _ingestion_delay_for_rule(rule_code):
    if rule_code in {"delayed_event_ingestion", "stream_processing_delay", "event_pipeline_congestion"}:
        return random.randint(1500, 12000)
    if rule_code in {"monitoring_blind_spot", "observability_failure", "metric_collection_failure"}:
        return random.randint(500, 5000)
    return random.randint(0, 80)


def _metadata_for_rule(rule_code, scenario, source_ip):
    metadata = {
        "source_country": "MA",
        "source_region": random.choice(SOURCE_REGIONS),
        "source_ip_class": _ip_class(source_ip),
        "scenario_step": scenario.get("scenario_step"),
        "scenario_total_steps": scenario.get("scenario_total_steps"),
        "deployment_version": random.choice(["v1.4.2", "v1.4.3", "v1.5.0"]),
        "retry_count": 0,
    }
    if rule_code in SECURITY_DENIED_ANOMALIES:
        metadata["auth_failure_reason"] = random.choice(["invalid_token", "expired_token", "insufficient_scope", "unknown_client"])
    if rule_code in {"repeated_retry_pattern", "timeout_burst", "provider_unreachable", "intermittent_failure"}:
        metadata["retry_count"] = random.randint(1, 5)
        metadata["previous_status_code"] = random.choice([500, 502, 503, 504])
    if rule_code in DATA_QUALITY_ANOMALIES:
        metadata["data_quality_signal"] = rule_code
    return metadata


def _ip_class(source_ip):
    if source_ip.startswith("10."):
        return "internal_private"
    if source_ip.startswith("172."):
        return "partner_private"
    if source_ip.startswith("192.168."):
        return "regional_private"
    return "unknown"


def publish_event(producer, topic, event):
    producer.send(topic, key=event["correlation_id"], value=event)


def log_simulation(event):
    flow_code = event["flow_code"]
    scenario_type = event["scenario_type"]
    injected = event["injected_anomaly_type"]
    level = event.get("analysis_level")
    scope = event.get("anomaly_scope")

    if scenario_type == "anomalous":
        print(f"[SIMULATION:ANOMALOUS] flow {flow_code} level={level} scope={scope} injected={injected}")
    else:
        print(f"[SIMULATION:NORMAL] flow {flow_code}")


def run():
    conn = wait_for_postgres()
    producer = None

    try:
        producer = wait_for_kafka()
        flows = load_flows(conn)
        database_rules, _thresholds = load_database_rules(conn)
        print("[SIMULATOR] publication Kafka avec regles de simulation")
        print(f"[SIMULATOR] catalogue multi-granularite charge: {len(ANOMALY_CATALOG)} anomalies")

        while True:
            flow = random.choice(flows)
            api_call_event, audit_event = build_events(flow, flows, database_rules)

            log_simulation(api_call_event)

            publish_event(producer, API_CALL_TOPIC, api_call_event)
            print(f"[KAFKA] api_call envoye vers {API_CALL_TOPIC}")

            publish_event(producer, AUDIT_EVENT_TOPIC, audit_event)
            print(f"[KAFKA] audit_event envoye vers {AUDIT_EVENT_TOPIC}")

            producer.flush()
            time.sleep(BASE_SLEEP_SECONDS)

    finally:
        if producer is not None:
            producer.flush()
            producer.close()
        conn.close()
        print("[SIMULATOR] ressources fermees")


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        print("\n[SIMULATOR] arret propre par Ctrl+C")
