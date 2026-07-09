import asyncio
import logging

from fastapi import FastAPI

from app.core.config import settings
from app.core.database import Database
from app.routes.analysis_routes import router as analysis_router
from app.routes.ai_model_routes import router as ai_model_router
from app.routes.health_routes import router as health_router
from app.routes.model_runtime_routes import router as model_runtime_router
from app.routes.rl_routes import router as rl_router
from app.services.ai_engine import AIEngine
from app.services.model_monitoring_service import ModelMonitoringService
from app.services.model_training_service import ModelTrainingService
from app.services.cache_service import CacheService
from app.ai_models.factory import ModelFactory
from app.workers.kafka_consumer import AIKafkaConsumer

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="GISRE AI Layer", version="0.1.0")


@app.on_event("startup")
async def startup() -> None:
    database = Database(settings)
    database.connect()
    cache_service = CacheService(settings.redis_url, settings.cache_enabled)

    engine = AIEngine(database, settings)
    training_service = ModelTrainingService(database, settings.model_storage_dir)
    model_monitoring_service = ModelMonitoringService(database, settings.model_storage_dir)
    model_factory = ModelFactory(settings.model_storage_dir)
    consumer = AIKafkaConsumer(settings, engine)

    app.state.database = database
    app.state.cache_service = cache_service
    app.state.engine = engine
    app.state.training_service = training_service
    app.state.model_monitoring_service = model_monitoring_service
    app.state.model_factory = model_factory
    app.state.consumer = consumer
    app.state.consumer_task = asyncio.create_task(consumer.start())
    database.cache_service = cache_service
    if getattr(engine, "rl_decision_agent", None) is not None:
        engine.rl_decision_agent.memory.cache_service = cache_service

    logger.info("[AI] FastAPI started")


@app.on_event("shutdown")
async def shutdown() -> None:
    consumer = getattr(app.state, "consumer", None)
    if consumer:
        await consumer.stop()

    task = getattr(app.state, "consumer_task", None)
    if task:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    database = getattr(app.state, "database", None)
    if database:
        database.close()


app.include_router(health_router)
app.include_router(analysis_router)
app.include_router(ai_model_router)
app.include_router(model_runtime_router)
app.include_router(rl_router)
