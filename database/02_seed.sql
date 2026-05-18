-- =========================
-- SEED PROGRAMS
-- Source: cartographies.docx
-- =========================

INSERT INTO programs (code, name, description, owner_organization, criticality)
VALUES
('PR1', 'MASSAR', 'Education', 'MASSAR', 'high'),
('PR2', 'RSU', 'Social', 'RSU', 'high'),
('PR3', 'OMPIC', 'Entreprises', 'OMPIC', 'high'),
('PR4', 'NARSA Financement', 'Transport / financement', 'NARSA', 'high'),
('PR5', 'NARSA Assurance', 'Assurance / automobile', 'NARSA', 'medium'),
('PR6', 'AMO TADAMON / Sante', 'Sante / couverture', 'CNSS / AMO', 'high'),
('PR7', 'TAYSSIR / DAAM', 'Programmes sociaux / educatifs', 'Ministere de l''Interieur', 'medium'),
('PR8', 'Etat civil', 'Donnees citoyennes', 'Ministere de l''Interieur', 'high'),
('PR9', 'Allocations familiales', 'Social', 'Organisme social', 'medium'),
('PR10', 'Digitalisation du parcours facturation', 'Services publics / regies', 'Regies / SRM / operateurs publics', 'high'),
('PR11', 'Verification des donnees beneficiaires', 'Social / controle', 'CDG', 'medium'),
('PR12', 'Transmission information defunts', 'Etat civil / administrations', 'Ministere de l''Interieur', 'medium'),
('PR13', 'SITR Transit', 'Logistique / transit', 'Administration Transit', 'low'),
('PR14', 'Controle de regularite TNS', 'Social / conformite', 'Organisme social', 'low')
ON CONFLICT (code) DO NOTHING;


-- =========================
-- SEED ACTORS
-- Source: producteurs et consommateurs de cartographies.docx
-- =========================

INSERT INTO actors (
    program_id,
    code,
    name,
    actor_type,
    organization_name,
    criticality
)
SELECT
    p.id,
    seed.code,
    seed.name,
    seed.actor_type,
    seed.organization_name,
    seed.criticality
FROM (
    VALUES
    -- Producteurs
    ('PR1', 'massar', 'MASSAR', 'producer', 'Systeme national', 'high'),
    ('PR2', 'rsu', 'RSU', 'producer', 'Registre central', 'critical'),
    ('PR3', 'ompic', 'OMPIC', 'producer', 'Registre entreprise', 'high'),
    ('PR4', 'narsa_financement', 'NARSA Financement', 'producer', 'Organisme transport', 'critical'),
    ('PR5', 'narsa_assurance', 'NARSA Assurance', 'producer', 'Organisme transport', 'medium'),
    ('PR6', 'cnss_amo', 'CNSS / AMO', 'producer', 'Organisme social / sante', 'critical'),
    ('PR7', 'ministere_interieur', 'Ministere de l''Interieur', 'producer', 'Administration centrale', 'medium'),
    ('PR8', 'etat_civil', 'Etat civil', 'producer', 'Registre', 'high'),
    ('PR9', 'allocations_familiales', 'Allocations familiales', 'producer', 'Organisme social', 'medium'),
    ('PR10', 'regie_operateur', 'Regies / SRM / operateurs publics', 'producer', 'Services publics', 'medium'),
    ('PR11', 'cdg', 'CDG', 'producer', 'Institution publique', 'medium'),
    (NULL, 'ancfcc', 'ANCFCC', 'producer', 'Foncier', 'medium'),
    ('PR10', 'onee_operateurs_eau_electricite', 'ONEE / operateurs eau-electricite', 'producer', 'Operateur public', 'medium'),

    -- Consommateurs
    (NULL, 'universite_hassan_ii', 'Universite_Hassan_II', 'consumer', 'Universite', 'medium'),
    (NULL, 'universite_mohammed_v', 'Universite_Mohammed_V', 'consumer', 'Universite', 'medium'),
    (NULL, 'ofppt', 'OFPPT', 'consumer', 'Formation', 'medium'),
    (NULL, 'hopital_rabat', 'Hopital_Rabat', 'consumer', 'Hopital public', 'medium'),
    (NULL, 'hopital_casablanca', 'Hopital_Casablanca', 'consumer', 'Hopital public', 'medium'),
    (NULL, 'banque_publique_x', 'Banque_Publique_X', 'consumer', 'Banque', 'medium'),
    (NULL, 'banque_regionale_y', 'Banque_Regionale_Y', 'consumer', 'Banque', 'medium'),
    (NULL, 'compagnie_assurance_a', 'Compagnie_Assurance_A', 'consumer', 'Assurance', 'medium'),
    (NULL, 'commune_urbaine_z', 'Commune_Urbaine_Z', 'consumer', 'Administration locale', 'medium'),
    (NULL, 'ministere_service_a', 'Ministere_Service_A', 'consumer', 'Administration centrale', 'medium'),
    (NULL, 'agence_publique_b', 'Agence_Publique_B', 'consumer', 'Etablissement public', 'medium'),
    (NULL, 'portail_citoyen_simule', 'Portail_Citoyen_Simule', 'consumer', 'Portail applicatif', 'medium'),
    (NULL, 'organisme_social_c', 'Organisme_Social_C', 'consumer', 'Institution sociale', 'medium'),
    (NULL, 'regie_facturation_x', 'Regie_Facturation_X', 'consumer', 'Regie', 'medium'),
    (NULL, 'administration_transit_y', 'Administration_Transit_Y', 'consumer', 'Administration metier', 'medium')
) AS seed(program_code, code, name, actor_type, organization_name, criticality)
LEFT JOIN programs p ON p.code = seed.program_code
ON CONFLICT (code) DO NOTHING;


-- =========================
-- SEED APIS
-- Source: catalogues API de cartographies.docx
-- Haute -> high, Moyenne -> medium
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
    rate_limit_per_minute,
    criticality
)
SELECT
    producer.id,
    seed.code,
    seed.name,
    seed.base_path,
    'v1',
    'oauth2',
    CASE WHEN seed.criticality = 'high' THEN 99.90 ELSE 99.50 END,
    seed.sla_latency_ms,
    100,
    seed.criticality
FROM (
    VALUES
    -- MASSAR
    ('massar', 'verify_student_status', 'Verifier le statut etudiant', '/massar/students/status', 300, 'high'),
    ('massar', 'verify_enrollment', 'Verifier l''inscription', '/massar/enrollment/verify', 250, 'high'),
    ('massar', 'get_school_history', 'Consulter l''historique scolaire', '/massar/school/history', 450, 'medium'),
    ('massar', 'get_student_grades', 'Consulter les notes', '/massar/students/grades', 400, 'medium'),
    ('massar', 'verify_diploma_reference', 'Verifier une reference de diplome', '/massar/diplomas/reference/verify', 350, 'high'),
    ('massar', 'check_student_affiliation', 'Verifier le rattachement a un etablissement', '/massar/students/affiliation/check', 300, 'medium'),

    -- RSU
    ('rsu', 'verify_social_eligibility', 'Verifier l''eligibilite sociale', '/rsu/eligibility/verify', 400, 'high'),
    ('rsu', 'check_benefit_status', 'Verifier le statut d''une aide', '/rsu/benefits/status/check', 350, 'high'),
    ('rsu', 'get_household_composition', 'Consulter la composition du foyer', '/rsu/households/composition', 500, 'medium'),
    ('rsu', 'calculate_social_score', 'Recuperer ou calculer un score social', '/rsu/social-score/calculate', 450, 'high'),
    ('rsu', 'verify_rsu_registration', 'Verifier l''inscription RSU', '/rsu/registration/verify', 300, 'high'),
    ('rsu', 'get_beneficiary_profile', 'Obtenir un profil social synthetique', '/rsu/beneficiaries/profile', 500, 'medium'),

    -- OMPIC
    ('ompic', 'company_registration_check', 'Verifier l''enregistrement d''une entreprise', '/ompic/company/registration/check', 300, 'high'),
    ('ompic', 'get_company_details', 'Consulter les informations d''entreprise', '/ompic/company/details', 400, 'medium'),
    ('ompic', 'verify_legal_status', 'Verifier le statut juridique', '/ompic/company/legal-status/verify', 350, 'high'),
    ('ompic', 'check_trade_name', 'Verifier un nom commercial', '/ompic/trade-name/check', 300, 'medium'),
    ('ompic', 'get_company_activity_code', 'Obtenir le code d''activite', '/ompic/company/activity-code', 350, 'medium'),
    ('ompic', 'verify_company_identity', 'Verifier l''identite legale d''une entreprise', '/ompic/company/identity/verify', 300, 'high'),

    -- NARSA Financement
    ('narsa_financement', 'credit_nantissement_mainlevee', 'Verifier un nantissement ou une mainlevee', '/narsa/financing/nantissement-mainlevee', 350, 'high'),
    ('narsa_financement', 'verify_vehicle_registration', 'Verifier l''immatriculation d''un vehicule', '/narsa/vehicles/registration/verify', 300, 'high'),
    ('narsa_financement', 'check_financing_status', 'Verifier le statut d''un financement', '/narsa/financing/status/check', 400, 'high'),
    ('narsa_financement', 'get_vehicle_owner_reference', 'Obtenir une reference proprietaire', '/narsa/vehicles/owner-reference', 350, 'medium'),
    ('narsa_financement', 'verify_registration_restriction', 'Verifier une restriction administrative', '/narsa/vehicles/registration-restriction/verify', 400, 'high'),

    -- NARSA Assurance
    ('narsa_assurance', 'verify_vehicle_insurance', 'Verifier l''assurance vehicule', '/narsa/insurance/vehicle/verify', 350, 'high'),
    ('narsa_assurance', 'get_insurance_status', 'Consulter le statut d''assurance', '/narsa/insurance/status', 300, 'high'),
    ('narsa_assurance', 'check_policy_validity', 'Verifier la validite d''un contrat', '/narsa/insurance/policy/validity/check', 350, 'high'),
    ('narsa_assurance', 'verify_claim_history', 'Consulter l''historique de sinistres', '/narsa/insurance/claims/history', 500, 'medium'),
    ('narsa_assurance', 'get_vehicle_risk_profile', 'Obtenir un profil de risque vehicule', '/narsa/insurance/vehicle/risk-profile', 450, 'medium'),

    -- CNSS / AMO
    ('cnss_amo', 'verify_health_coverage', 'Verifier la couverture sante', '/amo/health-coverage/verify', 400, 'high'),
    ('cnss_amo', 'get_patient_eligibility', 'Verifier l''eligibilite d''un beneficiaire', '/amo/patients/eligibility', 350, 'high'),
    ('cnss_amo', 'validate_insurance_rights', 'Valider les droits d''assurance', '/amo/insurance-rights/validate', 300, 'high'),
    ('cnss_amo', 'check_care_rights', 'Verifier les droits a prestation', '/amo/care-rights/check', 450, 'medium'),
    ('cnss_amo', 'get_amo_beneficiary_status', 'Consulter le statut global d''un assure', '/amo/beneficiaries/status', 350, 'high'),

    -- TAYSSIR / DAAM
    ('ministere_interieur', 'verify_tayssir_eligibility', 'Verifier l''eligibilite Tayssir', '/tayssir/eligibility/verify', 400, 'high'),
    ('ministere_interieur', 'check_daam_status', 'Verifier le statut d''un beneficiaire', '/daam/status/check', 350, 'high'),
    ('ministere_interieur', 'get_household_support_status', 'Consulter le statut du soutien attribue', '/social/households/support-status', 450, 'medium'),
    ('ministere_interieur', 'verify_beneficiary_identity', 'Verifier l''identite d''un beneficiaire', '/social/beneficiaries/identity/verify', 300, 'high'),

    -- Etat civil
    ('etat_civil', 'verify_birth_record', 'Verifier un acte de naissance', '/civil-status/birth-record/verify', 350, 'high'),
    ('etat_civil', 'get_civil_status', 'Obtenir un statut d''etat civil', '/civil-status/status', 400, 'high'),
    ('etat_civil', 'verify_death_record', 'Verifier un acte de deces', '/civil-status/death-record/verify', 350, 'high'),
    ('etat_civil', 'check_family_link', 'Verifier un lien familial', '/civil-status/family-link/check', 500, 'medium'),
    ('etat_civil', 'validate_identity_registry_entry', 'Verifier une entree registre', '/civil-status/identity-registry/validate', 300, 'high'),

    -- Allocations familiales
    ('allocations_familiales', 'verify_family_allowance_eligibility', 'Verifier l''eligibilite aux allocations', '/family-allowances/eligibility/verify', 400, 'high'),
    ('allocations_familiales', 'check_child_dependency_status', 'Verifier le statut d''enfant a charge', '/family-allowances/child-dependency/check', 350, 'high'),
    ('allocations_familiales', 'get_family_allowance_status', 'Consulter le statut de l''allocation', '/family-allowances/status', 400, 'high'),
    ('allocations_familiales', 'validate_household_benefit_rights', 'Verifier le droit global du foyer', '/family-allowances/household-benefit-rights/validate', 450, 'medium'),

    -- Facturation services publics
    ('regie_operateur', 'verify_customer_reference', 'Verifier une reference client', '/billing/customer-reference/verify', 300, 'high'),
    ('regie_operateur', 'get_billing_status', 'Consulter le statut de facturation', '/billing/status', 400, 'medium'),
    ('regie_operateur', 'check_unpaid_balance', 'Verifier l''existence d''un impaye', '/billing/unpaid-balance/check', 350, 'high'),
    ('regie_operateur', 'validate_service_subscription', 'Verifier un abonnement actif', '/billing/service-subscription/validate', 300, 'high'),
    ('regie_operateur', 'get_meter_contract_status', 'Consulter le statut d''un contrat compteur', '/billing/meter-contract/status', 450, 'medium')
) AS seed(producer_code, code, name, base_path, sla_latency_ms, criticality)
JOIN actors producer ON producer.code = seed.producer_code
ON CONFLICT (code) DO NOTHING;


-- =========================
-- SEED FLOWS F1 A F38
-- Source: flux de cartographies.docx
-- Associations via SELECT id FROM actors/apis
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
    seed.code,
    seed.name,
    (SELECT id FROM apis WHERE code = seed.api_code),
    (SELECT id FROM actors WHERE code = seed.consumer_code),
    (SELECT id FROM actors WHERE code = seed.producer_code),
    seed.expected_calls_per_minute,
    seed.sla_latency_ms,
    99.00
FROM (
    VALUES
    ('F1', 'Universite_Hassan_II vers MASSAR - verify_student_status', 'universite_hassan_ii', 'verify_student_status', 'massar', 20, 300),
    ('F2', 'Universite_Hassan_II vers MASSAR - verify_enrollment', 'universite_hassan_ii', 'verify_enrollment', 'massar', 14, 250),
    ('F3', 'Universite_Hassan_II vers MASSAR - get_school_history', 'universite_hassan_ii', 'get_school_history', 'massar', 8, 450),
    ('F4', 'Universite_Mohammed_V vers MASSAR - verify_student_status', 'universite_mohammed_v', 'verify_student_status', 'massar', 16, 300),
    ('F5', 'Universite_Mohammed_V vers MASSAR - get_student_grades', 'universite_mohammed_v', 'get_student_grades', 'massar', 9, 400),
    ('F6', 'OFPPT vers MASSAR - check_student_affiliation', 'ofppt', 'check_student_affiliation', 'massar', 8, 300),
    ('F7', 'Hopital_Rabat vers RSU - verify_social_eligibility', 'hopital_rabat', 'verify_social_eligibility', 'rsu', 13, 400),
    ('F8', 'Hopital_Casablanca vers RSU - check_benefit_status', 'hopital_casablanca', 'check_benefit_status', 'rsu', 8, 350),
    ('F9', 'Ministere_Service_A vers RSU - calculate_social_score', 'ministere_service_a', 'calculate_social_score', 'rsu', 6, 450),
    ('F10', 'Organisme_Social_C vers RSU - verify_rsu_registration', 'organisme_social_c', 'verify_rsu_registration', 'rsu', 11, 300),
    ('F11', 'Organisme_Social_C vers RSU - get_beneficiary_profile', 'organisme_social_c', 'get_beneficiary_profile', 'rsu', 6, 500),
    ('F12', 'Organisme_Social_C vers Allocations familiales - verify_family_allowance_eligibility', 'organisme_social_c', 'verify_family_allowance_eligibility', 'allocations_familiales', 7, 400),
    ('F13', 'Hopital_Rabat vers CNSS / AMO - verify_health_coverage', 'hopital_rabat', 'verify_health_coverage', 'cnss_amo', 19, 400),
    ('F14', 'Hopital_Rabat vers CNSS / AMO - get_patient_eligibility', 'hopital_rabat', 'get_patient_eligibility', 'cnss_amo', 12, 350),
    ('F15', 'Hopital_Casablanca vers CNSS / AMO - validate_insurance_rights', 'hopital_casablanca', 'validate_insurance_rights', 'cnss_amo', 11, 300),
    ('F16', 'Hopital_Casablanca vers CNSS / AMO - check_care_rights', 'hopital_casablanca', 'check_care_rights', 'cnss_amo', 8, 450),
    ('F17', 'Portail_Citoyen_Simule vers CNSS / AMO - get_amo_beneficiary_status', 'portail_citoyen_simule', 'get_amo_beneficiary_status', 'cnss_amo', 4, 350),
    ('F18', 'Banque_Publique_X vers OMPIC - company_registration_check', 'banque_publique_x', 'company_registration_check', 'ompic', 14, 300),
    ('F19', 'Banque_Publique_X vers OMPIC - verify_legal_status', 'banque_publique_x', 'verify_legal_status', 'ompic', 11, 350),
    ('F20', 'Banque_Regionale_Y vers OMPIC - get_company_details', 'banque_regionale_y', 'get_company_details', 'ompic', 8, 400),
    ('F21', 'Commune_Urbaine_Z vers OMPIC - check_trade_name', 'commune_urbaine_z', 'check_trade_name', 'ompic', 4, 300),
    ('F22', 'Ministere_Service_A vers OMPIC - verify_company_identity', 'ministere_service_a', 'verify_company_identity', 'ompic', 5, 300),
    ('F23', 'Banque_Publique_X vers NARSA Financement - credit_nantissement_mainlevee', 'banque_publique_x', 'credit_nantissement_mainlevee', 'narsa_financement', 20, 350),
    ('F24', 'Banque_Publique_X vers NARSA Financement - verify_vehicle_registration', 'banque_publique_x', 'verify_vehicle_registration', 'narsa_financement', 13, 300),
    ('F25', 'Banque_Regionale_Y vers NARSA Financement - check_financing_status', 'banque_regionale_y', 'check_financing_status', 'narsa_financement', 8, 400),
    ('F26', 'Banque_Regionale_Y vers NARSA Financement - verify_registration_restriction', 'banque_regionale_y', 'verify_registration_restriction', 'narsa_financement', 7, 400),
    ('F27', 'Compagnie_Assurance_A vers NARSA Assurance - verify_vehicle_insurance', 'compagnie_assurance_a', 'verify_vehicle_insurance', 'narsa_assurance', 11, 350),
    ('F28', 'Compagnie_Assurance_A vers NARSA Assurance - check_policy_validity', 'compagnie_assurance_a', 'check_policy_validity', 'narsa_assurance', 8, 350),
    ('F29', 'Commune_Urbaine_Z vers Etat civil - verify_birth_record', 'commune_urbaine_z', 'verify_birth_record', 'etat_civil', 9, 350),
    ('F30', 'Ministere_Service_A vers Etat civil - get_civil_status', 'ministere_service_a', 'get_civil_status', 'etat_civil', 7, 400),
    ('F31', 'Hopital_Rabat vers Etat civil - verify_death_record', 'hopital_rabat', 'verify_death_record', 'etat_civil', 3, 350),
    ('F32', 'Organisme_Social_C vers Etat civil - check_family_link', 'organisme_social_c', 'check_family_link', 'etat_civil', 4, 500),
    ('F33', 'Portail_Citoyen_Simule vers Etat civil - validate_identity_registry_entry', 'portail_citoyen_simule', 'validate_identity_registry_entry', 'etat_civil', 5, 300),
    ('F34', 'Agence_Publique_B vers Regie / operateur - verify_customer_reference', 'agence_publique_b', 'verify_customer_reference', 'regie_operateur', 8, 300),
    ('F35', 'Regie_Facturation_X vers Regie / operateur - get_billing_status', 'regie_facturation_x', 'get_billing_status', 'regie_operateur', 12, 400),
    ('F36', 'Regie_Facturation_X vers Regie / operateur - check_unpaid_balance', 'regie_facturation_x', 'check_unpaid_balance', 'regie_operateur', 11, 350),
    ('F37', 'Regie_Facturation_X vers Regie / operateur - validate_service_subscription', 'regie_facturation_x', 'validate_service_subscription', 'regie_operateur', 8, 300),
    ('F38', 'Portail_Citoyen_Simule vers Services publics - get_meter_contract_status', 'portail_citoyen_simule', 'get_meter_contract_status', 'regie_operateur', 4, 450)
) AS seed(code, name, consumer_code, api_code, producer_code, expected_calls_per_minute, sla_latency_ms)
WHERE (SELECT id FROM apis WHERE code = seed.api_code) IS NOT NULL
  AND (SELECT id FROM actors WHERE code = seed.consumer_code) IS NOT NULL
  AND (SELECT id FROM actors WHERE code = seed.producer_code) IS NOT NULL
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
