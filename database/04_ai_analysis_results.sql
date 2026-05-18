CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ai_analysis_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_event_id UUID,
    source_event_type VARCHAR(50) NOT NULL,
    flow_code VARCHAR(40),
    api_id UUID,
    actor_id UUID,
    detected_anomaly_type VARCHAR(120) NOT NULL,
    risk_score INTEGER NOT NULL,
    severity VARCHAR(20) NOT NULL,
    confidence NUMERIC,
    explanation TEXT,
    recommendation TEXT,
    analysis_type VARCHAR(30) NOT NULL,
    validation JSONB,
    metadata JSONB,
    detected_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ai_analysis_results_score_check
        CHECK (risk_score BETWEEN 0 AND 100),
    CONSTRAINT ai_analysis_results_severity_check
        CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    CONSTRAINT ai_analysis_results_analysis_type_check
        CHECK (analysis_type IN ('realtime', 'historical', 'manual'))
);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_results_detected_at
    ON ai_analysis_results (detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_results_flow_detected
    ON ai_analysis_results (flow_code, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_results_severity
    ON ai_analysis_results (severity, risk_score DESC, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_results_type
    ON ai_analysis_results (detected_anomaly_type, detected_at DESC);
