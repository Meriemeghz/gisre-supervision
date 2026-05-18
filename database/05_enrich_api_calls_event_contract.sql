ALTER TABLE api_calls
ADD COLUMN IF NOT EXISTS flow_code VARCHAR(100),
ADD COLUMN IF NOT EXISTS api_code VARCHAR(100),
ADD COLUMN IF NOT EXISTS consumer_code VARCHAR(100),
ADD COLUMN IF NOT EXISTS producer_code VARCHAR(100),
ADD COLUMN IF NOT EXISTS program_code VARCHAR(40),
ADD COLUMN IF NOT EXISTS sla_latency_ms INTEGER,
ADD COLUMN IF NOT EXISTS expected_calls_per_minute INTEGER,
ADD COLUMN IF NOT EXISTS api_criticality VARCHAR(20),
ADD COLUMN IF NOT EXISTS consumer_criticality VARCHAR(20),
ADD COLUMN IF NOT EXISTS producer_criticality VARCHAR(20),
ADD COLUMN IF NOT EXISTS flow_criticality VARCHAR(20),
ADD COLUMN IF NOT EXISTS is_anomaly BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS anomaly_type VARCHAR(120),
ADD COLUMN IF NOT EXISTS anomaly_family VARCHAR(50),
ADD COLUMN IF NOT EXISTS analysis_level VARCHAR(50),
ADD COLUMN IF NOT EXISTS anomaly_scope VARCHAR(50),
ADD COLUMN IF NOT EXISTS anomaly_correlation_id VARCHAR(120),
ADD COLUMN IF NOT EXISTS scenario_id VARCHAR(120),
ADD COLUMN IF NOT EXISTS simulation_mode VARCHAR(30),
ADD COLUMN IF NOT EXISTS event_sequence_number BIGINT,
ADD COLUMN IF NOT EXISTS ingestion_delay_ms INTEGER,
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_api_calls_anomaly_type
ON api_calls (anomaly_type, called_at DESC)
WHERE is_anomaly = TRUE;

CREATE INDEX IF NOT EXISTS idx_api_calls_analysis_level
ON api_calls (analysis_level, called_at DESC)
WHERE is_anomaly = TRUE;

CREATE INDEX IF NOT EXISTS idx_api_calls_codes_dashboard
ON api_calls (flow_code, api_code, consumer_code, producer_code, called_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_calls_correlation_scenario
ON api_calls (anomaly_correlation_id, scenario_id);

CREATE INDEX IF NOT EXISTS idx_api_calls_criticality
ON api_calls (producer_criticality, api_criticality, flow_criticality, called_at DESC);

ALTER TABLE api_calls
DROP CONSTRAINT IF EXISTS api_calls_analysis_level_contract_check,
ADD CONSTRAINT api_calls_analysis_level_contract_check
CHECK (analysis_level IS NULL OR analysis_level IN ('event', 'flow', 'actor', 'temporal', 'graph', 'platform'));

ALTER TABLE api_calls
DROP CONSTRAINT IF EXISTS api_calls_anomaly_family_contract_check,
ADD CONSTRAINT api_calls_anomaly_family_contract_check
CHECK (anomaly_family IS NULL OR anomaly_family IN ('performance', 'reliability', 'traffic', 'security', 'behavior', 'dependency', 'traceability', 'platform'));

ALTER TABLE api_calls
DROP CONSTRAINT IF EXISTS api_calls_simulation_mode_contract_check,
ADD CONSTRAINT api_calls_simulation_mode_contract_check
CHECK (simulation_mode IS NULL OR simulation_mode IN ('normal', 'degraded', 'incident', 'recovery'));

ALTER TABLE api_calls
DROP CONSTRAINT IF EXISTS api_calls_event_contract_criticality_check,
ADD CONSTRAINT api_calls_event_contract_criticality_check
CHECK (
    (api_criticality IS NULL OR api_criticality IN ('low', 'medium', 'high', 'critical'))
    AND (consumer_criticality IS NULL OR consumer_criticality IN ('low', 'medium', 'high', 'critical'))
    AND (producer_criticality IS NULL OR producer_criticality IN ('low', 'medium', 'high', 'critical'))
    AND (flow_criticality IS NULL OR flow_criticality IN ('low', 'medium', 'high', 'critical'))
);
