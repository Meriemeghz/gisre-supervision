import random
import time
import uuid
from datetime import datetime
import psycopg2

# Connexion PostgreSQL
conn = psycopg2.connect(
    host="localhost",
    database="gisre_db",
    user="admin",
    password="admin"
)

cursor = conn.cursor()

# Charger les flows depuis la base
cursor.execute("""
SELECT f.id, f.code, f.api_id, f.consumer_actor_id, f.producer_actor_id, f.sla_latency_ms
FROM flows f
""")

flows = cursor.fetchall()

def generate_api_call(flow):
    flow_id, code, api_id, consumer_id, producer_id, sla_latency = flow

    latency = random.randint(100, 600)

    # anomalies simples
    if latency > sla_latency:
        is_sla_breach = True
    else:
        is_sla_breach = False

    # status code
    if random.random() < 0.1:
        status_code = random.choice([500, 502, 503])
        success = False
        error_type = "server_error"
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

def generate_audit_event(flow):
    flow_id, _, api_id, consumer_id, _, _ = flow

    outcome = random.choice(["success", "failure", "denied"])

    cursor.execute("""
    INSERT INTO audit_events (
        flow_id, api_id, actor_id,
        event_type, action, outcome,
        event_timestamp
    ) VALUES (%s, %s, %s, %s, %s, %s, %s)
    """, (
        flow_id,
        api_id,
        consumer_id,
        "api_access",
        "call_api",
        outcome,
        datetime.utcnow()
    ))

    conn.commit()

# boucle principale
while True:
    flow = random.choice(flows)

    generate_api_call(flow)
    generate_audit_event(flow)

    print("Event generated")

    time.sleep(1)