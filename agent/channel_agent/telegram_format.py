"""Оформление ответов для Telegram.

Claude пишет в Markdown, а Telegram понимает ограниченный HTML (<b>, <i>, <code>, <pre>, <a>).
Здесь Markdown превращается в такой HTML, а длинные ответы делятся на части: в одном
сообщении Telegram не больше 4096 символов.
"""

from __future__ import annotations

import html
import re

MESSAGE_LIMIT = 3800  # с запасом до 4096: после перевода в HTML текст становится длиннее

_FENCE = re.compile(r"```[^\n`]*\n(.*?)```", re.S)
_TABLE_LINE = re.compile(r"^\s*\|.*\|\s*$")
_INLINE_CODE = re.compile(r"`([^`\n]+)`")
_BOLD = re.compile(r"\*\*(.+?)\*\*|__(.+?)__")
_ITALIC = re.compile(r"(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])")
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$", re.M)
_LINK = re.compile(r"\[([^\]\n]+)\]\((https?://[^)\s]+)\)")
_PLACEHOLDER = "\x00{}\x00"


def markdown_to_telegram_html(text: str) -> str:
    """Переводит Markdown ответа Claude в HTML, который понимает Telegram."""
    blocks: list[str] = []

    def stash(fragment: str) -> str:
        blocks.append(fragment)
        return _PLACEHOLDER.format(len(blocks) - 1)

    # 1. Блоки кода и таблицы — моноширинным шрифтом, без дальнейшей обработки.
    text = _FENCE.sub(lambda m: stash(f"<pre>{html.escape(m.group(1).rstrip(), quote=False)}</pre>"), text)
    lines, table, result = text.split("\n"), [], []
    for line in [*lines, ""]:
        if _TABLE_LINE.match(line):
            table.append(line.strip())
            continue
        if table:
            result.append(stash(f"<pre>{html.escape(chr(10).join(table), quote=False)}</pre>"))
            table = []
        result.append(line)
    text = "\n".join(result[:-1])

    # 2. Инлайн-код, затем экранирование остального текста.
    text = _INLINE_CODE.sub(lambda m: stash(f"<code>{html.escape(m.group(1), quote=False)}</code>"), text)
    text = html.escape(text, quote=False)

    # 3. Ссылки, заголовки, жирный и курсив.
    # Текст уже экранирован, поэтому в адресе осталось заменить только кавычки.
    text = _LINK.sub(lambda m: f'<a href="{m.group(2).replace(chr(34), "%22")}">{m.group(1)}</a>', text)
    text = _HEADING.sub(r"<b>\1</b>", text)
    text = _BOLD.sub(lambda m: f"<b>{m.group(1) or m.group(2)}</b>", text)
    text = _ITALIC.sub(r"<i>\1</i>", text)

    # 4. Возвращаем спрятанные блоки на место.
    return re.sub("\x00(\\d+)\x00", lambda m: blocks[int(m.group(1))], text)


def split_message(text: str, limit: int = MESSAGE_LIMIT) -> list[str]:
    """Делит длинный текст на части по абзацам и строкам, не разрывая блоки кода."""
    text = text.strip()
    if len(text) <= limit:
        return [text] if text else []
    parts: list[str] = []
    current = ""
    in_code = False
    for line in text.split("\n"):
        while len(line) > limit:  # очень длинная строка — режем по символам
            if current:
                parts.append(current)
                current = ""
            parts.append(line[:limit])
            line = line[limit:]
        candidate = f"{current}\n{line}" if current else line
        if len(candidate) > limit and not in_code:
            parts.append(current)
            current = line
        elif len(candidate) > limit:  # внутри блока кода: закрываем и открываем заново
            parts.append(current + "\n```")
            current = "```\n" + line
        else:
            current = candidate
        if line.strip().startswith("```"):
            in_code = not in_code
    if current.strip():
        parts.append(current)
    return [part.strip() for part in parts if part.strip()]
