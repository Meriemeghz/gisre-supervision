from __future__ import annotations

import asyncio
import logging

from aiokafka import AIOKafkaConsumer

from app.core.config import Settings
from app.core.kafka import decode_kafka_value
from app.services.ai_engine import AIEngine

logger = logging.getLogger(__name__)


class AIKafkaConsumer:
    def __init__(self, settings: Settings, engine: AIEngine) -> None:
        self.settings = settings
        self.engine = engine
        self.consumer: AIOKafkaConsumer | None = None
        self._stopped = asyncio.Event()

    async def start(self) -> None:
        topics = [self.settings.kafka_api_calls_topic, self.settings.kafka_audit_events_topic]
        while not self._stopped.is_set():
            try:
                self.consumer = AIOKafkaConsumer(
                    *topics,
                    bootstrap_servers=self.settings.kafka_bootstrap_servers,
                    group_id=self.settings.kafka_group_id,
                    enable_auto_commit=True,
                    auto_offset_reset="latest",
                )
                await self.consumer.start()
                logger.info("[AI-KAFKA] connected")

                async for message in self.consumer:
                    if self._stopped.is_set():
                        break
                    await self._handle_message(message.topic, message.value)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("[AI-KAFKA] error=%s", exc)
                await asyncio.sleep(5)
            finally:
                if self.consumer:
                    try:
                        await self.consumer.stop()
                    except Exception as exc:
                        logger.warning("[AI-KAFKA] stop error=%s", exc)
                    self.consumer = None

    async def _handle_message(self, topic: str, value: bytes) -> None:
        try:
            payload = decode_kafka_value(value)
            logger.info("[AI-KAFKA] received %s", topic)
            await asyncio.to_thread(self.engine.analyze_event, topic, payload)
        except Exception as exc:
            logger.warning("[AI-KAFKA] message processing failed topic=%s error=%s", topic, exc)

    async def stop(self) -> None:
        self._stopped.set()
        if self.consumer:
            await self.consumer.stop()
