"""Базовые классы для инструментов (tools) агента.

Инструмент — это обычная Python-функция, которую Claude может «вызвать».
Claude не выполняет код сам: он присылает запрос вида «вызови read_file с
path='notes.txt'», наша программа выполняет функцию и отправляет результат
обратно. Чтобы Claude знал, какие инструменты есть и какие у них параметры,
мы передаём в API описание каждого инструмента (имя, описание, JSON-схему).

Параметры инструмента описываются pydantic-моделью. Из неё автоматически
строится JSON-схема для API, и ею же проверяются аргументы, которые прислал
Claude, перед вызовом функции.

Перенесено из MetodiLabs (agent/tools/base.py) без изменений, кроме ToolContext.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

# Сколько символов результата инструмента максимум отправлять Claude.
# Защищает от случайной отправки огромного файла (это дорого и бесполезно).
MAX_RESULT_CHARS = 50_000


class ToolError(Exception):
    """Ожидаемая ошибка инструмента (например, «файл не найден»).

    Текст ошибки отправляется Claude с пометкой is_error, и он сможет
    исправиться: попробовать другой путь, переспросить пользователя и т.п.
    """


@dataclass(frozen=True)
class ToolContext:
    """То, что нужно инструментам для работы."""

    data_dir: Path  # служебные данные агента: черновики, заметки, состояние обхода
    services: Any = None  # службы канала (channel_agent/services.py): черновики, API «По пути», GitHub


@dataclass(frozen=True)
class ToolResult:
    content: str
    is_error: bool = False


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input_model: type[BaseModel]
    func: Callable[[Any, ToolContext], str]
    # True — перед выполнением агент спросит подтверждение у пользователя.
    # Ставьте для всего, что меняет данные: запись файлов, отправка писем и т.д.
    requires_confirmation: bool = False

    def to_api(self, *, eager_input_streaming: bool = True) -> dict[str, Any]:
        """Описание инструмента в формате Claude API."""
        schema = self.input_model.model_json_schema()
        schema.pop("title", None)
        definition: dict[str, Any] = {"name": self.name, "description": self.description, "input_schema": schema}
        if eager_input_streaming:
            # Аргументы инструмента приходят по мере генерации, без задержки.
            # Взамен API их не проверяет — проверка делается в run() ниже.
            definition["eager_input_streaming"] = True
        return definition

    def parse_input(self, raw_input: Any) -> BaseModel:
        """Проверяет аргументы от Claude. Бросает ToolError, если они некорректны."""
        try:
            return self.input_model.model_validate(raw_input)
        except ValidationError as exc:
            problems = "; ".join(
                f"{'.'.join(str(p) for p in err['loc']) or 'input'}: {err['msg']}" for err in exc.errors()
            )
            raise ToolError(
                f"Некорректные аргументы для {self.name}: {problems}. "
                f"Получено: {json.dumps(raw_input, ensure_ascii=False)}"
            ) from None

    def run(self, raw_input: Any, ctx: ToolContext) -> ToolResult:
        """Проверяет аргументы, выполняет функцию и упаковывает результат."""
        try:
            args = self.parse_input(raw_input)
            output = self.func(args, ctx)
        except ToolError as exc:
            return ToolResult(f"Ошибка: {exc}", is_error=True)
        except Exception as exc:  # непредвиденная ошибка в коде инструмента
            return ToolResult(f"Внутренняя ошибка инструмента {self.name}: {type(exc).__name__}: {exc}", is_error=True)

        if len(output) > MAX_RESULT_CHARS:
            output = output[:MAX_RESULT_CHARS] + f"\n\n[... обрезано, показаны первые {MAX_RESULT_CHARS} символов]"
        return ToolResult(output)


def tool(
    input_model: type[BaseModel],
    *,
    name: str | None = None,
    requires_confirmation: bool = False,
) -> Callable[[Callable[[Any, ToolContext], str]], Tool]:
    """Декоратор: превращает функцию в инструмент.

    Описание инструмента берётся из docstring функции, поэтому пишите его
    подробно: Claude читает его, чтобы решить, КОГДА вызывать инструмент.

    Пример:

        class EchoInput(BaseModel):
            text: str = Field(description="Что повторить")

        @tool(EchoInput)
        def echo(args: EchoInput, ctx: ToolContext) -> str:
            '''Повторяет текст. Вызывай, когда пользователь просит повторить.'''
            return args.text
    """

    def decorator(func: Callable[[Any, ToolContext], str]) -> Tool:
        description = " ".join((func.__doc__ or "").split())
        if not description:
            raise ValueError(f"У инструмента {func.__name__} нет docstring — Claude не поймёт, зачем он нужен")
        return Tool(
            name=name or func.__name__,
            description=description,
            input_model=input_model,
            func=func,
            requires_confirmation=requires_confirmation,
        )

    return decorator
