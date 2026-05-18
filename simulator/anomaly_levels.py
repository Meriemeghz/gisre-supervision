EVENT_LEVEL = "event_level"
TEMPORAL_LEVEL = "temporal_sequence_level"
FLOW_LEVEL = "flow_level"
ACTOR_LEVEL = "actor_level"
DEPENDENCY_LEVEL = "dependency_graph_level"
PLATFORM_LEVEL = "platform_level"

ANALYSIS_LEVELS = {
    EVENT_LEVEL: "1 evenement individuel, appel API ou audit event.",
    TEMPORAL_LEVEL: "Evolution temporelle ou sequence de comportement.",
    FLOW_LEVEL: "Comportement d'un flow consumer -> API -> producer.",
    ACTOR_LEVEL: "Comportement global d'un acteur consommateur ou producteur.",
    DEPENDENCY_LEVEL: "Relations inter-systemes et propagation entre flows.",
    PLATFORM_LEVEL: "Sante globale GISRE, pipeline et supervision.",
}
