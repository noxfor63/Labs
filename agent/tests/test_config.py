"""Настройки из agent/.env."""

from __future__ import annotations

import pytest

from channel_agent import config
from channel_agent.config import ConfigError, load_settings

VARS = (
    "TELEGRAM_CHANNEL",
    "TELEGRAM_ALLOWED_USERS",
    "AGENT_ACTIVE_HOURS",
    "AGENT_TIMEZONE",
    "PP_API_URL",
    "PP_REPO",
    "AGENT_SCAN_INTERVAL_HOURS",
    "ANTHROPIC_BASE_URL",
    "AGENT_PROXY_MODE",
)


@pytest.fixture
def env(monkeypatch, tmp_path):
    for name in VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(config, "AGENT_ROOT", tmp_path)

    def setenv(**values):
        for key, value in values.items():
            monkeypatch.setenv(key, value)
        return load_settings(tmp_path / "missing.env")

    return setenv


def test_defaults_are_safe(env):
    settings = env()
    assert settings.model == "claude-sonnet-5-5"
    assert settings.enable_web_tools is False
    assert settings.telegram_allowed_users == frozenset()
    assert settings.active_hours == (9, 21)
    assert settings.github_repo == "noxfor63/Labs"


def test_channel_link_is_normalized(env):
    assert env(TELEGRAM_CHANNEL="https://t.me/po_puti56").channel_id == "@po_puti56"
    assert env(TELEGRAM_CHANNEL="-1001234567890").channel_id == "-1001234567890"


def test_smartapi_switches_proxy_mode_on(env):
    assert env(ANTHROPIC_BASE_URL="https://api.smartapi.pro").proxy_mode is True


@pytest.mark.parametrize(
    ("name", "value", "message"),
    [
        ("TELEGRAM_CHANNEL", "po puti", "@имя_канала"),
        ("AGENT_ACTIVE_HOURS", "21-9", "начало раньше конца"),
        ("AGENT_TIMEZONE", "Orenburg", "часовой пояс"),
        ("PP_API_URL", "vk-rideshare.duckdns.org", "https://"),
        ("PP_REPO", "Labs", "владелец/репозиторий"),
        ("AGENT_SCAN_INTERVAL_HOURS", "0.1", "не меньше"),
        ("TELEGRAM_ALLOWED_USERS", "@noxfor", "числовые"),
    ],
)
def test_mistakes_are_explained(env, name, value, message):
    with pytest.raises(ConfigError, match=message):
        env(**{name: value})
