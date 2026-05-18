-- ============================================================
-- Migration: ajout de la criticite sur actors et apis
-- Objectif:
--   - Ajouter la colonne criticality sans recreer les tables
--   - Conserver les donnees existantes
--   - Initialiser les criticites selon les regles metier GISRE
--   - Ajouter des contraintes CHECK idempotentes
-- ============================================================

-- ------------------------------------------------------------
-- 1. Ajouter la colonne criticality a actors si elle n'existe pas
-- ------------------------------------------------------------
ALTER TABLE actors
ADD COLUMN IF NOT EXISTS criticality VARCHAR(20) DEFAULT 'medium';

-- ------------------------------------------------------------
-- 2. Ajouter la colonne criticality a apis si elle n'existe pas
-- ------------------------------------------------------------
ALTER TABLE apis
ADD COLUMN IF NOT EXISTS criticality VARCHAR(20) DEFAULT 'medium';

-- ------------------------------------------------------------
-- 3. Normaliser les donnees existantes avant d'ajouter les CHECK
--    Cela evite de casser la migration si la colonne existait deja
--    avec des valeurs nulles ou invalides.
-- ------------------------------------------------------------
UPDATE actors
SET criticality = 'medium'
WHERE criticality IS NULL
   OR criticality NOT IN ('low', 'medium', 'high', 'critical');

UPDATE apis
SET criticality = 'medium'
WHERE criticality IS NULL
   OR criticality NOT IN ('low', 'medium', 'high', 'critical');

-- ------------------------------------------------------------
-- 4. Ajouter les contraintes CHECK.
--    PostgreSQL ne supporte pas ADD CONSTRAINT IF NOT EXISTS,
--    donc on utilise un bloc DO pour verifier pg_constraint.
-- ------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'actors_criticality_check'
          AND conrelid = 'actors'::regclass
    ) THEN
        ALTER TABLE actors
        ADD CONSTRAINT actors_criticality_check
        CHECK (criticality IN ('low', 'medium', 'high', 'critical'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'apis_criticality_check'
          AND conrelid = 'apis'::regclass
    ) THEN
        ALTER TABLE apis
        ADD CONSTRAINT apis_criticality_check
        CHECK (criticality IN ('low', 'medium', 'high', 'critical'));
    END IF;
END $$;

-- ------------------------------------------------------------
-- 5. Forcer le DEFAULT pour les futures insertions.
-- ------------------------------------------------------------
ALTER TABLE actors
ALTER COLUMN criticality SET DEFAULT 'medium';

ALTER TABLE apis
ALTER COLUMN criticality SET DEFAULT 'medium';

-- ------------------------------------------------------------
-- 6. Initialiser la criticite des actors existants.
-- ------------------------------------------------------------
UPDATE actors
SET criticality = CASE
    WHEN code IN ('rsu', 'cnss_amo', 'narsa_financement') THEN 'critical'
    WHEN code IN ('massar', 'ompic', 'etat_civil') THEN 'high'
    ELSE 'medium'
END;

-- ------------------------------------------------------------
-- 7. Initialiser la criticite des APIs existantes.
--    Les valeurs nulles/invalides ont deja ete ramenees a medium.
--    On ne remet pas toutes les APIs a medium afin de conserver les
--    criticites chargees depuis 02_seed.sql sur une base neuve.
--    Regle minimale pour une base deja existante:
--      - high pour les APIs critiques connues
--      - medium reste la valeur par defaut pour les autres
-- ------------------------------------------------------------
UPDATE apis
SET criticality = 'high'
WHERE code IN (
    'verify_social_eligibility',
    'verify_health_coverage',
    'health_coverage_check',
    'verify_amo_coverage'
)
   OR code ILIKE '%health%'
   OR code ILIKE '%coverage%'
   OR code ILIKE '%amo%';

-- ------------------------------------------------------------
-- 8. Optionnel mais recommande: interdire les valeurs NULL.
--    Les lignes existantes ont deja ete initialisees plus haut.
-- ------------------------------------------------------------
ALTER TABLE actors
ALTER COLUMN criticality SET NOT NULL;

ALTER TABLE apis
ALTER COLUMN criticality SET NOT NULL;
