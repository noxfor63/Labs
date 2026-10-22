"""Сборка агента канала и плановый обход.

Создание клиента Claude и понятные сообщения об ошибках API перенесены из
MetodiLabs (agent/runtime.py) без изменений.
"""

from __future__ import annotations

import logging
import ssl
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import anthropic

from .config import Settings
from .core import Agent, AgentEvents, load_system_prompt
from .drafts import DraftStore, now_utc
from .services import Services
from .sources import GitHub, PPApi
from .tools import CHANNEL_TOOLS, ToolContext

log = logging.getLogger("po_puti.agent")

SCAN_PROMPT = "Плановый обход: {now}. Действуй по разделу «Плановый обход»."


def create_client(settings: Settings) -> anthropic.Anthropic:
    """Клиент Claude API. Ключ и адрес SDK берёт из переменных окружения (их заполняет .env)."""
    if settings.use_system_certs:
        return anthropic.Anthropic(http_client=anthropic.DefaultHttpxClient(verify=ssl.create_default_context()))
    return anthropic.Anthropic()


def build_services(settings: Settings) -> Services:
    """Настоящие службы по настройкам: черновики на диске, API «По пути», GitHub."""
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    return Services(
        settings=settings,
        store=DraftStore(settings.data_dir),
        pp_api=PPApi.from_env(settings.pp_api_url),
        github=GitHub.from_env(settings.github_repo),
    )


def create_agent(
    settings: Settings,
    services: Services,
    events: AgentEvents | None = None,
    *,
    extra_system_prompt: str = "",
    client: Any = None,
) -> Agent:
    system_prompt = load_system_prompt(settings.system_prompt_file)
    if extra_system_prompt:
        system_prompt = f"{system_prompt}\n\n{extra_system_prompt.strip()}"
    return Agent(
        client=client or create_client(settings),
        settings=settings,
        system_prompt=system_prompt,
        tools=CHANNEL_TOOLS,
        ctx=ToolContext(data_dir=settings.data_dir, services=services),
        events=events,
    )


def local_now(settings: Settings) -> datetime:
    return datetime.now(ZoneInfo(settings.timezone))


def run_scan(settings: Settings, services: Services, *, client: Any = None) -> str:
    """Один плановый обход: свежий агент без истории, одно сообщение, итог одной строкой.

    История не копится между обходами намеренно: каждый обход смотрит на
    канал заново, а память о договорённостях с владельцем живёт в заметках.
    """
    agent = create_agent(settings, services, client=client)
    now = local_now(settings)
    try:
        reply = agent.ask(SCAN_PROMPT.format(now=f"{now:%Y-%m-%d %H:%M}"))
    except anthropic.APIError as exc:
        reply = describe_api_error(exc, settings)
        log.error("Обход не удался: %s", reply)
    services.store.update_state(last_scan_at=now_utc().isoformat(timespec="seconds"), last_scan_result=reply.strip())
    log.info("Обход завершён: %s", reply.strip()[:200])
    return reply.strip()


def usage_report(agent: Agent) -> list[str]:
    """Строки отчёта о расходе токенов (команда /usage)."""
    u = agent.usage
    lines = [
        f"Запросов к API: {u.requests}",
        f"Входные токены: {u.input_tokens:,}",
        f"Кэш: запись {u.cache_write_tokens:,}, чтение {u.cache_read_tokens:,}",
        f"Выходные токены: {u.output_tokens:,}",
    ]
    if u.web_searches:
        lines.append(f"Веб-поисков: {u.web_searches}")
    cost = u.estimated_cost(agent.settings.model)
    if cost is not None:
        if agent.settings.proxy_mode:
            lines.append(
                f"По ценам Anthropic: ${cost:.4f} (посредник списывает по своим тарифам — смотрите его кабинет)"
            )
        else:
            lines.append(f"Примерная стоимость: ${cost:.4f} (без платы за веб-поиск; точные данные — в Console)")
    return lines


def _root_cause(exc: BaseException) -> BaseException:
    """Самая глубокая причина в цепочке исключений (например, ошибка SSL под ошибкой соединения)."""
    seen = {id(exc)}
    while True:
        nested = exc.__cause__ or exc.__context__
        if nested is None or id(nested) in seen:
            return exc
        seen.add(id(nested))
        exc = nested


def _describe_connection_error(exc: anthropic.APIConnectionError, settings: Settings) -> str:
    target = settings.api_base_url or "API Anthropic"
    cause = _root_cause(exc)
    reason = f"{type(cause).__name__}: {cause}"
    if isinstance(exc, anthropic.APITimeoutError):
        hint = "Сервер не ответил вовремя. Повторите запрос; если повторяется — проверьте интернет."
    elif isinstance(cause, ssl.SSLCertVerificationError) or "CERTIFICATE_VERIFY_FAILED" in reason:
        hint = (
            "Не прошла проверка сертификата защищённого соединения. На Windows так обычно бывает, когда "
            "антивирус (Kaspersky, ESET, Avast и др.) проверяет HTTPS-трафик. Добавьте в .env строку "
            "AGENT_USE_SYSTEM_CERTS=true — агент будет доверять сертификатам Windows, как браузер."
        )
    elif isinstance(cause, ConnectionRefusedError):
        hint = "Сервер отказал в соединении. Проверьте адрес и порт в ANTHROPIC_BASE_URL."
    elif any(marker in reason for marker in ("getaddrinfo", "Name or service not known", "nodename nor servname")):
        hint = "Адрес не найден. Проверьте написание ANTHROPIC_BASE_URL и подключение к интернету."
    elif "ProxyError" in reason or "proxy" in reason.lower():
        hint = "Мешает прокси-сервер. Проверьте переменные HTTPS_PROXY / HTTP_PROXY и настройки VPN."
    else:
        hint = "Проверьте интернет, VPN, антивирус или файрвол — они могут блокировать Python."
    return f"Нет связи с {target}.\n{hint}\nТехническая причина: {reason}"


def describe_api_error(exc: anthropic.APIError, settings: Settings) -> str:
    """Понятное описание ошибки API. Порядок важен: от частного к общему."""
    if isinstance(exc, anthropic.AuthenticationError):
        text = (
            "Неверный или отозванный ключ (401). Проверьте ANTHROPIC_API_KEY в файле .env "
            "(у посредника ключ может требоваться в ANTHROPIC_AUTH_TOKEN — см. его инструкцию)."
        )
    elif isinstance(exc, anthropic.PermissionDeniedError):
        text = "Нет доступа (403): у ключа нет прав на эту модель или функцию."
    elif isinstance(exc, anthropic.NotFoundError):
        text = "Не найдено (404): проверьте название модели в AGENT_MODEL."
    elif isinstance(exc, anthropic.RateLimitError):
        text = "Превышен лимит запросов (429). Подождите минуту и повторите."
    elif isinstance(exc, anthropic.BadRequestError):
        text = f"Некорректный запрос (400): {exc.message}"
    elif isinstance(exc, anthropic.OverloadedError):
        text = "Серверы Anthropic перегружены (529). Повторите запрос чуть позже."
    elif isinstance(exc, anthropic.APIStatusError):
        text = f"Ошибка API ({exc.status_code}): {exc.message}"
    elif isinstance(exc, anthropic.APIConnectionError):
        text = _describe_connection_error(exc, settings)
    else:
        text = f"Ошибка API: {exc}"
    request_id = getattr(exc, "request_id", None)
    if request_id:
        text += f" (request-id: {request_id})"
    return text + "\nПодсказки по ошибкам — в README.md, раздел «Частые проблемы»."
