"""Конфиг Xray из ключа vless:// (deploy/vless_to_xray.py).

Ключи ниже выдуманные, но устроены как настоящие: так их выдают VPN-сервисы.
"""

from __future__ import annotations

import base64
import importlib.util
import io
import json
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "deploy" / "vless_to_xray.py"
spec = importlib.util.spec_from_file_location("vless_to_xray", SCRIPT)
vless = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vless)

UUID = "0f5e9e8c-1111-4a2b-9c3d-123456789abc"
REALITY = (
    f"vless://{UUID}@vpn.example.net:443?type=tcp&security=reality&encryption=none"
    "&flow=xtls-rprx-vision&sni=www.microsoft.com&fp=chrome&pbk=AbCdEfPublicKey123&sid=6ba85179e30d4fc2"
    "&spx=%2F#Нидерланды"
)


def test_reality_vision_key_becomes_local_http_proxy():
    config = vless.build_config(REALITY)
    inbound = config["inbounds"][0]
    assert inbound["listen"] == "127.0.0.1" and inbound["port"] == 10809 and inbound["protocol"] == "http"

    outbound = config["outbounds"][0]
    server = outbound["settings"]["vnext"][0]
    assert server["address"] == "vpn.example.net" and server["port"] == 443
    assert server["users"] == [{"id": UUID, "encryption": "none", "flow": "xtls-rprx-vision"}]
    stream = outbound["streamSettings"]
    assert stream["network"] == "tcp" and stream["security"] == "reality"
    assert stream["realitySettings"] == {
        "serverName": "www.microsoft.com",
        "fingerprint": "chrome",
        "publicKey": "AbCdEfPublicKey123",
        "shortId": "6ba85179e30d4fc2",
        "spiderX": "/",
    }


def test_tls_websocket_key():
    key = f"vless://{UUID}@cdn.example.org:8443?type=ws&security=tls&sni=cdn.example.org&path=%2Fws%3Fed%3D2048&host=cdn.example.org&alpn=h2%2Chttp%2F1.1"
    stream = vless.build_config(key)["outbounds"][0]["streamSettings"]
    assert stream["wsSettings"] == {"path": "/ws?ed=2048", "host": "cdn.example.org"}
    assert stream["tlsSettings"]["alpn"] == ["h2", "http/1.1"]
    assert vless.build_config(key)["outbounds"][0]["settings"]["vnext"][0]["port"] == 8443


def test_grpc_and_xhttp_keys():
    grpc = vless.build_config(f"vless://{UUID}@h.example:443?type=grpc&security=tls&serviceName=tun&mode=multi")
    assert grpc["outbounds"][0]["streamSettings"]["grpcSettings"] == {"serviceName": "tun", "multiMode": True}
    xhttp = vless.build_config(f"vless://{UUID}@h.example:443?type=xhttp&security=reality&pbk=K&sni=s&path=%2Fx")
    assert xhttp["outbounds"][0]["streamSettings"]["xhttpSettings"]["path"] == "/x"


@pytest.mark.parametrize(
    ("key", "message"),
    [
        ("vmess://abc", "это не ключ VLESS"),
        ("vless://@h.example:443?security=none", "идентификатора"),
        (f"vless://{UUID}@h.example:443?type=kcp", "не поддерживается"),
        (f"vless://{UUID}@h.example:443?security=reality&sni=s", "pbk"),
    ],
)
def test_bad_keys_are_explained_without_echoing_the_key(key, message):
    with pytest.raises(vless.BadKey, match=message) as error:
        vless.build_config(key)
    assert UUID not in str(error.value)


def test_script_reads_key_from_stdin_and_writes_valid_json():
    result = subprocess.run(
        [sys.executable, str(SCRIPT)], input=REALITY + "\n", capture_output=True, text=True, check=True
    )
    config = json.loads(result.stdout)
    assert config["outbounds"][0]["protocol"] == "vless"
    # Ключ не попадает в то, что видно на экране.
    assert UUID not in result.stderr and "127.0.0.1:10809" in result.stderr


# ---------------------------------------------------------------- подписка

KEY_NL = REALITY
KEY_DE = (
    f"vless://{UUID}@de.example.net:443?type=tcp&security=reality&pbk=DePublicKey&sni=www.google.com&fp=chrome"
    "&flow=xtls-rprx-vision#%F0%9F%87%A9%F0%9F%87%AA%20Германия"
)
OTHER = "vmess://eyJhZGQiOiJ4In0=\nss://YWVzLTI1Ni1nY206cGFzcw@h.example:8388#ss"


def encoded(text: str, *, urlsafe: bool = False, strip_padding: bool = False) -> bytes:
    raw = (base64.urlsafe_b64encode if urlsafe else base64.b64encode)(text.encode())
    return raw.rstrip(b"=") if strip_padding else raw


@pytest.mark.parametrize(
    "body",
    [
        encoded(f"{KEY_NL}\n{KEY_DE}\n{OTHER}"),
        encoded(f"{KEY_NL}\n{KEY_DE}\n{OTHER}", urlsafe=True, strip_padding=True),
        f"{KEY_NL}\r\n{OTHER}\r\n{KEY_DE}\r\n".encode(),
    ],
    ids=["base64", "base64url-без-выравнивания", "обычный-текст"],
)
def test_subscription_yields_only_vless_keys(body):
    keys = vless.parse_subscription(body)
    assert sorted(keys) == sorted([KEY_NL, KEY_DE])


def test_server_list_shows_names_not_secrets():
    shown = vless.describe_key(KEY_DE)
    assert shown == "🇩🇪 Германия · tcp+reality"
    assert UUID not in shown and "de.example.net" not in shown


def test_subscription_link_end_to_end(tmp_path):
    body = encoded(f"{KEY_NL}\n{OTHER}\n{KEY_DE}")
    agents = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            agents.append(self.headers.get("User-Agent"))
            if self.path != "/sub/token":
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        result = subprocess.run(
            [sys.executable, str(SCRIPT)], input=f"{url}/sub/token\n2\n", capture_output=True, text=True, check=True
        )
        missing = subprocess.run(
            [sys.executable, str(SCRIPT)], input=f"{url}/sub/old\n", capture_output=True, text=True
        )
    finally:
        server.shutdown()

    config = json.loads(result.stdout)
    assert config["outbounds"][0]["settings"]["vnext"][0]["address"] == "de.example.net"
    assert "1. Нидерланды · tcp+reality" in result.stderr and "2. 🇩🇪 Германия" in result.stderr
    assert UUID not in result.stderr and "/sub/token" not in result.stderr
    assert agents[0].startswith("v2rayN")

    assert missing.returncode == 1
    assert "ошибкой 404" in missing.stderr and "/sub/old" not in missing.stderr


def test_wrong_server_number_is_refused(monkeypatch):
    monkeypatch.setattr(sys, "stdin", io.StringIO("7\n"))
    with pytest.raises(vless.BadKey, match="от 1 до 2"):
        vless.choose_key([KEY_NL, KEY_DE])
