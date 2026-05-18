CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE programs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL,
    description TEXT,
    owner_organization VARCHAR(160),
    criticality VARCHAR(20) NOT NULL DEFAULT 'medium',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT programs_criticality_check
        CHECK (criticality IN ('low', 'medium', 'high', 'critical'))
);

CREATE TABLE actors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id UUID REFERENCES programs(id) ON DELETE SET NULL,
    code VARCHAR(60) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL,
    actor_type VARCHAR(20) NOT NULL,
    organization_name VARCHAR(160),
    contact_email VARCHAR(160),
    criticality VARCHAR(20) NOT NULL DEFAULT 'medium',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT actors_type_check
        CHECK (actor_type IN ('producer', 'consumer', 'producer_consumer')),
    CONSTRAINT actors_criticality_check
        CHECK (criticality IN ('low', 'medium', 'high', 'critical'))
);

CREATE INDEX idx_actors_program
    ON actors (program_id);

CREATE INDEX idx_actors_type_active
    ON actors (actor_type, is_active);

CREATE TABLE apis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producer_actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
    code VARCHAR(80) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL,
    base_path TEXT NOT NULL,
    version VARCHAR(40) NOT NULL,
    protocol VARCHAR(20) NOT NULL DEFAULT 'REST',
    auth_type VARCHAR(40) NOT NULL,
    sla_availability_percent NUMERIC(5, 2) NOT NULL,
    sla_latency_ms INTEGER NOT NULL,
    rate_limit_per_minute INTEGER,
    criticality VARCHAR(20) NOT NULL DEFAULT 'medium',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT apis_protocol_check
        CHECK (protocol IN ('REST', 'SOAP', 'GRAPHQL', 'EVENT')),
    CONSTRAINT apis_auth_type_check
        CHECK (auth_type IN ('none', 'api_key', 'oauth2', 'mtls', 'jwt')),
    CONSTRAINT apis_availability_check
        CHECK (sla_availability_percent >= 0 AND sla_availability_percent <= 100),
    CONSTRAINT apis_latency_check
        CHECK (sla_latency_ms > 0),
    CONSTRAINT apis_rate_limit_check
        CHECK (rate_limit_per_minute IS NULL OR rate_limit_per_minute > 0),
    CONSTRAINT apis_criticality_check
        CHECK (criticality IN ('low', 'medium', 'high', 'critical')),
    CONSTRAINT apis_id_producer_unique
        UNIQUE (id, producer_actor_id)
);

CREATE INDEX idx_apis_producer
    ON apis (producer_actor_id);

CREATE TABLE flows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(180) NOT NULL,
    api_id UUID NOT NULL REFERENCES apis(id) ON DELETE RESTRICT,
    consumer_actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
    producer_actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
    direction VARCHAR(20) NOT NULL DEFAULT 'consumer_to_producer',
    expected_calls_per_minute INTEGER,
    sla_latency_ms INTEGER,
    sla_success_rate_percent NUMERIC(5, 2),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT flows_direction_check
        CHECK (direction IN ('consumer_to_producer', 'producer_to_consumer', 'bidirectional')),
    CONSTRAINT flows_distinct_actors_check
        CHECK (consumer_actor_id <> producer_actor_id),
    CONSTRAINT flows_expected_calls_check
        CHECK (expected_calls_per_minute IS NULL OR expected_calls_per_minute >= 0),
    CONSTRAINT flows_latency_check
        CHECK (sla_latency_ms IS NULL OR sla_latency_ms > 0),
    CONSTRAINT flows_success_rate_check
        CHECK (sla_success_rate_percent IS NULL OR sla_success_rate_percent BETWEEN 0 AND 100),
    CONSTRAINT flows_api_producer_fk
        FOREIGN KEY (api_id, producer_actor_id) REFERENCES apis(id, producer_actor_id),
    CONSTRAINT flows_identity_unique
        UNIQUE (id, api_id, consumer_actor_id, producer_actor_id)
);

CREATE INDEX idx_flows_api
    ON flows (api_id);

CREATE INDEX idx_flows_consumer_producer
    ON flows (consumer_actor_id, producer_actor_id);

CREATE INDEX idx_flows_producer_consumer
    ON flows (producer_actor_id, consumer_actor_id);

CREATE TABLE detection_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(180) NOT NULL,
    description TEXT,
    scope VARCHAR(30) NOT NULL,
    target_program_id UUID REFERENCES programs(id) ON DELETE SET NULL,
    target_api_id UUID REFERENCES apis(id) ON DELETE SET NULL,
    target_flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
    metric_name VARCHAR(120),
    operator VARCHAR(20) NOT NULL,
    threshold_value NUMERIC(14, 4),
    evaluation_window_seconds INTEGER NOT NULL,
    severity VARCHAR(20) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT detection_rules_scope_check
        CHECK (scope IN ('global', 'program', 'api', 'flow')),
    CONSTRAINT detection_rules_operator_check
        CHECK (operator IN ('gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'rate_change', 'absence')),
    CONSTRAINT detection_rules_window_check
        CHECK (evaluation_window_seconds > 0),
    CONSTRAINT detection_rules_severity_check
        CHECK (severity IN ('low', 'medium', 'high', 'critical'))
);

CREATE INDEX idx_detection_rules_scope
    ON detection_rules (scope, is_active);

CREATE INDEX idx_detection_rules_targets
    ON detection_rules (target_program_id, target_api_id, target_flow_id)
    WHERE is_active = TRUE;

CREATE TABLE api_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE RESTRICT,
    api_id UUID NOT NULL REFERENCES apis(id) ON DELETE RESTRICT,
    consumer_actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
    producer_actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
    correlation_id VARCHAR(120) NOT NULL,
    endpoint_path TEXT NOT NULL,
    method VARCHAR(10) NOT NULL,
    status_code INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    success BOOLEAN NOT NULL DEFAULT TRUE,
    error_type VARCHAR(80),
    request_size_bytes INTEGER,
    response_size_bytes INTEGER,
    called_at TIMESTAMPTZ NOT NULL,
    source_ip INET,
    gateway_node VARCHAR(120),
    is_sla_breach BOOLEAN NOT NULL DEFAULT FALSE,
    error_code VARCHAR(80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT api_calls_method_check
        CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS')),
    CONSTRAINT api_calls_status_code_check
        CHECK (status_code BETWEEN 100 AND 599),
    CONSTRAINT api_calls_latency_check
        CHECK (latency_ms >= 0),
    CONSTRAINT api_calls_request_size_check
        CHECK (request_size_bytes IS NULL OR request_size_bytes >= 0),
    CONSTRAINT api_calls_response_size_check
        CHECK (response_size_bytes IS NULL OR response_size_bytes >= 0),
    CONSTRAINT api_calls_flow_identity_fk
        FOREIGN KEY (flow_id, api_id, consumer_actor_id, producer_actor_id)
        REFERENCES flows(id, api_id, consumer_actor_id, producer_actor_id)
);

CREATE INDEX idx_api_calls_flow_called_at
    ON api_calls (flow_id, called_at DESC);

CREATE INDEX idx_api_calls_api_called_at
    ON api_calls (api_id, called_at DESC);

CREATE INDEX idx_api_calls_status_code
    ON api_calls (status_code);

CREATE INDEX idx_api_calls_actor_called_at
    ON api_calls (consumer_actor_id, producer_actor_id, called_at DESC);

CREATE INDEX idx_api_calls_correlation_id
    ON api_calls (correlation_id);

CREATE INDEX idx_api_calls_errors_dashboard
    ON api_calls (api_id, called_at DESC, error_type)
    WHERE success = FALSE;

CREATE INDEX idx_api_calls_latency_dashboard
    ON api_calls (api_id, latency_ms DESC, called_at DESC);

CREATE TABLE audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id UUID REFERENCES programs(id) ON DELETE SET NULL,
    actor_id UUID REFERENCES actors(id) ON DELETE SET NULL,
    api_id UUID REFERENCES apis(id) ON DELETE SET NULL,
    flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
    correlation_id VARCHAR(120),
    event_type VARCHAR(80) NOT NULL,
    action VARCHAR(120) NOT NULL,
    outcome VARCHAR(20) NOT NULL,
    event_timestamp TIMESTAMPTZ NOT NULL,
    source_ip INET,
    technical_context JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT audit_events_outcome_check
        CHECK (outcome IN ('success', 'failure', 'denied', 'timeout'))
);

CREATE INDEX idx_audit_events_flow_timestamp
    ON audit_events (flow_id, event_timestamp DESC);

CREATE INDEX idx_audit_events_actor_timestamp
    ON audit_events (actor_id, event_timestamp DESC);

CREATE INDEX idx_audit_events_type_outcome
    ON audit_events (event_type, outcome);

CREATE INDEX idx_audit_events_program_timestamp
    ON audit_events (program_id, event_timestamp DESC);

CREATE TABLE performance_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id UUID REFERENCES programs(id) ON DELETE SET NULL,
    api_id UUID REFERENCES apis(id) ON DELETE SET NULL,
    flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
    metric_name VARCHAR(120) NOT NULL,
    metric_value NUMERIC(14, 4) NOT NULL,
    unit VARCHAR(40) NOT NULL,
    aggregation VARCHAR(30) NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    sample_count INTEGER NOT NULL DEFAULT 0,
    sla_target_value NUMERIC(14, 4),
    is_sla_breach BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT performance_metrics_aggregation_check
        CHECK (aggregation IN ('count', 'avg', 'min', 'max', 'p50', 'p95', 'p99', 'rate')),
    CONSTRAINT performance_metrics_period_check
        CHECK (period_end > period_start),
    CONSTRAINT performance_metrics_sample_count_check
        CHECK (sample_count >= 0)
);

CREATE INDEX idx_performance_metrics_flow_metric_period
    ON performance_metrics (flow_id, metric_name, period_start DESC);

CREATE INDEX idx_performance_metrics_api_metric_period
    ON performance_metrics (api_id, metric_name, period_start DESC);

CREATE INDEX idx_performance_metrics_program_period
    ON performance_metrics (program_id, period_start DESC);

CREATE INDEX idx_performance_metrics_sla_breach
    ON performance_metrics (period_start DESC, metric_name)
    WHERE is_sla_breach = TRUE;

CREATE TABLE incident_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    detection_rule_id UUID REFERENCES detection_rules(id) ON DELETE SET NULL,
    program_id UUID REFERENCES programs(id) ON DELETE SET NULL,
    api_id UUID REFERENCES apis(id) ON DELETE SET NULL,
    flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
    related_api_call_id UUID REFERENCES api_calls(id) ON DELETE SET NULL,
    related_audit_event_id UUID REFERENCES audit_events(id) ON DELETE SET NULL,
    incident_type VARCHAR(120) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    title VARCHAR(180) NOT NULL,
    description TEXT NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL,
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    observed_value NUMERIC(14, 4),
    threshold_value NUMERIC(14, 4),
    risk_score NUMERIC(5, 2),
    evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
    recommendations JSONB NOT NULL DEFAULT '[]'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT incident_events_severity_check
        CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    CONSTRAINT incident_events_status_check
        CHECK (status IN ('open', 'acknowledged', 'resolved', 'closed')),
    CONSTRAINT incident_events_acknowledged_at_check
        CHECK (acknowledged_at IS NULL OR acknowledged_at >= detected_at),
    CONSTRAINT incident_events_resolved_at_check
        CHECK (resolved_at IS NULL OR resolved_at >= detected_at),
    CONSTRAINT incident_events_risk_score_check
        CHECK (risk_score IS NULL OR risk_score BETWEEN 0 AND 100),
    CONSTRAINT incident_events_evidence_object_check
        CHECK (jsonb_typeof(evidence) = 'object'),
    CONSTRAINT incident_events_recommendations_array_check
        CHECK (jsonb_typeof(recommendations) = 'array')
);

CREATE INDEX idx_incident_events_flow_detected
    ON incident_events (flow_id, detected_at DESC);

CREATE INDEX idx_incident_events_type_detected
    ON incident_events (incident_type, detected_at DESC);

CREATE INDEX idx_incident_events_severity_status
    ON incident_events (severity, status);

CREATE INDEX idx_incident_events_recent_dashboard
    ON incident_events (detected_at DESC, severity, status);

CREATE INDEX idx_incident_events_program_api_severity
    ON incident_events (program_id, api_id, severity, detected_at DESC);

CREATE INDEX idx_incident_events_risk_score
    ON incident_events (risk_score DESC)
    WHERE risk_score IS NOT NULL;

CREATE TABLE thresholds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope VARCHAR(30) NOT NULL,
    program_id UUID REFERENCES programs(id) ON DELETE SET NULL,
    api_id UUID REFERENCES apis(id) ON DELETE SET NULL,
    flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,

    metric_name VARCHAR(120) NOT NULL,
    threshold_value NUMERIC(14,4) NOT NULL,
    unit VARCHAR(40),

    source VARCHAR(30) NOT NULL DEFAULT 'manual',
    status VARCHAR(30) NOT NULL DEFAULT 'active',

    proposed_by VARCHAR(30),
    validated_by VARCHAR(160),
    validated_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT thresholds_scope_check
        CHECK (scope IN ('global', 'program', 'api', 'flow')),

    CONSTRAINT thresholds_source_check
        CHECK (source IN ('manual', 'ai_proposed', 'system_default')),

    CONSTRAINT thresholds_status_check
        CHECK (status IN ('active', 'pending_validation', 'rejected', 'archived'))
);
