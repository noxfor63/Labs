"""Запуск агента канала из командной строки.

python -m channel_agent             — бот редакции (основной режим, его и запускает служба)
python -m channel_agent --check     — проверить настройки и связь со всеми источниками
python -m channel_agent --scan-once — один обход без Telegram: черновик печатается в терминал
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

from .config import ConfigError, Settings, has_api_credentials, load_settings
from .drafts import Draft, lint_post
from .runtime import build_services, run_scan
from .services import Services
from .tools.base import ToolError


def _print_draft(draft: Draft) -> None:
    print(f"\n=== Черновик #{draft.id} · {draft.label} ===")
    print(f"Почему сейчас: {draft.reason}")
    for warning in lint_post(draft.text):
        print(f"⚠️  {warning}")
    print("---")
    print(draft.text)
    print("---")
    print("Это только черновик: в режиме --scan-once опубликовать его нельзя. Решение — в боте.\n")


def _check(settings: Settings, services: Services) -> int:
    ok = True

    def report(name: str, good: bool, detail: str) -> None:
        nonlocal ok
        ok = ok and good
        print(f"{'✅' if good else '❌'} {name}: {detail}")

    report("Ключ Claude", has_api_credentials(), "есть" if has_api_credentials() else "нет ANTHROPIC_API_KEY")
    print(f"   модель {settings.model}, через посредника: {'да' if settings.proxy_mode else 'нет'}")

    if services.pp_api is None:
        report("API «По пути»", False, "не заданы PP_API_URL и PP_API_TOKEN")
    else:
        try:
            status = services.pp_api.status()
            commit = status.get("commit")
            report(
                "API «По пути»",
                True,
                f"версия {status.get('version')}, коммит {commit[:7] if commit else 'неизвестен'}, "
                f"живых поездок {status.get('activeTrips')}",
            )
        except ToolError as exc:
            report("API «По пути»", False, str(exc))

    try:
        head = services.github.head(settings.github_branch)
        report("GitHub", True, f"{settings.github_repo}, последний коммит {head[:7]}")
    except ToolError as exc:
        report("GitHub", False, str(exc))

    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        report("Telegram", False, "нет TELEGRAM_BOT_TOKEN")
    else:
        ok = asyncio.run(_check_telegram(settings, token)) and ok
    report(
        "Кто согласует",
        bool(settings.telegram_allowed_users),
        ", ".join(map(str, sorted(settings.telegram_allowed_users))) or "TELEGRAM_ALLOWED_USERS пуст",
    )
    return 0 if ok else 1


async def _check_telegram(settings: Settings, token: str) -> bool:
    from telegram import Bot
    from telegram.error import TelegramError
    from telegram.request import HTTPXRequest

    proxy = settings.telegram_proxy
    if proxy == "none":
        request = HTTPXRequest(httpx_kwargs={"trust_env": False})
    elif proxy:
        request = HTTPXRequest(proxy=proxy)
    else:
        request = None
    try:
        async with Bot(token, request=request) as bot:
            me = await bot.get_me()
            print(f"✅ Telegram: бот @{me.username}")
            if not settings.channel_id:
                print("❌ Канал: не задан TELEGRAM_CHANNEL")
                return False
            member = await bot.get_chat_member(settings.channel_id, me.id)
            can_post = member.status == "creator" or (
                member.status == "administrator" and getattr(member, "can_post_messages", False)
            )
            print(
                f"{'✅' if can_post else '❌'} Канал {settings.channel_id}: "
                + ("права на публикацию есть" if can_post else "у бота нет права публиковать")
            )
            return can_post
    except TelegramError as exc:
        print(f"❌ Telegram: {exc}. Если сервер не видит api.telegram.org — задайте TELEGRAM_PROXY.")
        return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m channel_agent", description="Агент канала «По пути»")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="проверить настройки и связь")
    mode.add_argument("--scan-once", action="store_true", help="один обход без Telegram")
    args = parser.parse_args(argv)

    try:
        settings = load_settings()
    except ConfigError as exc:
        print(f"Ошибка в agent/.env: {exc}", file=sys.stderr)
        return 2
    services = build_services(settings)

    if args.check:
        return _check(settings, services)
    if not has_api_credentials():
        print("Не задан ANTHROPIC_API_KEY (или ANTHROPIC_AUTH_TOKEN у посредника) в agent/.env.", file=sys.stderr)
        return 2
    if args.scan_once:
        services.on_draft = _print_draft
        print(run_scan(settings, services))
        return 0

    from .bot import run_bot

    return run_bot(settings, services)
