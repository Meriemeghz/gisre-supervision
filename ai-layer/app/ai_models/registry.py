from __future__ import annotations

from typing import Type

from app.ai_models.base import BaseAIModel
from app.ai_models.classical import (
    IsolationForestModel,
    KMeansModel,
    LocalOutlierFactorModel,
    OneClassSVMModel,
    RandomForestModel,
)
from app.ai_models.deep_learning import (
    GRUAutoencoderModel,
    LSTMAutoencoderModel,
    MLPAutoencoderModel,
    VariationalAutoencoderModel,
)
from app.ai_models.event_level import (
    EventLevelAutoencoderMLPModel,
    EventLevelIsolationForestModel,
    EventLevelLocalOutlierFactorModel,
    EventLevelRandomForestModel,
    EventLevelRulesEngineModel,
)
from app.ai_models.graph_ai import GDNModel, MTADGATModel, TopoGDNModel
from app.ai_models.hybrid import EnsembleModel, HybridRiskScoringModel, RulesEngineModel
from app.ai_models.streaming import ADWINModel, HalfSpaceTreesModel, RiverModel
from app.ai_models.transformers import AnomalyTransformerModel, LogBERTModel, TranADModel


class ModelRegistry:
    _models: dict[str, Type[BaseAIModel]] = {
        IsolationForestModel.model_id: IsolationForestModel,
        EventLevelRulesEngineModel.model_id: EventLevelRulesEngineModel,
        EventLevelRandomForestModel.model_id: EventLevelRandomForestModel,
        EventLevelIsolationForestModel.model_id: EventLevelIsolationForestModel,
        EventLevelLocalOutlierFactorModel.model_id: EventLevelLocalOutlierFactorModel,
        EventLevelAutoencoderMLPModel.model_id: EventLevelAutoencoderMLPModel,
        OneClassSVMModel.model_id: OneClassSVMModel,
        LocalOutlierFactorModel.model_id: LocalOutlierFactorModel,
        KMeansModel.model_id: KMeansModel,
        RandomForestModel.model_id: RandomForestModel,
        MLPAutoencoderModel.model_id: MLPAutoencoderModel,
        GRUAutoencoderModel.model_id: GRUAutoencoderModel,
        LSTMAutoencoderModel.model_id: LSTMAutoencoderModel,
        VariationalAutoencoderModel.model_id: VariationalAutoencoderModel,
        TranADModel.model_id: TranADModel,
        AnomalyTransformerModel.model_id: AnomalyTransformerModel,
        LogBERTModel.model_id: LogBERTModel,
        GDNModel.model_id: GDNModel,
        MTADGATModel.model_id: MTADGATModel,
        TopoGDNModel.model_id: TopoGDNModel,
        ADWINModel.model_id: ADWINModel,
        HalfSpaceTreesModel.model_id: HalfSpaceTreesModel,
        RiverModel.model_id: RiverModel,
        RulesEngineModel.model_id: RulesEngineModel,
        EnsembleModel.model_id: EnsembleModel,
        HybridRiskScoringModel.model_id: HybridRiskScoringModel,
    }

    @classmethod
    def list_model_classes(cls) -> list[Type[BaseAIModel]]:
        return list(cls._models.values())

    @classmethod
    def get_model_class(cls, model_id: str) -> Type[BaseAIModel] | None:
        return cls._models.get(model_id)

    @classmethod
    def has_model(cls, model_id: str) -> bool:
        return model_id in cls._models
