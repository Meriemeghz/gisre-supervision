import os
import psycopg2
import random
import time
import uuid
from datetime import datetime

conn = psycopg2.connect(
    host=os.getenv("DB_HOST", "postgres"),
    port=os.getenv("DB_PORT", "5432"),
    dbname=os.getenv("DB_NAME", "gisre_db"),
    user=os.getenv("DB_USER", "admin"),
    password=os.getenv("DB_PASSWORD", "admin")
)

cursor = conn.cursor()

print("Connexion PostgreSQL reussie")

# Charger les flows
cursor.execute("""
SELECT f.id, f.code, f.api_id, f.consumer_actor_id, f.producer_actor_id, f.sla_latency_ms
FROM flows f
""")

flows = cursor.fetchall()

print(f"{len(flows)} flows chargés")

while True:
    flow = random.choice(flows)

    flow_id, code, api_id, consumer_id, producer_id, sla_latency = flow

    latency = random.randint(100, 600)

    is_sla_breach = latency > sla_latency

    if random.random() < 0.1:
        status_code = random.choice([500, 502, 503])
        success = False
        error_type = "server_error"
        print(f"[ANOMALY] error sur {code}")
    else:
        status_code = 200
        success = True
        error_type = None

    cursor.execute("""
    INSERT INTO api_calls (
        flow_id, api_id, consumer_actor_id, producer_actor_id,
        correlation_id, endpoint_path, method, status_code,
        latency_ms, success, error_type, called_at, is_sla_breach
    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, (
        flow_id,
        api_id,
        consumer_id,
        producer_id,
        str(uuid.uuid4()),
        "/api/test",
        "GET",
        status_code,
        latency,
        success,
        error_type,
        datetime.utcnow(),
        is_sla_breach
    ))

    conn.commit()

    print(f"[OK] event inséré pour flow {code} | latency={latency}")

    time.sleep(1)