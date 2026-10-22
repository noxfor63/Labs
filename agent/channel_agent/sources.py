"""Откуда агент узнаёт новости: API «По пути» и репозиторий на GitHub.

Оба клиента только читают. Ошибки сети и ответы не того вида превращаются в
ToolError с понятным текстом — модель увидит его как результат инструмента и
либо обойдётся без источника, либо честно скажет владельцу, чего не знает.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import httpx

from .tools.base import ToolError

TIMEOUT = httpx.Timeout(20.0, connect=10.0)


def _describe_http_error(source: str, exc: httpx.HTTPError) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status == 401:
            return f"{source}: ключ не принят (401). Проверьте ключ в agent/.env."
        if status == 404:
            return f"{source}: адрес не найден (404)."
        return f"{source}: ошибка {status}."
    return f"{source}: нет связи ({type(exc).__name__}). Повторите позже."


class PPApi:
    """Адреса /api/agent/* на сервере «По пути»: что выкачено и какие поездки.

    Личного там нет по построению — сервер не отдаёт ни имён, ни телефонов
    (apps/api/src/routes/agent.ts).
    """

    def __init__(self, base_url: str, token: str, *, transport: httpx.BaseTransport | None = None) -> None:
        self._client = httpx.Client(
            base_url=f"{base_url}/agent",
            headers={"Authorization": f"Bearer {token}"},
            timeout=TIMEOUT,
            transport=transport,
        )

    @classmethod
    def from_env(cls, base_url: str | None) -> PPApi | None:
        token = os.environ.get("PP_API_TOKEN", "").strip()
        if base_url is None or not token:
            return None
        return cls(base_url, token)

    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            response = self._client.get(path, params=params)
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPError as exc:
            raise ToolError(_describe_http_error("API «По пути»", exc)) from None
        except ValueError:
            raise ToolError("API «По пути» ответил не JSON — возможно, адрес PP_API_URL указан неверно.") from None
        if not isinstance(data, dict):
            raise ToolError("API «По пути» ответил неожиданным форматом.")
        return data

    def status(self) -> dict[str, Any]:
        """{version, commit, activeTrips}: commit может быть null — тогда неизвестно, что выкачено."""
        return self._get("/status")

    def trips(self, days: int) -> dict[str, Any]:
        """{generatedAt, days, items: [{fromCity, toCity, departAt, role, seatsTotal, seatsLeft, priceRub}]}"""
        return self._get("/trips", {"days": days})


@dataclass(frozen=True)
class Commit:
    sha: str
    date: str
    message: str


class GitHub:
    """Чтение коммитов репозитория. Токен нужен только для закрытого репозитория."""

    def __init__(self, repo: str, *, token: str = "", transport: httpx.BaseTransport | None = None) -> None:
        headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self.repo = repo
        self._client = httpx.Client(
            base_url=f"https://api.github.com/repos/{repo}", headers=headers, timeout=TIMEOUT, transport=transport
        )

    @classmethod
    def from_env(cls, repo: str) -> GitHub:
        return cls(repo, token=os.environ.get("GITHUB_TOKEN", "").strip())

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        try:
            response = self._client.get(path, params=params)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as exc:
            hint = ""
            if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in (403, 404):
                hint = " Если репозиторий закрытый — нужен GITHUB_TOKEN с правом чтения."
            raise ToolError(_describe_http_error(f"GitHub {self.repo}", exc) + hint) from None

    @staticmethod
    def _commit(raw: dict[str, Any]) -> Commit:
        return Commit(
            sha=raw["sha"],
            date=raw["commit"]["committer"]["date"],
            message=raw["commit"]["message"],
        )

    def head(self, branch: str | None) -> str:
        """Последний коммит ветки; без ветки — ветки по умолчанию."""
        data = self._get("/commits", {"per_page": 1, **({"sha": branch} if branch else {})})
        if not data:
            raise ToolError(f"В репозитории {self.repo} нет коммитов.")
        return data[0]["sha"]

    def since(self, head: str, since_iso: str, limit: int = 50) -> list[Commit]:
        """Коммиты до head включительно, сделанные после since_iso. Старые — первыми."""
        data = self._get("/commits", {"sha": head, "since": since_iso, "per_page": limit})
        return [self._commit(item) for item in reversed(data)]

    def between(self, base: str, head: str) -> list[Commit]:
        """Коммиты после base до head включительно. Старые — первыми."""
        if base == head:
            return []
        data = self._get(f"/compare/{base}...{head}")
        return [self._commit(item) for item in data.get("commits", [])]

    def files(self, sha: str) -> list[str]:
        """Какие файлы менял коммит — чтобы отличить изменение для людей от внутреннего."""
        data = self._get(f"/commits/{sha}")
        return [item["filename"] for item in data.get("files", [])]

    def read_file(self, path: str, ref: str | None = None) -> str:
        """Текст файла репозитория (маркетинговые правила, шаблоны постов)."""
        try:
            response = self._client.get(
                f"/contents/{path}",
                params={"ref": ref} if ref else None,
                headers={"Accept": "application/vnd.github.raw+json"},
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ToolError(_describe_http_error(f"GitHub {self.repo}", exc)) from None
        return response.text
