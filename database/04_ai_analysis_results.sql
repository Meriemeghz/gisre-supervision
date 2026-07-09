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
    validation_status VARCHAR(30) DEFAULT 'unverified',
    validated_by VARCHAR(120),
    validated_at TIMESTAMPTZ,
    validation_comment TEXT,
    validation_source VARCHAR(40),
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

ALTER TABLE ai_analysis_results
    ADD COLUMN IF NOT EXISTS validation_status VARCHAR(30) DEFAULT 'unverified';

ALTER TABLE ai_analysis_results
    ADD COLUMN IF NOT EXISTS validated_by VARCHAR(120);

ALTER TABLE ai_analysis_results
    ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;

ALTER TABLE ai_analysis_results
    ADD COLUMN IF NOT EXISTS validation_comment TEXT;

ALTER TABLE ai_analysis_results
    ADD COLUMN IF NOT EXISTS validation_source VARCHAR(40);

UPDATE ai_analysis_results
SET validation_status = COALESCE(validation_status, 'unverified')
WHERE validation_status IS NULL;

DO $$
BEGIN
    ALTER TABLE ai_analysis_results
        DROP CONSTRAINT IF EXISTS ai_analysis_results_validation_status_check;

    ALTER TABLE ai_analysis_results
        ADD CONSTRAINT ai_analysis_results_validation_status_check
        CHECK (validation_status IN (
            'unverified',
            'pending_review',
            'confirmed',
            'partial',
            'false_positive',
            'ignored',
            'resolved',
            'auto_confirmed',
            'auto_dismissed'
        ));

    ALTER TABLE ai_analysis_results
        DROP CONSTRAINT IF EXISTS ai_analysis_results_validation_source_check;

    ALTER TABLE ai_analysis_results
        ADD CONSTRAINT ai_analysis_results_validation_source_check
        CHECK (
            validation_source IS NULL OR validation_source IN (
                'simulator',
                'human',
                'rule_validation',
                'model_validation',
                'demo_seed'
            )
        );
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_analysis_results_detected_at
    ON ai_analysis_results (detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_results_flow_detected
    ON ai_analysis_results (flow_code, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_results_severity
    ON ai_analysis_results (severity, risk_score DESC, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_results_type
    ON ai_analysis_results (detected_anomaly_type, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_results_validation_status
    ON ai_analysis_results (validation_status, detected_at DESC);

-- Historical analytics joins each AI result to its source API event.
CREATE INDEX IF NOT EXISTS idx_ai_analysis_results_source_event_id
    ON ai_analysis_results (source_event_id);
