#!/usr/bin/env python3
"""Конфиг Xray из ключа vless:// — чтобы агент ходил в Telegram через ваш VPN.

Зачем. С сервера «По пути» api.telegram.org не открывается, а агенту он нужен:
присылать черновики и публиковать посты. Xray с вашим VLESS-ключом поднимает
на сервере HTTP-прокси только на 127.0.0.1 — снаружи его не видно, — и агент
ходит через него в Telegram (TELEGRAM_PROXY=http://127.0.0.1:10809).
Остальной сервер и само приложение работают напрямую, как работали.

Ключ спрашивается скрытым вводом и никуда не печатается: ни в историю команд,
ни на экран. Нужен только Python, без сторонних пакетов.

    python3 vless_to_xray.py > /usr/local/etc/xray/config.json

Поддерживаются транспорты tcp, ws, grpc, httpupgrade и xhttp с защитой none,
tls или reality — это почти все ключи, которые выдают VPN-сервисы.
"""

from __future__ import annotations

import getpass
import json
import sys
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit

PROXY_PORT = 10809
NETWORKS = ("tcp", "ws", "grpc", "httpupgrade", "xhttp")
SECURITIES = ("none", "tls", "reality")


class BadKey(ValueError):
    """Ключ не разобрать. Текст объясняет почему — без самого ключа."""


def _param(query: dict[str, list[str]], name: str, default: str = "") -> str:
    values = query.get(name)
    return unquote(values[0]).strip() if values else default


def _stream_settings(query: dict[str, list[str]], host: str) -> dict[str, Any]:
    network = _param(query, "type", "tcp").lower()
    if network == "splithttp":
        network = "xhttp"
    if network not in NETWORKS:
        raise BadKey(f"транспорт {network!r} не поддерживается — нужен один из: {', '.join(NETWORKS)}")
    security = _param(query, "security", "none").lower()
    if security not in SECURITIES:
        raise BadKey(f"защита {security!r} не поддерживается — нужна одна из: {', '.join(SECURITIES)}")

    stream: dict[str, Any] = {"network": network, "security": security}
    sni = _param(query, "sni") or _param(query, "peer")
    fingerprint = _param(query, "fp")

    if security == "tls":
        tls: dict[str, Any] = {"serverName": sni or host}
        if fingerprint:
            tls["fingerprint"] = fingerprint
        alpn = _param(query, "alpn")
        if alpn:
            tls["alpn"] = [item.strip() for item in alpn.split(",") if item.strip()]
        if _param(query, "allowInsecure") in ("1", "true"):
            tls["allowInsecure"] = True
        stream["tlsSettings"] = tls
    elif security == "reality":
        public_key = _param(query, "pbk")
        if not public_key:
            raise BadKey("в ключе reality нет открытого ключа сервера (параметр pbk)")
        reality: dict[str, Any] = {
            "serverName": sni,
            # Без отпечатка reality не работает; chrome — то, что ставят клиенты по умолчанию.
            "fingerprint": fingerprint or "chrome",
            "publicKey": public_key,
            "shortId": _param(query, "sid"),
            "spiderX": _param(query, "spx"),
        }
        mldsa = _param(query, "pqv")
        if mldsa:
            reality["mldsa65Verify"] = mldsa
        stream["realitySettings"] = reality

    path = _param(query, "path")
    header_host = _param(query, "host")
    if network == "ws":
        stream["wsSettings"] = {"path": path or "/", "host": header_host}
    elif network == "httpupgrade":
        stream["httpupgradeSettings"] = {"path": path or "/", "host": header_host}
    elif network == "grpc":
        grpc: dict[str, Any] = {
            "serviceName": _param(query, "serviceName"),
            "multiMode": _param(query, "mode") == "multi",
        }
        authority = _param(query, "authority")
        if authority:
            grpc["authority"] = authority
        stream["grpcSettings"] = grpc
    elif network == "xhttp":
        xhttp: dict[str, Any] = {"path": path or "/", "host": header_host, "mode": _param(query, "mode", "auto")}
        extra = _param(query, "extra")
        if extra:
            try:
                xhttp["extra"] = json.loads(extra)
            except json.JSONDecodeError:
                raise BadKey("параметр extra в ключе — не JSON") from None
        stream["xhttpSettings"] = xhttp
    elif _param(query, "headerType") not in ("", "none"):
        raise BadKey("tcp с маскировкой под HTTP (headerType) не поддерживается")
    return stream


def build_config(key: str, port: int = PROXY_PORT) -> dict[str, Any]:
    """Ключ vless:// → конфиг Xray: HTTP-прокси на 127.0.0.1:port, весь его трафик — через VLESS."""
    key = key.strip()
    parts = urlsplit(key)
    if parts.scheme.lower() != "vless":
        raise BadKey("это не ключ VLESS — он должен начинаться с vless://")
    user_id = unquote(parts.username or "")
    if not user_id:
        raise BadKey("в ключе нет идентификатора пользователя (часть до @)")
    if not parts.hostname:
        raise BadKey("в ключе нет адреса сервера")
    try:
        server_port = parts.port or 443
    except ValueError:
        raise BadKey("порт сервера в ключе — не число") from None

    query = parse_qs(parts.query, keep_blank_values=True)
    user: dict[str, Any] = {"id": user_id, "encryption": _param(query, "encryption", "none") or "none"}
    flow = _param(query, "flow")
    if flow:
        user["flow"] = flow

    return {
        "log": {"loglevel": "warning"},
        "inbounds": [
            {
                "tag": "telegram-proxy",
                # Только локальный адрес: прокси нужен одному агенту на этом же сервере.
                "listen": "127.0.0.1",
                "port": port,
                "protocol": "http",
                "settings": {},
            }
        ],
        "outbounds": [
            {
                "tag": "vless",
                "protocol": "vless",
                "settings": {"vnext": [{"address": parts.hostname, "port": server_port, "users": [user]}]},
                "streamSettings": _stream_settings(query, parts.hostname),
            }
        ],
    }


def main() -> int:
    if sys.stdin.isatty():
        key = getpass.getpass("Вставьте ключ vless:// (ввод не отображается) и нажмите Enter: ")
    else:
        key = sys.stdin.readline()
    try:
        config = build_config(key)
    except BadKey as exc:
        print(f"Не получилось: {exc}.", file=sys.stderr)
        return 1
    json.dump(config, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    network = config["outbounds"][0]["streamSettings"]["network"]
    security = config["outbounds"][0]["streamSettings"]["security"]
    print(f"Готово: VLESS, {network} + {security}, прокси на 127.0.0.1:{PROXY_PORT}.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
