PERFORMANCE = "performance"
SECURITY = "security"
DATA_QUALITY = "traceability"
TRAFFIC = "traffic"
RELIABILITY = "reliability"
AVAILABILITY = "reliability"
OBSERVABILITY = "traceability"
DEPENDENCY = "dependency"
PLATFORM = "platform"
BEHAVIOR = "behavior"

ANOMALY_FAMILIES = {
    PERFORMANCE: "Latence, SLA, degradation de performance.",
    SECURITY: "Acces, authentification, autorisation et abus.",
    DATA_QUALITY: "Payload, correlation, ordre et coherence des donnees.",
    TRAFFIC: "Volume, pics, chute ou changement d'usage.",
    RELIABILITY: "Erreurs, retries, flapping et instabilite.",
    AVAILABILITY: "Indisponibilite partielle ou totale.",
    OBSERVABILITY: "Collecte de metriques, audit et monitoring.",
    DEPENDENCY: "Propagation, dependances et graphe inter-systemes.",
    PLATFORM: "Sante globale de la plateforme GISRE.",
    BEHAVIOR: "Profil acteur, usage inhabituel et activite anormale.",
}
