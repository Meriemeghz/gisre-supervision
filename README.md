# GISRE Supervision

Projet PFE de supervision intelligente de la plateforme GISRE.

## Lancer PostgreSQL avec Docker

```bash
docker compose up -d
```

Le conteneur expose PostgreSQL sur `127.0.0.1:5432` avec :

- database: `gisre_db`
- user: `admin`
- password: `admin`

Les scripts SQL dans `database/` sont executes au premier demarrage du volume Docker.

## Installer les dependances du simulateur

```bash
cd simulator
python -m venv env
env\Scripts\activate
pip install -r requirements.txt
```

Optionnel : copier `simulator/.env.example` vers `simulator/.env` puis adapter les valeurs si besoin.

## Lancer le simulateur

Depuis le dossier `simulator` :

```bash
python main.py
```

Le simulateur charge les flows actifs depuis PostgreSQL, puis insere en boucle :

- des lignes dans `api_calls`
- des lignes dans `audit_events`
- des anomalies simulees : SLA breach, erreurs serveur, acces refuse, timeout

Arret propre avec `Ctrl+C`.

## Verifier les donnees dans PostgreSQL

```bash
docker exec -it gisre_postgres psql -U admin -d gisre_db
```

Exemples de requetes :

```sql
SELECT COUNT(*) FROM api_calls;
SELECT COUNT(*) FROM audit_events;

SELECT flow_id, status_code, latency_ms, success, error_type, called_at
FROM api_calls
ORDER BY called_at DESC
LIMIT 10;

SELECT event_type, outcome, event_timestamp
FROM audit_events
ORDER BY event_timestamp DESC
LIMIT 10;
```
