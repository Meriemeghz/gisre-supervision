CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS model_training_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id VARCHAR(120) NOT NULL,
    model_version VARCHAR(120),
    analysis_level VARCHAR(50),
    status VARCHAR(30) NOT NULL,
    training_mode VARCHAR(30) NOT NULL,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    dataset_start TIMESTAMPTZ,
    dataset_end TIMESTAMPTZ,
    sample_size INTEGER,
    accuracy DOUBLE PRECISION,
    precision_score DOUBLE PRECISION,
    recall_score DOUBLE PRECISION,
    f1_score DOUBLE PRECISION,
    drift_score DOUBLE PRECISION,
    triggered_by VARCHAR(100),
    recommendation_reason TEXT,
    training_metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT model_training_jobs_status_check
        CHECK (status IN ('pending', 'training', 'completed', 'failed')),
    CONSTRAINT model_training_jobs_mode_check
        CHECK (training_mode IN ('manual', 'scheduled', 'recommended')),
    CONSTRAINT model_training_jobs_analysis_level_check
        CHECK (analysis_level IS NULL OR analysis_level IN ('event', 'flow', 'actor', 'temporal', 'graph', 'platform'))
);

CREATE INDEX IF NOT EXISTS idx_model_training_jobs_model_created
ON model_training_jobs (model_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_model_training_jobs_status
ON model_training_jobs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_model_training_jobs_completed
ON model_training_jobs (model_id, completed_at DESC)
WHERE status = 'completed';

CREATE TABLE IF NOT EXISTS model_retraining_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id VARCHAR(120) NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    frequency VARCHAR(30) NOT NULL DEFAULT 'monthly',
    drift_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.30,
    min_new_events INTEGER NOT NULL DEFAULT 20000,
    max_training_frequency_days INTEGER NOT NULL DEFAULT 14,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT model_retraining_policies_frequency_check
        CHECK (frequency IN ('weekly', 'biweekly', 'monthly'))
);

INSERT INTO model_retraining_policies (
    model_id, enabled, frequency, drift_threshold, min_new_events, max_training_frequency_days
)
VALUES
    ('event_random_forest', FALSE, 'biweekly', 0.30, 20000, 14),
    ('event_isolation_forest', FALSE, 'biweekly', 0.32, 20000, 14),
    ('event_lof', FALSE, 'monthly', 0.35, 25000, 21),
    ('event_autoencoder_mlp', FALSE, 'monthly', 0.35, 25000, 21)
ON CONFLICT (model_id) DO NOTHING;
