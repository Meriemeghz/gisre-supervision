# GISRE AI Models

This package contains the common multi-model foundation used by the AI layer.

Runtime code lives in `app/ai_models/`.
Serialized artifacts remain in `/app/models` inside Docker, mapped from `ai-layer/models/`.

Model families:

- `classical`: Isolation Forest, One-Class SVM, Local Outlier Factor, K-Means, Random Forest.
- `deep_learning`: MLP Autoencoder, GRU Autoencoder, LSTM Autoencoder, VAE.
- `transformers`: TranAD, Anomaly Transformer, LogBERT.
- `graph_ai`: GDN, MTAD-GAT, TopoGDN.
- `streaming`: ADWIN, Half-Space Trees, River-style models.
- `hybrid`: Rules Engine, Ensemble Model, Hybrid Risk Scoring.

All models implement:

- `train(records)`
- `predict(record)`
- `evaluate(records)`
- `save()`
- `load()`
- `get_metadata()`

Complex research models are intentionally marked as `experimental` and `is_mock=true`
until their full training/inference pipeline is implemented.
