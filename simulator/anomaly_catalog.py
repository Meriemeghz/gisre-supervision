from __future__ import annotations

from dataclasses import dataclass

from anomaly_families import (
    AVAILABILITY,
    BEHAVIOR,
    DATA_QUALITY,
    DEPENDENCY,
    OBSERVABILITY,
    PERFORMANCE,
    PLATFORM,
    RELIABILITY,
    SECURITY,
    TRAFFIC,
)
from anomaly_levels import (
    ACTOR_LEVEL,
    DEPENDENCY_LEVEL,
    EVENT_LEVEL,
    FLOW_LEVEL,
    PLATFORM_LEVEL,
    TEMPORAL_LEVEL,
)


@dataclass(frozen=True)
class AnomalyDefinition:
    code: str
    analysis_level: str
    anomaly_family: str
    description: str
    indicators: tuple[str, ...]
    impacts: tuple[str, ...]
    default_scope: str
    min_duration_events: int = 1
    max_duration_events: int = 1
    event_bias: str = "api_call"


def anomaly(
    code: str,
    level: str,
    family: str,
    description: str,
    indicators: tuple[str, ...],
    impacts: tuple[str, ...],
    scope: str,
    duration: tuple[int, int],
    event_bias: str = "api_call",
) -> AnomalyDefinition:
    return AnomalyDefinition(code, level, family, description, indicators, impacts, scope, duration[0], duration[1], event_bias)


ANOMALY_CATALOG = [
    # Event-level anomalies.
    anomaly("sla_breach", EVENT_LEVEL, PERFORMANCE, "Depassement ponctuel du SLA de latence.", ("latency_ms", "sla_latency_ms", "is_sla_breach"), ("Retard utilisateur", "SLA degrade"), "event", (1, 1)),
    anomaly("response_time_spike", EVENT_LEVEL, PERFORMANCE, "Pic brutal de temps de reponse sur un appel.", ("latency_ms", "latency_ratio"), ("Experience degradee",), "event", (1, 1)),
    anomaly("authentication_abuse", EVENT_LEVEL, SECURITY, "Echec d'authentification ou abus ponctuel.", ("outcome", "action", "source_ip"), ("Risque securite",), "event", (1, 1), "audit_event"),
    anomaly("access_denied_anomaly", EVENT_LEVEL, SECURITY, "Acces refuse anormal sur une API.", ("status_code", "outcome", "error_type"), ("Blocage metier", "Risque abus"), "event", (1, 1)),
    anomaly("unauthorized_api_attempt", EVENT_LEVEL, SECURITY, "Tentative d'appel non autorisee.", ("status_code", "actor_id", "api_id"), ("Risque d'acces non conforme",), "event", (1, 1)),
    anomaly("token_failure_pattern", EVENT_LEVEL, SECURITY, "Jeton invalide, expire ou incoherent.", ("action", "outcome", "source_ip"), ("Echec authentification",), "event", (1, 1), "audit_event"),
    anomaly("rate_limit_exceeded", EVENT_LEVEL, TRAFFIC, "Limite de debit depassee.", ("status_code", "simulated_calls_per_minute"), ("Saturation API",), "event", (1, 1)),
    anomaly("duplicate_event", EVENT_LEVEL, DATA_QUALITY, "Evenement duplique avec meme correlation.", ("correlation_id", "event_id"), ("Biais monitoring",), "event", (1, 1)),
    anomaly("corrupted_event_payload", EVENT_LEVEL, DATA_QUALITY, "Payload technique incoherent.", ("payload", "technical_context"), ("Donnee inexploitable",), "event", (1, 1)),
    anomaly("missing_correlation_id", EVENT_LEVEL, DATA_QUALITY, "Correlation absente ou degradee.", ("correlation_id",), ("Traçabilite faible",), "event", (1, 1)),
    anomaly("out_of_order_event", EVENT_LEVEL, DATA_QUALITY, "Evenement horodate dans le mauvais ordre.", ("timestamp",), ("Analyse sequence perturbee",), "event", (1, 1)),
    anomaly("audit_gap", EVENT_LEVEL, OBSERVABILITY, "Audit event manquant ou incomplet.", ("audit_event", "correlation_id"), ("Trou observabilite",), "event", (1, 1), "audit_event"),
    anomaly("missing_latency_metric", EVENT_LEVEL, OBSERVABILITY, "Metrique de latence manquante ou remplacee.", ("latency_ms",), ("Analyse performance degradee",), "event", (1, 1)),
    anomaly("error_code_shift", EVENT_LEVEL, RELIABILITY, "Code erreur inattendu pour un flow.", ("status_code", "error_code"), ("Diagnostic plus difficile",), "event", (1, 1)),
    anomaly("endpoint_enumeration", EVENT_LEVEL, SECURITY, "Enumeration suspecte d'endpoints.", ("endpoint_path", "source_ip"), ("Risque reconnaissance",), "event", (1, 1)),

    # Temporal / sequence-level anomalies.
    anomaly("latency_drift", TEMPORAL_LEVEL, PERFORMANCE, "Latence qui augmente progressivement.", ("latency_ms", "latency_ratio"), ("Degradation progressive",), "flow", (8, 18)),
    anomaly("gradual_performance_degradation", TEMPORAL_LEVEL, PERFORMANCE, "Performance qui se degrade dans le temps.", ("p95_latency", "latency_ratio"), ("SLA futur menace",), "flow", (10, 22)),
    anomaly("sla_instability", TEMPORAL_LEVEL, PERFORMANCE, "Alternance de respect et depassement SLA.", ("is_sla_breach", "latency_ms"), ("Instabilite visible",), "flow", (8, 18)),
    anomaly("timeout_burst", TEMPORAL_LEVEL, RELIABILITY, "Rafale de timeouts.", ("status_code", "error_type"), ("Indisponibilite partielle",), "flow", (5, 14)),
    anomaly("traffic_spike", TEMPORAL_LEVEL, TRAFFIC, "Pic de trafic temporel.", ("request_rate", "simulated_calls_per_minute"), ("Risque saturation",), "flow", (6, 15)),
    anomaly("traffic_drop", TEMPORAL_LEVEL, TRAFFIC, "Chute progressive du trafic.", ("request_rate",), ("Suspicion rupture usage",), "flow", (8, 20)),
    anomaly("abnormal_peak_distribution", TEMPORAL_LEVEL, TRAFFIC, "Pics anormalement concentres.", ("request_rate", "timestamp"), ("Charge imprevisible",), "flow", (8, 18)),
    anomaly("business_hours_deviation", TEMPORAL_LEVEL, BEHAVIOR, "Activite hors horaires habituels.", ("timestamp", "actor_id"), ("Risque usage anormal",), "actor", (8, 18)),
    anomaly("consumer_profile_drift", TEMPORAL_LEVEL, BEHAVIOR, "Profil consommateur qui derive.", ("consumer_actor_id", "api_id"), ("Usage metier change",), "actor", (10, 20)),
    anomaly("api_usage_pattern_change", TEMPORAL_LEVEL, BEHAVIOR, "Changement de pattern d'usage API.", ("api_id", "request_rate"), ("Risque comportement inattendu",), "flow", (10, 20)),
    anomaly("delayed_event_ingestion", TEMPORAL_LEVEL, OBSERVABILITY, "Retard d'ingestion des evenements.", ("timestamp", "created_at"), ("Monitoring retarde",), "platform", (8, 18)),
    anomaly("intermittent_failure", TEMPORAL_LEVEL, RELIABILITY, "Erreurs intermittentes dans une sequence.", ("success", "status_code"), ("Instabilite intermittente",), "flow", (8, 18)),
    anomaly("service_flapping", TEMPORAL_LEVEL, AVAILABILITY, "Service alterne disponible/indisponible.", ("status_code", "success"), ("Disponibilite instable",), "flow", (8, 18)),
    anomaly("resource_exhaustion_signal", TEMPORAL_LEVEL, PERFORMANCE, "Signal d'epuisement de ressources.", ("latency_ms", "timeout_rate"), ("Saturation progressive",), "flow", (8, 18)),
    anomaly("stream_processing_delay", TEMPORAL_LEVEL, OBSERVABILITY, "Retard de traitement du stream.", ("timestamp", "processing_delay"), ("Observabilite retardee",), "platform", (8, 18)),

    # Flow-level anomalies.
    anomaly("provider_slowdown", FLOW_LEVEL, PERFORMANCE, "Ralentissement du provider sur un flow.", ("producer_actor_id", "latency_ms"), ("SLA degrade",), "flow", (8, 16)),
    anomaly("slow_api_endpoint", FLOW_LEVEL, PERFORMANCE, "Endpoint API durablement lent.", ("endpoint_path", "latency_ms"), ("Experience degradee",), "flow", (8, 16)),
    anomaly("partial_provider_degradation", FLOW_LEVEL, AVAILABILITY, "Provider partiellement degrade.", ("producer_actor_id", "success"), ("Qualite service reduite",), "flow", (8, 16)),
    anomaly("high_error_rate", FLOW_LEVEL, RELIABILITY, "Taux d'erreur eleve sur un flow.", ("status_code", "success"), ("Flux instable",), "flow", (7, 16)),
    anomaly("silent_flow", FLOW_LEVEL, OBSERVABILITY, "Flow silencieux ou quasi muet.", ("request_rate",), ("Rupture potentielle",), "flow", (8, 16)),
    anomaly("traffic_asymmetry", FLOW_LEVEL, TRAFFIC, "Volume asymetrique par rapport au profil.", ("expected_calls_per_minute", "simulated_calls_per_minute"), ("Charge anormale",), "flow", (8, 16)),
    anomaly("repeated_retry_pattern", FLOW_LEVEL, RELIABILITY, "Retries repetes sur le meme flow.", ("correlation_id", "status_code"), ("Surcharge secondaire",), "flow", (6, 14)),
    anomaly("rare_flow_activation", FLOW_LEVEL, BEHAVIOR, "Activation rare d'un flow peu utilise.", ("flow_code", "request_rate"), ("Usage inhabituel",), "flow", (6, 12)),
    anomaly("workflow_sequence_anomaly", FLOW_LEVEL, BEHAVIOR, "Sequence workflow anormale.", ("flow_code", "timestamp"), ("Processus metier perturbe",), "flow", (8, 16)),
    anomaly("critical_flow_instability", FLOW_LEVEL, RELIABILITY, "Instabilite sur flow critique.", ("criticality", "status_code"), ("Impact metier fort",), "flow", (8, 16)),
    anomaly("unexpected_volume", FLOW_LEVEL, TRAFFIC, "Volume inattendu sur un flow.", ("request_rate",), ("Surcharge ou abus",), "flow", (7, 16)),
    anomaly("queue_processing_delay", FLOW_LEVEL, PERFORMANCE, "Delai de file de traitement.", ("latency_ms", "processing_delay"), ("Retard applicatif",), "flow", (8, 16)),
    anomaly("abnormal_error_after_deployment", FLOW_LEVEL, RELIABILITY, "Erreurs apres changement/deploiement.", ("status_code", "timestamp"), ("Regression possible",), "flow", (8, 16)),
    anomaly("api_underuse", FLOW_LEVEL, TRAFFIC, "Sous-utilisation inhabituelle d'une API.", ("request_rate",), ("Rupture consommation",), "flow", (8, 16)),

    # Actor-level anomalies.
    anomaly("consumer_overuse", ACTOR_LEVEL, TRAFFIC, "Surutilisation par un consommateur.", ("consumer_actor_id", "request_rate"), ("Charge excessive",), "actor", (10, 24)),
    anomaly("off_hours_activity", ACTOR_LEVEL, BEHAVIOR, "Activite hors horaires d'un acteur.", ("timestamp", "actor_id"), ("Suspicion comportement",), "actor", (10, 24)),
    anomaly("ip_reputation_anomaly", ACTOR_LEVEL, SECURITY, "IP source suspecte pour un acteur.", ("source_ip", "actor_id"), ("Risque securite",), "actor", (8, 18), "audit_event"),
    anomaly("geo_access_anomaly", ACTOR_LEVEL, SECURITY, "Acces depuis zone inhabituelle.", ("source_ip", "actor_id"), ("Risque compromission",), "actor", (8, 18), "audit_event"),
    anomaly("privilege_misuse", ACTOR_LEVEL, SECURITY, "Usage privilege non habituel.", ("actor_id", "api_id"), ("Risque autorisation",), "actor", (8, 18), "audit_event"),
    anomaly("credential_sharing_pattern", ACTOR_LEVEL, SECURITY, "Pattern possible de partage d'identifiants.", ("actor_id", "source_ip"), ("Risque compte compromis",), "actor", (8, 18), "audit_event"),
    anomaly("consumer_behavior_shift", ACTOR_LEVEL, BEHAVIOR, "Changement global de comportement consommateur.", ("consumer_actor_id", "api_id"), ("Usage anormal",), "actor", (10, 24)),
    anomaly("behavioral_outlier", ACTOR_LEVEL, BEHAVIOR, "Acteur outlier par rapport aux habitudes.", ("actor_id", "request_rate"), ("Investigation requise",), "actor", (10, 24)),
    anomaly("rare_combination_access", ACTOR_LEVEL, SECURITY, "Combinaison acteur/API rare.", ("actor_id", "api_id"), ("Acces atypique",), "actor", (8, 18), "audit_event"),
    anomaly("unusual_api_usage", ACTOR_LEVEL, BEHAVIOR, "Usage API inhabituel par acteur.", ("actor_id", "api_id"), ("Ecart metier",), "actor", (8, 18)),
    anomaly("security_failure_burst", ACTOR_LEVEL, SECURITY, "Rafale d'echecs securite pour un acteur.", ("outcome", "source_ip"), ("Risque attaque",), "actor", (8, 18), "audit_event"),
    anomaly("suspicious_access_pattern", ACTOR_LEVEL, SECURITY, "Pattern d'acces suspect.", ("actor_id", "source_ip"), ("Risque abus",), "actor", (8, 18), "audit_event"),

    # Dependency / graph-level anomalies.
    anomaly("cascade_failure", DEPENDENCY_LEVEL, DEPENDENCY, "Propagation d'echec en cascade.", ("producer_actor_id", "flow_code"), ("Impact multi-flows",), "provider", (10, 24)),
    anomaly("dependent_service_failure", DEPENDENCY_LEVEL, DEPENDENCY, "Service dependant en echec.", ("dependency", "status_code"), ("Propagation incident",), "provider", (10, 24)),
    anomaly("multi_consumer_impact", DEPENDENCY_LEVEL, DEPENDENCY, "Plusieurs consommateurs impactes.", ("producer_actor_id", "consumer_actor_id"), ("Incident transversal",), "provider", (10, 24)),
    anomaly("shared_provider_failure", DEPENDENCY_LEVEL, DEPENDENCY, "Provider commun en echec.", ("producer_actor_id", "status_code"), ("Incident provider",), "provider", (10, 24)),
    anomaly("dependency_hotspot", DEPENDENCY_LEVEL, DEPENDENCY, "Dependance centrale surchargee.", ("producer_actor_id", "request_rate"), ("Point chaud",), "provider", (10, 24)),
    anomaly("cross_flow_propagation", DEPENDENCY_LEVEL, DEPENDENCY, "Propagation entre flows.", ("flow_code", "producer_actor_id"), ("Correlation incident",), "provider", (10, 24)),
    anomaly("interoperability_degradation", DEPENDENCY_LEVEL, DEPENDENCY, "Interop degradee entre systemes.", ("flow_code", "latency_ms"), ("Qualite echange degradee",), "provider", (10, 24)),
    anomaly("synchronized_failure_pattern", DEPENDENCY_LEVEL, DEPENDENCY, "Echecs synchronises.", ("timestamp", "flow_code"), ("Incident commun probable",), "provider", (10, 24)),
    anomaly("dependency_chain_latency", DEPENDENCY_LEVEL, PERFORMANCE, "Latence de chaine de dependance.", ("latency_ms", "dependency"), ("SLA global degrade",), "provider", (10, 24)),
    anomaly("critical_provider_instability", DEPENDENCY_LEVEL, AVAILABILITY, "Provider critique instable.", ("producer_actor_id", "criticality"), ("Impact fort",), "provider", (10, 24)),
    anomaly("graph_connectivity_anomaly", DEPENDENCY_LEVEL, DEPENDENCY, "Anomalie de connectivite graphe.", ("consumer_actor_id", "producer_actor_id"), ("Rupture relationnelle",), "provider", (10, 24)),

    # Platform-level anomalies.
    anomaly("global_risk_elevation", PLATFORM_LEVEL, PLATFORM, "Elevation globale du risque.", ("risk_score", "incident_count"), ("Alerte globale",), "platform", (16, 36)),
    anomaly("platform_health_degradation", PLATFORM_LEVEL, PLATFORM, "Sante plateforme degradee.", ("availability", "latency_ms"), ("Qualite globale degradee",), "platform", (16, 36)),
    anomaly("metric_collection_failure", PLATFORM_LEVEL, OBSERVABILITY, "Collecte metrique defaillante.", ("metrics",), ("Monitoring incomplet",), "platform", (12, 28)),
    anomaly("monitoring_blind_spot", PLATFORM_LEVEL, OBSERVABILITY, "Zone aveugle supervision.", ("audit_gap", "metrics"), ("Incident invisible",), "platform", (12, 28)),
    anomaly("systemic_interoperability_failure", PLATFORM_LEVEL, PLATFORM, "Echec d'interoperabilite systemique.", ("flow_code", "producer_actor_id"), ("Impact ecosysteme",), "platform", (16, 36)),
    anomaly("platform_instability_wave", PLATFORM_LEVEL, PLATFORM, "Vague d'instabilite plateforme.", ("status_code", "latency_ms"), ("Degradation large",), "platform", (16, 36)),
    anomaly("anomaly_correlation_burst", PLATFORM_LEVEL, PLATFORM, "Burst d'anomalies correlees.", ("anomaly_count", "timestamp"), ("Risque majeur",), "platform", (16, 36)),
    anomaly("global_security_alert", PLATFORM_LEVEL, SECURITY, "Alerte securite globale.", ("security_failure", "source_ip"), ("Risque cyber transversal",), "platform", (12, 28), "audit_event"),
    anomaly("critical_service_saturation", PLATFORM_LEVEL, PERFORMANCE, "Saturation services critiques.", ("criticality", "latency_ms"), ("Impact metier fort",), "platform", (16, 36)),
    anomaly("event_pipeline_congestion", PLATFORM_LEVEL, OBSERVABILITY, "Congestion pipeline evenementiel.", ("processing_delay", "timestamp"), ("Retard monitoring",), "platform", (12, 28)),
    anomaly("observability_failure", PLATFORM_LEVEL, OBSERVABILITY, "Defaillance observabilite.", ("audit_gap", "missing_metric"), ("Perte visibilite",), "platform", (12, 28)),
    anomaly("hybrid_risk_signal", PLATFORM_LEVEL, PLATFORM, "Signal hybride de risque global.", ("risk_score", "criticality"), ("Priorisation supervision",), "platform", (12, 28)),
]


ANOMALIES_BY_CODE = {item.code: item for item in ANOMALY_CATALOG}


def get_anomaly(code: str) -> AnomalyDefinition:
    return ANOMALIES_BY_CODE[code]


def catalog_by_level(level: str) -> list[AnomalyDefinition]:
    return [item for item in ANOMALY_CATALOG if item.analysis_level == level]
