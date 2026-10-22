"""Общие заготовки для тестов. Ни Claude, ни Telegram, ни GitHub настоящие не нужны: всё подменено."""

from __future__ import annotations

import copy
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from anthropic.types.beta import BetaMessage

from channel_agent.config import AGENT_ROOT, Settings
from channel_agent.drafts import DraftStore
from channel_agent.services import Services
from channel_agent.sources import Commit
from channel_agent.tools import ToolContext
from channel_agent.tools.base import ToolError

OWNER = 42
CHANNEL = "@test_channel"


# ---------------------------------------------------------------- Claude (перенесено из MetodiLabs)


def make_message(content: list[dict[str, Any]], stop_reason: str = "end_turn", **extra: Any) -> BetaMessage:
    return BetaMessage.model_validate(
        {
            "id": "msg_test",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-5-5",
            "content": content,
            "stop_reason": stop_reason,
            "stop_sequence": None,
            "usage": {"input_tokens": 100, "output_tokens": 20},
            **extra,
        }
    )


class FakeStream:
    def __init__(self, message: BetaMessage, events: list[Any]) -> None:
        self._message = message
        self._events = events

    def __enter__(self) -> FakeStream:
        return self

    def __exit__(self, *exc: Any) -> bool:
        return False

    def __iter__(self):
        return iter(self._events)

    def get_final_message(self) -> BetaMessage:
        return self._message


class FakeMessages:
    def __init__(self, responses: list[Any]) -> None:
        self._responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def stream(self, **params: Any) -> FakeStream:
        self.calls.append(copy.deepcopy(params))
        item = self._responses.pop(0)
        if isinstance(item, BaseException):
            raise item
        events = [SimpleNamespace(type="text", text=block.text) for block in item.content if block.type == "text"]
        return FakeStream(item, events)


class FakeClient:
    def __init__(self, responses: list[Any]) -> None:
        self.api = FakeMessages(responses)
        self.beta = SimpleNamespace(messages=SimpleNamespace(stream=self.api.stream))
        self.messages = SimpleNamespace(stream=self.api.stream)


def tool_use(name: str, tool_input: dict[str, Any], tool_id: str = "toolu_1") -> dict[str, Any]:
    return {"type": "tool_use", "id": tool_id, "name": name, "input": tool_input}


def text(value: str) -> dict[str, Any]:
    return {"type": "text", "text": value}


# ---------------------------------------------------------------- источники


def sha(n: int) -> str:
    return f"{n:07x}".ljust(40, "a")


class FakeGitHub:
    """Линейная история коммитов: commits[0] — самый старый."""

    def __init__(self, commits: list[Commit]) -> None:
        self.commits = commits
        self.docs: dict[str, str] = {}
        self.read_refs: list[str | None] = []

    def head(self, branch: str | None) -> str:
        return self.commits[-1].sha

    def _index(self, value: str) -> int:
        for i, commit in enumerate(self.commits):
            if commit.sha == value:
                return i
        raise ToolError(f"нет коммита {value}")

    def between(self, base: str, head: str) -> list[Commit]:
        return self.commits[self._index(base) + 1 : self._index(head) + 1]

    def since(self, head: str, since_iso: str, limit: int = 50) -> list[Commit]:
        return [c for c in self.commits[: self._index(head) + 1] if c.date >= since_iso][-limit:]

    def files(self, commit: str) -> list[str]:
        return ["apps/web/src/App.tsx"]

    def read_file(self, path: str, ref: str | None = None) -> str:
        self.read_refs.append(ref)
        if path not in self.docs:
            raise ToolError("GitHub: адрес не найден (404).")
        return self.docs[path]


class FakePP:
    def __init__(self, commit: str | None, items: list[dict[str, Any]] | None = None) -> None:
        self.commit = commit
        self.items = items or []

    def status(self) -> dict[str, Any]:
        return {"version": "0.2.0", "commit": self.commit, "activeTrips": len(self.items)}

    def trips(self, days: int) -> dict[str, Any]:
        return {"generatedAt": "2026-10-22T10:00:00.000Z", "days": days, "items": self.items}


def make_commits(count: int) -> list[Commit]:
    return [
        Commit(sha=sha(i), date=f"2026-10-{10 + i:02d}T12:00:00Z", message=f"Изменение {i}\n\nПодробности {i}.")
        for i in range(count)
    ]


# ---------------------------------------------------------------- настройки и службы


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        model="claude-sonnet-5-5",
        effort="medium",
        max_tokens=32000,
        max_tool_rounds=15,
        thinking_display="omitted",
        enable_web_tools=False,
        web_search_max_uses=3,
        data_dir=tmp_path / "data",
        system_prompt_file=AGENT_ROOT / "prompts" / "system.md",
        telegram_allowed_users=frozenset({OWNER}),
        channel_id=CHANNEL,
    )


@pytest.fixture
def github() -> FakeGitHub:
    return FakeGitHub(make_commits(5))


@pytest.fixture
def services(settings: Settings, github: FakeGitHub) -> Services:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    created: list = []
    svc = Services(
        settings=settings,
        store=DraftStore(settings.data_dir),
        pp_api=FakePP(commit=github.commits[-1].sha),
        github=github,
    )
    svc.on_draft = created.append
    svc.created = created  # type: ignore[attr-defined]
    return svc


@pytest.fixture
def ctx(settings: Settings, services: Services) -> ToolContext:
    return ToolContext(data_dir=settings.data_dir, services=services)
