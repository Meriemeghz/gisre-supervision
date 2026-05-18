from __future__ import annotations


RECOMMENDATIONS = {
    "SLA_BREACH": "Verifier la charge, le reseau et les ressources du service concerne.",
    "HIGH_LATENCY": "Verifier la charge, le reseau et les ressources du service concerne.",
    "SERVER_ERROR": "Analyser les logs serveur du producteur et les erreurs applicatives recentes.",
    "TIMEOUT": "Verifier la disponibilite du provider et la configuration des timeouts.",
    "PROVIDER_UNREACHABLE": "Notifier l'equipe responsable du producteur et verifier la connectivite.",
    "ACCESS_DENIED": "Controler les acces, les jetons et les autorisations de l'acteur consommateur.",
    "RATE_LIMIT_EXCEEDED": "Verifier les quotas, le rythme d'appels du consommateur et la configuration de rate limiting.",
    "AUTHENTICATION_ABUSE": "Controler les acces, les jetons et les autorisations, puis surveiller l'acteur et l'adresse IP.",
    "SUSPICIOUS_ACCESS": "Controler l'adresse IP, l'acteur et les droits associes a l'API sensible.",
    "DATA_CONSISTENCY_SIGNAL": "Verifier la coherence des metadonnees techniques entre l'appel API et l'audit.",
    "LATENCY_SPIKE": "Analyser l'evolution recente des latences et comparer avec les fenetres precedentes.",
    "LATENCY_DRIFT": "Analyser l'evolution recente des latences et identifier une degradation progressive.",
    "HIGH_ERROR_RATE": "Investiguer le flux, ses dependances et les erreurs recentes cote producteur.",
    "REPEATED_FAILURES": "Investiguer le flux, ses dependances et les echecs consecutifs.",
    "TRAFFIC_SPIKE": "Verifier si l'activite est legitime ou si elle correspond a un comportement anormal.",
    "PROVIDER_SLOWDOWN": "Verifier la degradation globale du producteur sur plusieurs flux.",
    "SECURITY_FAILURE_BURST": "Renforcer la surveillance par adresse IP et acteur, puis verifier les politiques d'acces.",
    "ML_ISOLATION_FOREST": "Comparer l'evenement avec l'historique du flux et verifier les causes de l'ecart detecte par le modele ML.",
    "ML_ONE_CLASS_SVM": "Verifier pourquoi l'appel sort de la frontiere de comportement normal apprise par le modele One-Class SVM.",
    "ML_RANDOM_FOREST": "Verifier la classe d'incident predite par Random Forest et comparer avec les logs du flux concerne.",
    "ML_KMEANS_CLUSTER": "Comparer l'appel avec les profils de clusters habituels et verifier la cause de son eloignement statistique.",
    "ML_AUTOENCODER": "Analyser les variables responsables de l'erreur de reconstruction et comparer l'appel avec les patterns normaux appris.",
    "DL_GRU_SEQUENCE": "Analyser la sequence recente de latence du flux et verifier les causes de l'ecart temporel predit par le modele GRU.",
}


class RecommendationService:
    def recommendation_for(self, anomaly_type: str) -> str:
        return RECOMMENDATIONS.get(anomaly_type, "Analyser le contexte technique et confirmer l'incident avec l'equipe responsable.")
