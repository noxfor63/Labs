"""Инструмент: текущие дата и время (перенесено из MetodiLabs).

Отличие одно: по умолчанию — часовой пояс канала из настроек, а не
компьютера. Сервер агента может стоять где угодно, а «пятница» для
дайджеста — оренбургская.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field

from .base import ToolContext, ToolError, tool

WEEKDAYS_RU = ("понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье")


class DateTimeInput(BaseModel):
    timezone: str | None = Field(
        default=None,
        description="Часовой пояс IANA. Если не указан — пояс канала (Оренбург).",
    )


@tool(DateTimeInput)
def get_current_datetime(args: DateTimeInput, ctx: ToolContext) -> str:
    """Текущие дата, время и день недели. Вызывай, когда решение зависит от дня: дайджест
    на выходные, «сегодня», «завтра», давно ли был последний пост."""
    default = ctx.services.settings.timezone if ctx.services is not None else "Asia/Yekaterinburg"
    name = args.timezone or default
    try:
        now = datetime.now(ZoneInfo(name))
    except (ZoneInfoNotFoundError, ValueError):
        raise ToolError(f"Неизвестный часовой пояс {name!r}. Пример: 'Asia/Yekaterinburg'.") from None
    return f"{now:%Y-%m-%d %H:%M} ({WEEKDAYS_RU[now.weekday()]}), часовой пояс {name}, UTC{now:%z}"
