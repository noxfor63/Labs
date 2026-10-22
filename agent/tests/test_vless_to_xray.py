"""Конфиг Xray из ключа vless:// (deploy/vless_to_xray.py).

Ключи ниже выдуманные, но устроены как настоящие: так их выдают VPN-сервисы.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
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
