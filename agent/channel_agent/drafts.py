"""Черновики постов и состояние обхода.

Черновик — единственное, что агент умеет создавать. Опубликовать его может
только код бота по нажатию владельца (bot.py), и публикуется ровно тот
текст, который владелец видел в карточке: у модели нет ни инструмента
публикации, ни способа поменять текст после показа.

Всё хранится в двух JSON-файлах в data/: drafts.json и state.json. Базы не
нужно — черновиков десятки, а файл переживает перезапуск и читается глазами.
Запись атомарная (через временный файл), доступ — под замком: инструменты
работают в потоке агента, кнопки — в цикле событий бота.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# Telegram принимает в сообщении не больше 4096 символов.
TELEGRAM_TEXT_LIMIT = 4096

DRAFT_KINDS = ("update", "digest", "drivers", "howto", "safety", "other")
KIND_LABELS = {
    "update": "обновление",
    "digest": "дайджест поездок",
    "drivers": "нужны водители",
    "howto": "как пользоваться",
    "safety": "безопасность",
    "other": "другое",
}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Draft:
    id: str
    kind: str
    text: str
    reason: str
    created_at: str
    commits: list[str] = field(default_factory=list)
    with_button: bool = True
    # pending — ждёт решения; published / rejected — решено; superseded — заменён правкой.
    status: str = "pending"
    replaces: str | None = None
    decided_at: str | None = None
    channel_message_id: int | None = None
    # Где лежат карточки у владельцев ([chat_id, message_id]) — чтобы снять с них кнопки после решения.
    cards: list[list[int]] = field(default_factory=list)

    @property
    def label(self) -> str:
        return KIND_LABELS.get(self.kind, self.kind)


class DraftError(Exception):
    """Черновик нельзя создать или изменить. Текст — для модели или владельца."""


# ---------------------------------------------------------------- проверка текста

_PHONE = re.compile(r"(?:\+7|\b8)[\s(-]*9\d{2}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b")
_URL = re.compile(r"https?://[^\s)]+")
ALLOWED_LINK_PREFIXES = (
    "https://t.me/po_puti56_bot",
    "https://t.me/po_puti56",
    "https://vk.ru/app54794463",
    "https://vk.com/app54794463",
    "https://vk-rideshare.duckdns.org/privacy",
)
# Обещания, от которых в проекте отказались намеренно (marketing/telegram/04-roadmap.md, п. 10,
# 06-post-templates.md, «Чего в шаблонах нет»). Не запрет, а повод перечитать.
RISKY_WORDS = {
    "бесплатн": "обещание бесплатности — от него отказались намеренно",
    "комисси": "слово «комиссия» — обещаний про неё не даём",
    "навсегда": "«навсегда» — обещание, которое придётся отзывать",
    "круглосуточ": "«круглосуточно» — поездки появляются, когда их создают люди",
    "уведомлени": "уведомлений в приложении нет",
    "гарантир": "гарантий сервис не даёт",
    "проверенн": "не обещаем проверок, которых нет: прав, страховки, документов",
}


def lint_post(text: str) -> list[str]:
    """Что в тексте стоит перечитать перед публикацией. Пустой список — замечаний нет.

    Это страховка, а не цензура: замечания показываются владельцу в карточке,
    решение остаётся за ним.
    """
    warnings = []
    if _PHONE.search(text):
        warnings.append("в тексте номер телефона — это персональные данные")
    for url in _URL.findall(text):
        if not url.startswith(ALLOWED_LINK_PREFIXES):
            warnings.append(f"посторонняя ссылка: {url}")
    lowered = text.lower()
    for stem, why in RISKY_WORDS.items():
        if stem in lowered:
            warnings.append(why)
    return warnings


# ---------------------------------------------------------------- хранилище


class DraftStore:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self._drafts_file = data_dir / "drafts.json"
        self._state_file = data_dir / "state.json"
        self._lock = threading.RLock()

    # ---- файлы

    def _read(self, path: Path, default: Any) -> Any:
        if not path.is_file():
            return default
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            raise DraftError(f"Файл {path} повреждён — исправьте или удалите его.") from None

    def _write(self, path: Path, payload: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)

    def _load_drafts(self) -> list[Draft]:
        return [Draft(**item) for item in self._read(self._drafts_file, [])]

    def _save_drafts(self, drafts: list[Draft]) -> None:
        self._write(self._drafts_file, [asdict(d) for d in drafts])

    # ---- черновики

    def all(self) -> list[Draft]:
        with self._lock:
            return self._load_drafts()

    def get(self, draft_id: str) -> Draft | None:
        with self._lock:
            return next((d for d in self._load_drafts() if d.id == draft_id), None)

    def pending(self) -> list[Draft]:
        return [d for d in self.all() if d.status == "pending"]

    def create(
        self,
        *,
        kind: str,
        text: str,
        reason: str,
        commits: list[str],
        with_button: bool,
        max_pending: int,
        replaces: str | None = None,
    ) -> Draft:
        text = text.strip()
        if kind not in DRAFT_KINDS:
            raise DraftError(f"Неизвестный вид поста {kind!r}. Возможные: {', '.join(DRAFT_KINDS)}.")
        if not text:
            raise DraftError("Пустой текст поста.")
        if len(text) > TELEGRAM_TEXT_LIMIT:
            raise DraftError(f"Текст длиннее {TELEGRAM_TEXT_LIMIT} символов ({len(text)}) — сократите.")
        with self._lock:
            drafts = self._load_drafts()
            replaced = None
            if replaces is not None:
                replaced = next((d for d in drafts if d.id == replaces), None)
                if replaced is None or replaced.status != "pending":
                    raise DraftError(f"Черновика #{replaces} среди ждущих согласования нет — заменять нечего.")
            waiting = sum(1 for d in drafts if d.status == "pending" and d is not replaced)
            if waiting >= max_pending:
                raise DraftError(
                    f"Уже {waiting} черновика ждут решения владельца — новый не создаю, пока он не разберёт их."
                )
            draft = Draft(
                id=secrets.token_hex(3),
                kind=kind,
                text=text,
                reason=reason.strip(),
                created_at=now_utc().isoformat(timespec="seconds"),
                # Правка наследует коммиты исходного черновика, если новых не назвали.
                commits=list(dict.fromkeys(commits or (replaced.commits if replaced else []))),
                with_button=with_button,
                replaces=replaces,
            )
            if replaced is not None:
                replaced.status = "superseded"
                replaced.decided_at = draft.created_at
            drafts.append(draft)
            self._save_drafts(drafts)
            return draft

    def add_card(self, draft_id: str, chat_id: int, message_id: int) -> None:
        with self._lock:
            drafts = self._load_drafts()
            for d in drafts:
                if d.id == draft_id:
                    d.cards.append([chat_id, message_id])
            self._save_drafts(drafts)

    def decide(self, draft_id: str, status: str, *, channel_message_id: int | None = None) -> Draft:
        """Отметить решение владельца. Решённый черновик второй раз не решается."""
        if status not in ("published", "rejected"):
            raise ValueError(status)
        with self._lock:
            drafts = self._load_drafts()
            draft = next((d for d in drafts if d.id == draft_id), None)
            if draft is None:
                raise DraftError(f"Черновика #{draft_id} нет.")
            if draft.status != "pending":
                raise DraftError(f"Черновик #{draft_id} уже не ждёт решения ({draft.status}).")
            draft.status = status
            draft.decided_at = now_utc().isoformat(timespec="seconds")
            draft.channel_message_id = channel_message_id
            self._save_drafts(drafts)
            # Коммиты, о которых решили — опубликовав или отказавшись, — больше не предлагаются.
            self.mark_handled(draft.commits)
            return draft

    def published_since(self, days: int) -> list[Draft]:
        border = now_utc() - timedelta(days=days)
        return [
            d
            for d in self.all()
            if d.status == "published" and d.decided_at and datetime.fromisoformat(d.decided_at) >= border
        ]

    # ---- состояние обхода

    def state(self) -> dict[str, Any]:
        with self._lock:
            return self._read(self._state_file, {})

    def update_state(self, **changes: Any) -> dict[str, Any]:
        with self._lock:
            state = self._read(self._state_file, {})
            state.update(changes)
            self._write(self._state_file, state)
            return state

    def handled(self) -> set[str]:
        """Коммиты, по которым уже есть решение или ждущий черновик."""
        state = self.state()
        done = set(state.get("handled_commits", []))
        for d in self.all():
            if d.status == "pending":
                done.update(d.commits)
        return done

    def mark_handled(self, shas: list[str]) -> None:
        with self._lock:
            state = self._read(self._state_file, {})
            handled = list(dict.fromkeys([*state.get("handled_commits", []), *shas]))
            state["handled_commits"] = handled
            self._write(self._state_file, state)

    def rebaseline(self, head: str) -> None:
        """Все коммиты до head разобраны — начинаем счёт заново, список «разобранных» не растёт вечно."""
        self.update_state(baseline_commit=head, handled_commits=[])
