"""Инструменты долговременной памяти: заметки (перенесено из MetodiLabs без изменений).

Claude API не хранит историю между запусками программы: каждый раз агент
начинает «с чистого листа». Заметки позволяют ему запоминать важное
(предпочтения пользователя, факты о проекте) в файле data/notes.json и
читать их в следующих сессиях.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from pydantic import BaseModel, Field

from .base import ToolContext, ToolError, tool


class SaveNoteInput(BaseModel):
    text: str = Field(description="Текст заметки: один факт или предпочтение, сформулированный кратко и понятно.")


class ReadNotesInput(BaseModel):
    query: str | None = Field(
        default=None,
        description="Слово или фраза для поиска по заметкам. Если не указано — вернуть все заметки.",
    )


def _notes_file(ctx: ToolContext) -> Path:
    return ctx.data_dir / "notes.json"


def _load(ctx: ToolContext) -> list[dict]:
    path = _notes_file(ctx)
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        raise ToolError(f"Файл заметок {path} повреждён. Исправьте или удалите его вручную.") from None


@tool(SaveNoteInput)
def save_note(args: SaveNoteInput, ctx: ToolContext) -> str:
    """Сохраняет заметку в долговременную память, доступную в следующих сессиях. Вызывай,
    когда пользователь просит что-то запомнить или сообщает устойчивый факт о себе, своих
    предпочтениях или проекте, который пригодится позже. Не сохраняй пароли и ключи."""
    notes = _load(ctx)
    note = {
        "id": max((n["id"] for n in notes), default=0) + 1,
        "created": datetime.now().isoformat(timespec="seconds"),
        "text": args.text.strip(),
    }
    notes.append(note)
    path = _notes_file(ctx)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(notes, ensure_ascii=False, indent=2), encoding="utf-8")
    return f"Заметка #{note['id']} сохранена."


@tool(ReadNotesInput)
def read_notes(args: ReadNotesInput, ctx: ToolContext) -> str:
    """Читает заметки из долговременной памяти. Вызывай в начале работы над задачей, где
    могут пригодиться ранее сохранённые факты о пользователе или проекте, и когда
    пользователь спрашивает «что ты помнишь обо мне/о проекте»."""
    notes = _load(ctx)
    if args.query:
        query = args.query.lower()
        notes = [n for n in notes if query in n["text"].lower()]
    if not notes:
        return "Заметок не найдено."
    return "\n".join(f"#{n['id']} ({n['created']}): {n['text']}" for n in notes)
