"""Командная строка: проверка связи и обход без Telegram."""

from __future__ import annotations

from channel_agent import cli, runtime

from .conftest import FakeClient, make_message, text, tool_use


def test_check_reports_what_is_missing(services, settings, capsys, monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    code = cli._check(settings, services)
    out = capsys.readouterr().out
    assert code == 1
    assert "✅ API «По пути»: версия 0.2.0" in out
    assert "✅ GitHub" in out
    assert "❌ Telegram: нет TELEGRAM_BOT_TOKEN" in out
    assert "❌ Ключ Claude" in out


def test_scan_once_prints_draft_instead_of_sending(services, settings, capsys):
    services.on_draft = cli._print_draft
    client = FakeClient(
        [
            make_message(
                [tool_use("propose_post", {"kind": "other", "text": "Текст поста", "reason": "Тест"})], "tool_use"
            ),
            make_message([text("Черновик готов.")]),
        ]
    )
    result = runtime.run_scan(settings, services, client=client)
    out = capsys.readouterr().out
    assert "=== Черновик #" in out and "Текст поста" in out and "опубликовать его нельзя" in out
    assert result == "Черновик готов."
    assert client.api.calls[0]["messages"][0]["content"].startswith("Плановый обход:")
