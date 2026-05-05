-- =========================
-- SEED PROGRAMS
-- =========================

INSERT INTO programs (code, name, description, owner_organization, criticality)
VALUES
('PR1', 'MASSAR', 'Programme éducation', 'Ministère de l’Éducation', 'high'),
('PR2', 'RSU', 'Registre social unifié', 'Organisme social', 'critical'),
('PR3', 'OMPIC', 'Services entreprises', 'OMPIC', 'high')
ON CONFLICT (code) DO NOTHING;


-- =========================
-- SEED ACTORS
-- =========================

INSERT INTO actors (code, name, actor_type, organization_name)
VALUES
('massar', 'MASSAR', 'producer', 'Ministère de l’Éducation'),
('rsu', 'RSU', 'producer', 'Registre social unifié'),
('ompic', 'OMPIC', 'producer', 'OMPIC'),

('universite_hassan_ii', 'Université Hassan II', 'consumer', 'Université Hassan II'),
('hopital_rabat', 'Hôpital Rabat', 'consumer', 'Hôpital public'),
('banque_publique_x', 'Banque Publique X', 'consumer', 'Banque')
ON CONFLICT (code) DO NOTHING;


-- =========================
-- SEED APIS
-- =========================

INSERT INTO apis (
    producer_actor_id,
    code,
    name,
    base_path,
    version,
    auth_type,
    sla_availability_percent,
    sla_latency_ms,
    rate_limit_per_minute
)
SELECT id, 'verify_student_status', 'Vérifier statut étudiant', '/massar/students/status', 'v1', 'oauth2', 99.90, 300, 100
FROM actors WHERE code = 'massar'
ON CONFLICT (code) DO NOTHING;

INSERT INTO apis (
    producer_actor_id,
    code,
    name,
    base_path,
    version,
    auth_type,
    sla_availability_percent,
    sla_latency_ms,
    rate_limit_per_minute
)
SELECT id, 'verify_social_eligibility', 'Vérifier éligibilité sociale', '/rsu/eligibility', 'v1', 'oauth2', 99.90, 400, 80
FROM actors WHERE code = 'rsu'
ON CONFLICT (code) DO NOTHING;

INSERT INTO apis (
    producer_actor_id,
    code,
    name,
    base_path,
    version,
    auth_type,
    sla_availability_percent,
    sla_latency_ms,
    rate_limit_per_minute
)
SELECT id, 'company_registration_check', 'Vérifier entreprise', '/ompic/company/check', 'v1', 'oauth2', 99.80, 300, 70
FROM actors WHERE code = 'ompic'
ON CONFLICT (code) DO NOTHING;


-- =========================
-- SEED FLOWS
-- =========================

INSERT INTO flows (
    code,
    name,
    api_id,
    consumer_actor_id,
    producer_actor_id,
    expected_calls_per_minute,
    sla_latency_ms,
    sla_success_rate_percent
)
SELECT
    'F1',
    'Université Hassan II vers MASSAR',
    api.id,
    consumer.id,
    producer.id,
    20,
    300,
    99.00
FROM apis api
JOIN actors producer ON producer.code = 'massar'
JOIN actors consumer ON consumer.code = 'universite_hassan_ii'
WHERE api.code = 'verify_student_status'
ON CONFLICT (code) DO NOTHING;

INSERT INTO flows (
    code,
    name,
    api_id,
    consumer_actor_id,
    producer_actor_id,
    expected_calls_per_minute,
    sla_latency_ms,
    sla_success_rate_percent
)
SELECT
    'F2',
    'Hôpital Rabat vers RSU',
    api.id,
    consumer.id,
    producer.id,
    15,
    400,
    99.00
FROM apis api
JOIN actors producer ON producer.code = 'rsu'
JOIN actors consumer ON consumer.code = 'hopital_rabat'
WHERE api.code = 'verify_social_eligibility'
ON CONFLICT (code) DO NOTHING;

INSERT INTO flows (
    code,
    name,
    api_id,
    consumer_actor_id,
    producer_actor_id,
    expected_calls_per_minute,
    sla_latency_ms,
    sla_success_rate_percent
)
SELECT
    'F3',
    'Banque Publique X vers OMPIC',
    api.id,
    consumer.id,
    producer.id,
    12,
    300,
    98.50
FROM apis api
JOIN actors producer ON producer.code = 'ompic'
JOIN actors consumer ON consumer.code = 'banque_publique_x'
WHERE api.code = 'company_registration_check'
ON CONFLICT (code) DO NOTHING;


-- =========================
-- SEED THRESHOLDS
-- =========================

INSERT INTO thresholds (
    scope,
    metric_name,
    threshold_value,
    unit,
    source,
    status
)
VALUES
('global', 'error_rate', 10, '%', 'system_default', 'active'),
('global', 'avg_latency_ms', 500, 'ms', 'system_default', 'active'),
('global', 'request_count_per_minute', 100, 'req/min', 'system_default', 'active')
ON CONFLICT DO NOTHING;