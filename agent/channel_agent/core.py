"""Ядро агента: цикл «запрос к Claude → выполнение инструментов → снова запрос».

Перенесено из MetodiLabs (agent/core.py). Отличия только в сборке: набор
инструментов и их контекст передаются снаружи, Moodle и рабочей папки нет.

Как работает один ход (одно сообщение пользователя):

  1. Добавляем сообщение пользователя в историю `messages`.
  2. Отправляем в Claude API всю историю + системный промпт + список инструментов.
  3. Claude отвечает. Если в ответе есть вызовы инструментов (блоки tool_use) —
     выполняем их у себя, добавляем в историю ответ Claude и результаты
     (блоки tool_result) и возвращаемся к шагу 2.
  4. Если вызовов инструментов нет — это финальный ответ, ход закончен.

API не хранит историю на своей стороне: каждый запрос содержит весь диалог.
Поэтому история здесь только ДОПОЛНЯЕТСЯ в конец и никогда не редактируется
задним числом — так работает кэш промптов (дешевле) и сохраняются блоки
рассуждений (thinking) модели.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import anthropic

from .config import Settings
from .tools import Tool, ToolContext, ToolError, ToolResult, server_tools

# Бета-возможности API, которые использует агент:
#  - thinking-binding-controls: если история диалога не совпадёт с той, в которой были
#    созданы блоки рассуждений (например, вы поменяли системный промпт и загрузили
#    старую сессию), такие блоки будут отброшены вместо ошибки 400;
#  - server-side-fallback: если модель отклонит запрос по соображениям безопасности
#    (бывают ложные срабатывания), API сам повторит его на рекомендованной модели;
#  - thinking-display-updates: короткие заметки о ходе работы между вызовами
#    инструментов (AGENT_THINKING_DISPLAY=updates).
BINDING_BETA = "thinking-binding-controls-2026-08-01"
FALLBACK_BETA = "server-side-fallback-2026-07-01"
THINKING_UPDATES_BETA = "thinking-display-updates-2026-08-18"

# Не все модели поддерживают все возможности. То, чего у модели нет, агент не
# отправляет, чтобы смена AGENT_MODEL не приводила к ошибке 400.
# Адаптивные рассуждения и effort. Для других моделей (в том числе с нестандартными
# названиями у посредников) рассуждения не настраиваются — модель работает по умолчанию.
ADAPTIVE_THINKING_MODELS = {
    "claude-fable-5-1",
    "claude-fable-5",
    "claude-opus-5-5",
    "claude-opus-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-sonnet-5-5",
    "claude-sonnet-5",
    "claude-haiku-5-5",
}
# Модели, которые проверяют, что история перед блоками рассуждений не менялась.
BINDING_MODELS = {"claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"}
FALLBACK_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-opus-5"}
THINKING_UPDATES_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-fable-5"}

MAX_JSON_RETRIES = 2

# Цены в долларах за 1 млн токенов: (вход, выход, чтение из кэша).
# Нужны только для примерной оценки стоимости в команде /usage.
# Актуальные цены: https://platform.claude.com/docs/en/about-claude/pricing
PRICES_PER_MTOK: dict[str, tuple[float, float, float | None]] = {
    "claude-opus-5-5": (4.00, 20.00, 0.20),
    "claude-sonnet-5-5": (2.00, 10.00, 0.20),
    # Цена для запросов до 100 тыс. токенов; длиннее — $0.50 / $2.50.
    "claude-haiku-5-5": (0.10, 0.50, 0.01),
}

DEFAULT_SYSTEM_PROMPT = "Ты — полезный ассистент. Отвечай на языке пользователя, точно и по делу."


def load_system_prompt(path: Path) -> str:
    """Читает системный промпт из файла (по умолчанию prompts/system.md)."""
    if path.is_file():
        text = path.read_text(encoding="utf-8").strip()
        if text:
            return text
    return DEFAULT_SYSTEM_PROMPT


@dataclass
class UsageStats:
    """Сколько токенов потрачено за сессию."""

    requests: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_write_tokens: int = 0
    cache_read_tokens: int = 0
    web_searches: int = 0

    def add(self, usage: Any) -> None:
        self.requests += 1
        self.input_tokens += usage.input_tokens or 0
        self.output_tokens += usage.output_tokens or 0
        self.cache_write_tokens += usage.cache_creation_input_tokens or 0
        self.cache_read_tokens += usage.cache_read_input_tokens or 0
        if usage.server_tool_use is not None:
            self.web_searches += usage.server_tool_use.web_search_requests or 0

    def estimated_cost(self, model: str) -> float | None:
        """Примерная стоимость в долларах (без учёта платы за веб-поиск)."""
        if model not in PRICES_PER_MTOK:
            return None
        price_in, price_out, price_cache_read = PRICES_PER_MTOK[model]
        if price_cache_read is None:
            price_cache_read = price_in * 0.1
        return (
            self.input_tokens * price_in
            + self.cache_write_tokens * price_in * 1.25  # запись в кэш на 5 минут стоит 1.25× от входа
            + self.cache_read_tokens * price_cache_read
            + self.output_tokens * price_out
        ) / 1_000_000


def _with_cache_breakpoint(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Копия истории с меткой кэша на последнем сообщении пользователя.

    Сама история не меняется: метка ставится только в отправляемую копию, а в
    следующем запросе переезжает на новое последнее сообщение.
    """
    if not messages or messages[-1]["role"] != "user":
        return messages
    last = messages[-1]
    content = last["content"]
    blocks = [{"type": "text", "text": content}] if isinstance(content, str) else list(content)
    if not blocks:
        return messages
    blocks[-1] = {**blocks[-1], "cache_control": {"type": "ephemeral"}}
    return [*messages[:-1], {**last, "content": blocks}]


class AgentEvents:
    """События агента. Терминальный интерфейс (cli.py) переопределяет эти методы,
    чтобы печатать происходящее. Для другого интерфейса (Telegram, веб) создайте
    свой подкласс."""

    def on_text(self, text: str) -> None:
        """Очередной кусочек ответа Claude (приходит потоком)."""

    def on_thinking(self, text: str) -> None:
        """Кусочек заметки о ходе работы / рассуждения (если включён показ)."""

    def on_block_end(self, block_type: str) -> None:
        """Закончился блок текста или рассуждения."""

    def on_tool_call(self, name: str, tool_input: Any) -> None:
        """Агент собирается выполнить локальный инструмент."""

    def on_tool_result(self, name: str, result: ToolResult) -> None:
        """Инструмент выполнен."""

    def on_server_tool(self, name: str, tool_input: Any) -> None:
        """Claude использовал серверный инструмент (например, веб-поиск)."""

    def on_notice(self, message: str) -> None:
        """Служебное сообщение для пользователя."""

    def confirm_tool(self, name: str, tool_input: Any) -> bool:
        """Спросить пользователя, можно ли выполнить опасный инструмент."""
        return False


class Agent:
    def __init__(
        self,
        *,
        client: anthropic.Anthropic,
        settings: Settings,
        system_prompt: str,
        tools: list[Tool],
        ctx: ToolContext,
        events: AgentEvents | None = None,
    ) -> None:
        self.client = client
        self.settings = settings
        self.system_prompt = system_prompt
        self.events = events or AgentEvents()
        self.tools = {t.name: t for t in tools}
        self.ctx = ctx
        self.messages: list[dict[str, Any]] = []
        self.usage = UsageStats()

        # Список инструментов фиксируется на всю сессию: его изменение посреди
        # диалога сбрасывает кэш и делает недействительными блоки рассуждений.
        # Через посредника аргументы инструментов не стримятся заранее: сторонний
        # сервис может не знать поле eager_input_streaming и вернуть ошибку 400.
        eager = not settings.proxy_mode
        self.api_tools: list[dict[str, Any]] = [t.to_api(eager_input_streaming=eager) for t in self.tools.values()]
        if settings.enable_web_tools:
            self.api_tools += server_tools(model=settings.model, web_search_max_uses=settings.web_search_max_uses)

        # Бета-функции отправляются только напрямую в Anthropic и только моделям, которые их поддерживают.
        direct = not settings.proxy_mode
        self.use_thinking_config = settings.model in ADAPTIVE_THINKING_MODELS
        self.use_block_binding = direct and settings.model in BINDING_MODELS
        self.use_fallbacks = direct and settings.model in FALLBACK_MODELS
        self.thinking_display = settings.thinking_display
        if self.thinking_display == "updates" and not (direct and settings.model in THINKING_UPDATES_MODELS):
            self.thinking_display = "summarized"

    # ------------------------------------------------------------------ запросы

    def _request_params(self) -> dict[str, Any]:
        s = self.settings
        params: dict[str, Any] = {
            "model": s.model,
            "max_tokens": s.max_tokens,
            # cache_control на системном промпте кэширует его вместе со списком инструментов.
            # Чтение из кэша в 10–20 раз дешевле обычного входа (зависит от модели).
            "system": [{"type": "text", "text": self.system_prompt, "cache_control": {"type": "ephemeral"}}],
            "tools": self.api_tools,
        }
        if s.proxy_mode:
            # Классический способ кэшировать историю: метка на последнем сообщении.
            params["messages"] = _with_cache_breakpoint(self.messages)
        else:
            # Верхнеуровневый cache_control сам кэширует историю диалога.
            params["cache_control"] = {"type": "ephemeral"}
            params["messages"] = self.messages

        betas = []
        if self.use_thinking_config:
            # Модель сама решает, сколько думать; глубину рассуждений регулирует effort.
            thinking: dict[str, Any] = {"type": "adaptive", "display": self.thinking_display}
            if self.use_block_binding:
                thinking["block_binding"] = {"prefix_mismatch_behavior": "drop_block"}
                betas.append(BINDING_BETA)
            if self.thinking_display == "updates":
                betas.append(THINKING_UPDATES_BETA)
            params["thinking"] = thinking
            params["output_config"] = {"effort": s.effort}
        if self.use_fallbacks:
            params["fallbacks"] = "default"
            betas.append(FALLBACK_BETA)
        if not s.proxy_mode:
            params["betas"] = betas
        return params

    def _request_once(self) -> Any:
        """Один запрос к API в режиме потока: текст печатается по мере генерации."""
        # Напрямую — бета-раздел API (там доступны бета-функции), через посредника — основной.
        messages_api = self.client.messages if self.settings.proxy_mode else self.client.beta.messages
        with messages_api.stream(**self._request_params()) as stream:
            for event in stream:
                if event.type == "text":
                    self.events.on_text(event.text)
                elif event.type == "thinking":
                    self.events.on_thinking(event.thinking)
                elif event.type == "content_block_stop":
                    block = event.content_block
                    if block.type in ("text", "thinking"):
                        self.events.on_block_end(block.type)
                    elif block.type == "server_tool_use":
                        self.events.on_server_tool(block.name, block.input)
            return stream.get_final_message()

    # ---------------------------------------------------------------- один ход

    def ask(self, user_text: str) -> str:
        """Отправляет сообщение пользователя и работает, пока Claude не даст
        финальный ответ. Возвращает текст финального ответа."""
        turn_start = len(self.messages)
        self.messages.append({"role": "user", "content": user_text})
        try:
            return self._run_turn(turn_start)
        except BaseException:
            # Ошибка сети/API или Ctrl+C до первого ответа: убираем сообщение,
            # чтобы его можно было просто отправить ещё раз.
            if len(self.messages) == turn_start + 1:
                self.messages.pop()
            raise

    def _run_turn(self, turn_start: int) -> str:
        rounds = 0
        json_retries = 0
        while True:
            try:
                response = self._request_once()
            except ValueError:
                # Claude прислал аргументы инструмента, которые не разбираются как JSON.
                # Ошибки API — это не ValueError, они пробрасываются дальше.
                json_retries += 1
                if json_retries > MAX_JSON_RETRIES:
                    raise
                self.events.on_notice("Не удалось разобрать аргументы инструмента, повторяю запрос…")
                continue
            json_retries = 0
            self.usage.add(response.usage)
            self._notice_if_fallback(response)

            if response.stop_reason == "refusal":
                # Отказ: убираем весь ход из истории, иначе следующий запрос снова упрётся в него.
                del self.messages[turn_start:]
                category = response.stop_details.category if response.stop_details else None
                self.events.on_notice(
                    f"Модель отклонила запрос (категория: {category or 'не указана'}). "
                    "Ход удалён из истории — переформулируйте запрос."
                )
                return ""

            content = [block.to_dict(mode="json") for block in response.content]
            tool_uses = [block for block in response.content if block.type == "tool_use"]

            if response.stop_reason == "max_tokens" and tool_uses:
                # Аргументы инструмента обрезаны на середине — выполнять такое нельзя.
                # Обрезанный ответ не сохраняем; уже сделанные шаги хода остаются в истории.
                if len(self.messages) == turn_start + 1:
                    self.messages.pop()
                self.events.on_notice(
                    "Ответ упёрся в лимит AGENT_MAX_TOKENS посреди вызова инструмента и отброшен. "
                    "Увеличьте AGENT_MAX_TOKENS в .env и повторите запрос."
                )
                return ""

            rounds += 1
            if response.stop_reason == "pause_turn":
                # Серверный инструмент (веб-поиск) не уложился в один запрос:
                # отправляем ответ обратно как есть, и API продолжит с того же места.
                self.messages.append({"role": "assistant", "content": content})
                if rounds >= self.settings.max_tool_rounds:
                    return self._stop_on_round_limit()
                continue

            if not tool_uses:
                if content:
                    self.messages.append({"role": "assistant", "content": content})
                if response.stop_reason == "max_tokens":
                    self.events.on_notice(
                        "Ответ обрезан лимитом AGENT_MAX_TOKENS. Напишите «продолжай» или увеличьте лимит."
                    )
                return "".join(block.text for block in response.content if block.type == "text")

            results, interrupted = self._run_tools(tool_uses)
            # Ответ Claude и результаты инструментов добавляются вместе: в истории
            # не должно остаться tool_use без соответствующего tool_result.
            self.messages.append({"role": "assistant", "content": content})
            self.messages.append({"role": "user", "content": results})
            if interrupted:
                raise KeyboardInterrupt
            if rounds >= self.settings.max_tool_rounds:
                return self._stop_on_round_limit()

    def _stop_on_round_limit(self) -> str:
        self.events.on_notice(
            f"Достигнут лимит шагов за один ход (AGENT_MAX_TOOL_ROUNDS={self.settings.max_tool_rounds}). "
            "Напишите «продолжай», чтобы агент продолжил работу."
        )
        return ""

    def _notice_if_fallback(self, response: Any) -> None:
        iterations = getattr(response.usage, "iterations", None) or []
        if any(item.type == "fallback_message" for item in iterations) and response.stop_reason != "refusal":
            self.events.on_notice(f"Основная модель отклонила запрос, ответ дала резервная модель {response.model}.")

    # ------------------------------------------------------------ инструменты

    def _run_tools(self, tool_uses: list[Any]) -> tuple[list[dict[str, Any]], bool]:
        """Выполняет все запрошенные инструменты. Возвращает (результаты, был ли Ctrl+C).

        На каждый tool_use обязательно должен быть tool_result, поэтому при
        прерывании оставшиеся инструменты получают результат-ошибку.
        """
        results = []
        interrupted = False
        for block in tool_uses:
            if interrupted:
                result = ToolResult("Выполнение прервано пользователем (Ctrl+C).", is_error=True)
            else:
                try:
                    result = self._run_tool(block.name, block.input)
                except KeyboardInterrupt:
                    interrupted = True
                    result = ToolResult("Выполнение прервано пользователем (Ctrl+C).", is_error=True)
            tool_result: dict[str, Any] = {"type": "tool_result", "tool_use_id": block.id, "content": result.content}
            if result.is_error:
                tool_result["is_error"] = True
            results.append(tool_result)
        return results, interrupted

    def _run_tool(self, name: str, tool_input: Any) -> ToolResult:
        self.events.on_tool_call(name, tool_input)
        tool = self.tools.get(name)
        if tool is None:
            result = ToolResult(f"Инструмента {name!r} не существует.", is_error=True)
        else:
            try:
                tool.parse_input(tool_input)
            except ToolError as exc:
                result = ToolResult(f"Ошибка: {exc}", is_error=True)
            else:
                if tool.requires_confirmation and not self.events.confirm_tool(name, tool_input):
                    result = ToolResult(
                        "Пользователь запретил это действие. Не повторяй его без нового разрешения; "
                        "спроси, как поступить иначе.",
                        is_error=True,
                    )
                else:
                    result = tool.run(tool_input, self.ctx)
        self.events.on_tool_result(name, result)
        return result

    # ------------------------------------------------------------ сессии

    def reset(self) -> None:
        """Начать новый диалог (заметки в долговременной памяти сохраняются)."""
        self.messages = []

    def save_session(self, path: Path | None = None) -> Path:
        if path is None:
            path = self.settings.data_dir / "sessions" / f"{datetime.now():%Y-%m-%d_%H-%M-%S}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"model": self.settings.model, "saved_at": datetime.now().isoformat(), "messages": self.messages}
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def load_session(self, path: Path) -> None:
        payload = json.loads(path.read_text(encoding="utf-8"))
        messages = payload.get("messages")
        if not isinstance(messages, list):
            raise ValueError(f"В файле {path} нет истории сообщений")
        self.messages = messages
