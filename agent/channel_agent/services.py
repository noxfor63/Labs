"""Службы, которыми пользуются инструменты агента канала.

Собраны в один объект, чтобы инструменты не знали, откуда что берётся: в
работе это настоящие API, в тестах — подмены. Сюда же бот подключает
on_draft — что делать с новым черновиком (прислать владельцу карточку).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from .config import Settings
from .drafts import Draft, DraftStore


@dataclass
class Services:
    settings: Settings
    store: DraftStore
    pp_api: Any = None  # sources.PPApi или None, если PP_API_URL / PP_API_TOKEN не заданы
    github: Any = None  # sources.GitHub
    # Вызывается из потока агента сразу после создания черновика.
    on_draft: Callable[[Draft], None] = field(default=lambda draft: None)
