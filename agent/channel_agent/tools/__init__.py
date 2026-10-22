"""Набор инструментов агента канала.

Инструмента публикации здесь нет и не должно появиться: публикует код бота
по кнопке владельца (bot.py). Модель может только предложить черновик.
"""

from __future__ import annotations

from typing import Any

from .base import Tool, ToolContext, ToolError, ToolResult, tool
from .channel import (
    channel_history,
    check_updates,
    commit_files,
    propose_post,
    read_project_doc,
    skip_commits,
    upcoming_trips,
)
from .datetime_tool import get_current_datetime
from .notes import read_notes, save_note

CHANNEL_TOOLS: list[Tool] = [
    get_current_datetime,
    check_updates,
    commit_files,
    skip_commits,
    upcoming_trips,
    channel_history,
    read_project_doc,
    propose_post,
    read_notes,
    save_note,
]

# Перенесено из MetodiLabs: модели, которые поддерживают новые версии веб-инструментов.
DYNAMIC_WEB_TOOLS_MODELS = {
    "claude-opus-5-5",
    "claude-opus-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-sonnet-5-5",
    "claude-sonnet-5",
    "claude-sonnet-4-6",
}


def server_tools(*, model: str, web_search_max_uses: int) -> list[dict[str, Any]]:
    """Серверные инструменты (веб-поиск); у агента канала по умолчанию выключены."""
    if model in DYNAMIC_WEB_TOOLS_MODELS:
        search_type, fetch_type = "web_search_20260209", "web_fetch_20260209"
    else:
        search_type, fetch_type = "web_search_20250305", "web_fetch_20250910"
    return [
        {"type": search_type, "name": "web_search", "max_uses": web_search_max_uses},
        {"type": fetch_type, "name": "web_fetch", "max_uses": web_search_max_uses},
    ]


__all__ = ["CHANNEL_TOOLS", "Tool", "ToolContext", "ToolError", "ToolResult", "server_tools", "tool"]
