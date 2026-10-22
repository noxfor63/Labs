"""Настройки агента канала.

Все значения читаются из переменных окружения; удобнее всего — из файла
`agent/.env` (шаблон — `agent/.env.example`). Разбор переменных перенесён из
MetodiLabs (agent/config.py) почти без изменений, чтобы оба агента
настраивались одинаково; добавлены только настройки канала.

Секреты — ключ Claude, токен бота, ключ API «По пути», токен GitHub — в
объект настроек не попадают: их читают из окружения те, кому они нужны, в
момент использования. Так их не напечатает ни отладка, ни ошибка.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dotenv import load_dotenv

# Корень агента — папка agent/ репозитория, в ней лежат .env и prompts/.
AGENT_ROOT = Path(__file__).resolve().parent.parent

EFFORT_LEVELS = ("low", "medium", "high", "xhigh", "max")
THINKING_DISPLAYS = ("updates", "summarized", "omitted")
ANTHROPIC_API_HOST = "api.anthropic.com"
API_KEY_PLACEHOLDER = "sk-ant-PASTE-YOUR-KEY-HERE"

DEFAULT_APP_URL = "https://t.me/po_puti56_bot/app"


class ConfigError(Exception):
    """Ошибка в настройках (.env). Текст сообщения показывается пользователю."""


@dataclass(frozen=True)
class Settings:
    # --- Claude
    model: str
    effort: str
    max_tokens: int
    max_tool_rounds: int
    thinking_display: str
    enable_web_tools: bool
    web_search_max_uses: int
    data_dir: Path
    system_prompt_file: Path
    api_base_url: str | None = None
    proxy_mode: bool = False
    use_system_certs: bool = False

    # --- Telegram
    # Кому бот отвечает и чьё нажатие «Опубликовать» считается согласованием.
    telegram_allowed_users: frozenset[int] = frozenset()
    telegram_proxy: str | None = None
    # Куда публиковать: @имя_канала или числовой id вида -100…
    channel_id: str = ""
    # Кнопка под постом. Пустой адрес — постов с кнопкой не бывает.
    post_button_text: str = "Открыть «По пути»"
    post_button_url: str = DEFAULT_APP_URL

    # --- Источники
    # Адрес API «По пути» вместе с /api, например https://vk-rideshare.duckdns.org/api
    pp_api_url: str | None = None
    # Репозиторий, за которым следит агент, и ветка — если сервер не сказал, что выкачено.
    github_repo: str = "noxfor63/Labs"
    github_branch: str | None = None
    # С какого момента считать обновления при самом первом запуске. None — с текущего
    # выкаченного коммита: прошлое агент не пересказывает.
    updates_since: str | None = None

    # --- Обход
    scan_interval_hours: float = 6.0
    # Часы, когда обход разрешён (местное время): черновик не должен будить владельца.
    active_hours: tuple[int, int] = (9, 21)
    timezone: str = "Asia/Yekaterinburg"
    # Сколько черновиков может ждать согласования одновременно.
    max_pending_drafts: int = 3


def _get_str(name: str, default: str) -> str:
    value = os.environ.get(name, "").strip()
    return value or default


def _get_int(name: str, default: int, minimum: int = 1) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ConfigError(f"{name} должно быть целым числом, а сейчас: {raw!r}") from None
    if value < minimum:
        raise ConfigError(f"{name} должно быть не меньше {minimum}, а сейчас: {value}")
    return value


def _get_float(name: str, default: float, minimum: float) -> float:
    raw = os.environ.get(name, "").strip().replace(",", ".")
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        raise ConfigError(f"{name} должно быть числом, а сейчас: {raw!r}") from None
    if value < minimum:
        raise ConfigError(f"{name} должно быть не меньше {minimum}, а сейчас: {value}")
    return value


def _get_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    if raw in ("1", "true", "yes", "on", "да"):
        return True
    if raw in ("0", "false", "no", "off", "нет"):
        return False
    raise ConfigError(f"{name} должно быть true или false, а сейчас: {raw!r}")


def _get_choice(name: str, default: str, choices: tuple[str, ...]) -> str:
    value = _get_str(name, default).lower()
    if value not in choices:
        raise ConfigError(f"{name} должно быть одним из {', '.join(choices)}, а сейчас: {value!r}")
    return value


def _get_path(name: str, default: str) -> Path:
    path = Path(_get_str(name, default)).expanduser()
    if not path.is_absolute():
        path = AGENT_ROOT / path
    return path.resolve()


def _get_id_list(name: str) -> frozenset[int]:
    raw = os.environ.get(name, "").replace(";", ",")
    ids = set()
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        if not part.lstrip("-").isdigit():
            raise ConfigError(f"{name} — это числовые Telegram ID через запятую, а сейчас: {raw.strip()!r}")
        ids.add(int(part))
    return frozenset(ids)


def _get_proxy(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    if not value:
        return None
    if value.lower() in ("none", "direct", "off", "нет"):
        return "none"
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https", "socks5", "socks5h") or not parsed.hostname:
        raise ConfigError(f"{name}: укажите none или адрес прокси вида http://127.0.0.1:8080, а сейчас: {value!r}")
    return value


def _get_url(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    if not value:
        return None
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ConfigError(f"{name} должен быть полным адресом, начинающимся с https://, а сейчас: {value!r}")
    return value.rstrip("/")


def _get_channel(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        return ""
    if value.startswith("https://t.me/"):
        value = "@" + value.removeprefix("https://t.me/").strip("/")
    if value.startswith("@") and len(value) > 1:
        return value
    if value.lstrip("-").isdigit():
        return value
    raise ConfigError(f"{name} — это @имя_канала или числовой id вида -100…, а сейчас: {value!r}")


def _get_repo(name: str, default: str) -> str:
    value = _get_str(name, default).removeprefix("https://github.com/").strip("/")
    parts = value.split("/")
    if len(parts) != 2 or not all(parts):
        raise ConfigError(f"{name} — это владелец/репозиторий, например noxfor63/Labs, а сейчас: {value!r}")
    return value


def _get_hours(name: str, default: tuple[int, int]) -> tuple[int, int]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        start, end = (int(part) for part in raw.split("-"))
    except ValueError:
        raise ConfigError(f"{name} — это часы вида 9-21, а сейчас: {raw!r}") from None
    if not (0 <= start < end <= 24):
        raise ConfigError(f"{name}: начало раньше конца, оба от 0 до 24, а сейчас: {raw!r}")
    return start, end


def _get_timezone(name: str, default: str) -> str:
    value = _get_str(name, default)
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise ConfigError(f"{name} — часовой пояс вида Asia/Yekaterinburg, а сейчас: {value!r}") from None
    return value


def load_settings(env_file: Path | None = None) -> Settings:
    """Читает agent/.env (если есть) и собирает настройки.

    Значения из .env важнее системных переменных окружения — как в MetodiLabs.
    """
    env_path = env_file or AGENT_ROOT / ".env"
    try:
        load_dotenv(env_path, override=True)
    except UnicodeDecodeError:
        raise ConfigError(f"файл {env_path} сохранён не в кодировке UTF-8.") from None
    for name in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"):
        value = os.environ.get(name)
        if value is not None and value.strip() in ("", API_KEY_PLACEHOLDER):
            del os.environ[name]

    api_base_url = os.environ.get("ANTHROPIC_BASE_URL", "").strip() or None
    if api_base_url is not None:
        parsed = urlparse(api_base_url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise ConfigError(f"ANTHROPIC_BASE_URL должен быть полным адресом, а сейчас: {api_base_url!r}")
    uses_other_host = api_base_url is not None and urlparse(api_base_url).hostname != ANTHROPIC_API_HOST
    proxy_mode = _get_bool("AGENT_PROXY_MODE", uses_other_host)

    branch = os.environ.get("PP_REPO_BRANCH", "").strip() or None
    since = os.environ.get("AGENT_UPDATES_SINCE", "").strip() or None

    return Settings(
        model=_get_str("AGENT_MODEL", "claude-sonnet-5-5"),
        effort=_get_choice("AGENT_EFFORT", "medium", EFFORT_LEVELS),
        max_tokens=_get_int("AGENT_MAX_TOKENS", 32000, minimum=1024),
        max_tool_rounds=_get_int("AGENT_MAX_TOOL_ROUNDS", 15),
        thinking_display=_get_choice("AGENT_THINKING_DISPLAY", "omitted", THINKING_DISPLAYS),
        # Посты пишутся по фактам из кода и базы; поиск в интернете им скорее вредит.
        enable_web_tools=_get_bool("AGENT_ENABLE_WEB_TOOLS", False),
        web_search_max_uses=_get_int("AGENT_WEB_SEARCH_MAX_USES", 3),
        data_dir=_get_path("AGENT_DATA_DIR", "data"),
        system_prompt_file=_get_path("AGENT_SYSTEM_PROMPT_FILE", "prompts/system.md"),
        api_base_url=api_base_url,
        proxy_mode=proxy_mode,
        use_system_certs=_get_bool("AGENT_USE_SYSTEM_CERTS", False),
        telegram_allowed_users=_get_id_list("TELEGRAM_ALLOWED_USERS"),
        telegram_proxy=_get_proxy("TELEGRAM_PROXY"),
        channel_id=_get_channel("TELEGRAM_CHANNEL"),
        post_button_text=_get_str("POST_BUTTON_TEXT", "Открыть «По пути»"),
        post_button_url=_get_url("POST_BUTTON_URL") or DEFAULT_APP_URL,
        pp_api_url=_get_url("PP_API_URL"),
        github_repo=_get_repo("PP_REPO", "noxfor63/Labs"),
        github_branch=branch,
        updates_since=since,
        scan_interval_hours=_get_float("AGENT_SCAN_INTERVAL_HOURS", 6.0, minimum=0.5),
        active_hours=_get_hours("AGENT_ACTIVE_HOURS", (9, 21)),
        timezone=_get_timezone("AGENT_TIMEZONE", "Asia/Yekaterinburg"),
        max_pending_drafts=_get_int("AGENT_MAX_PENDING_DRAFTS", 3),
    )


def has_api_credentials() -> bool:
    """Есть ли ключ для Claude API в окружении (вызывать после load_settings)."""
    return bool(os.environ.get("ANTHROPIC_API_KEY", "").strip() or os.environ.get("ANTHROPIC_AUTH_TOKEN", "").strip())
