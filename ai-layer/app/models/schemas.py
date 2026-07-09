from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class AnalyzeRequest(BaseModel):
    topic: str
    event: dict[str, Any]
