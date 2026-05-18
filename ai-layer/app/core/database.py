import json
import logging
import time
from contextlib import contextmanager
from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor, Json
from psycopg2.pool import ThreadedConnectionPool

from app.core.config import Settings

logger = logging.getLogger(__name__)


class Database:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.pool: ThreadedConnectionPool | None = None

    def connect(self) -> None:
        for attempt in range(1, 16):
            try:
                self.pool = ThreadedConnectionPool(
                    minconn=1,
                    maxconn=8,
                    host=self.settings.postgres_host,
                    port=self.settings.postgres_port,
                    dbname=self.settings.postgres_db,
                    user=self.settings.postgres_user,
                    password=self.settings.postgres_password,
                )
                logger.info("[AI-DB] connected")
                return
            except Exception as exc:
                logger.warning("[AI-DB] connection failed attempt=%s error=%s", attempt, exc)
                time.sleep(min(attempt, 5))
        raise RuntimeError("PostgreSQL connection failed for ai-layer")

    @contextmanager
    def connection(self):
        if self.pool is None:
            self.connect()
        assert self.pool is not None
        conn = self.pool.getconn()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            self.pool.putconn(conn)

    def fetch_all(self, query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        with self.connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(query, params)
                return [dict(row) for row in cursor.fetchall()]

    def fetch_one(self, query: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        with self.connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(query, params)
                row = cursor.fetchone()
                return dict(row) if row else None

    def execute(self, query: str, params: tuple[Any, ...] = ()) -> None:
        with self.connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, params)

    def insert_ai_result(self, result: dict[str, Any]) -> None:
        self.execute(
            """
            INSERT INTO ai_analysis_results (
                source_event_id, source_event_type, flow_code, api_id, actor_id,
                detected_anomaly_type, risk_score, severity, confidence,
                explanation, recommendation, analysis_type, validation, metadata,
                detected_at
            )
            VALUES (
                %(source_event_id)s, %(source_event_type)s, %(flow_code)s,
                %(api_id)s, %(actor_id)s, %(detected_anomaly_type)s,
                %(risk_score)s, %(severity)s, %(confidence)s, %(explanation)s,
                %(recommendation)s, %(analysis_type)s, %(validation)s,
                %(metadata)s, %(detected_at)s
            )
            """,
            {
                **result,
                "validation": Json(result.get("validation") or {}),
                "metadata": Json(result.get("metadata") or {}),
            },
        )
        logger.info("[AI-DB] result inserted")

    def close(self) -> None:
        if self.pool:
            self.pool.closeall()
            self.pool = None
