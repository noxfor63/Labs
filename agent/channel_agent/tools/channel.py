"""Инструменты агента канала: что нового, какие поездки, что уже было, черновик.

Набор нарочно без инструмента «опубликовать». Модель может только предложить
черновик — дальше решает владелец кнопкой в Telegram, и публикует код бота,
а не модель (bot.py). Так согласование нельзя обойти ни ошибкой модели, ни
хитро составленным текстом в коммите или документе, который она прочитала.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field

from ..drafts import DRAFT_KINDS, DraftError, lint_post
from .base import ToolContext, ToolError, tool

WEEKDAYS_SHORT = ("пн", "вт", "ср", "чт", "пт", "сб", "вс")
MESSAGE_BODY_LIMIT = 1500
MAX_COMMITS_SHOWN = 30

# Что агенту можно читать в репозитории: правила и шаблоны канала, описание
# приложения. Код — нельзя: о поведении приложения он узнаёт из системного
# промпта, где факты сверены, а не из догадок по исходникам.
READABLE_PREFIXES = ("marketing/telegram/", "docs/")
READABLE_FILES = ("design/store-copy.md", "design/moderation.md")


def _services(ctx: ToolContext):
    if ctx.services is None:
        raise ToolError("Службы канала не подключены.")
    return ctx.services


def _short(sha: str) -> str:
    return sha[:7]


def _resolve_commits(ctx: ToolContext, given: list[str]) -> list[str]:
    """Короткие sha из check_updates → полные. Незнакомые — ошибка с подсказкой."""
    known: list[str] = _services(ctx).store.state().get("last_check_commits", [])
    resolved = []
    for value in given:
        value = value.strip().lower()
        matches = [sha for sha in known if len(value) >= 7 and sha.startswith(value)]
        if len(matches) != 1:
            shown = ", ".join(_short(sha) for sha in known) or "список пуст — сначала вызови check_updates"
            raise ToolError(f"Коммит {value!r} не из последнего check_updates. Известные: {shown}.")
        resolved.append(matches[0])
    return resolved


# ------------------------------------------------------------------ обновления


class NoInput(BaseModel):
    pass


@tool(NoInput)
def check_updates(args: NoInput, ctx: ToolContext) -> str:
    """Что нового выкачено в приложение «По пути» и ещё не разобрано: версия на сервере и
    коммиты, о которых пока не было ни поста, ни решения «без поста». Вызывай в начале
    каждого обхода. Сообщения коммитов подробные и на русском — по ним понятно, что
    изменилось для людей, а что внутреннее (тесты, документация, маркетинг, разбор
    конкурентов). О каждом показанном коммите нужно решить: войдёт в черновик
    (propose_post, параметр commits) или закрыть без поста (skip_commits)."""
    s = _services(ctx)
    if s.github is None:
        raise ToolError("GitHub не подключён.")

    lines = []
    deployed = None
    if s.pp_api is not None:
        status = s.pp_api.status()
        deployed = status.get("commit")
        lines.append(
            f"На сервере: версия {status.get('version', '?')}, "
            f"коммит {_short(deployed) if deployed else 'неизвестен'}; "
            f"живых поездок: {status.get('activeTrips', '?')}."
        )
    if deployed:
        head = deployed
        s.store.update_state(deployed_commit=deployed)
    else:
        head = s.github.head(s.settings.github_branch)
        lines.append(
            "ВНИМАНИЕ: сервер не сообщил, какой коммит выкачен, поэтому показана ветка репозитория. "
            "Часть изменений может быть ещё не выкачена — в черновике об обновлении напиши в reason, "
            "что владельцу нужно проверить выкатку."
        )

    state = s.store.state()
    baseline = state.get("baseline_commit")
    if baseline:
        commits = s.github.between(baseline, head)
    elif s.settings.updates_since:
        commits = s.github.since(head, s.settings.updates_since)
    else:
        # Первый запуск: прошлое не пересказываем, отсчёт — с того, что выкачено сейчас.
        s.store.update_state(baseline_commit=head, last_check_commits=[])
        lines.append(f"Первый запуск: отсчёт обновлений начат с коммита {_short(head)}. Новых изменений нет.")
        return "\n".join(lines)

    handled = s.store.handled()
    fresh = [c for c in commits if c.sha not in handled]
    if commits and not fresh:
        # Всё до head разобрано — сдвигаем отсчёт, чтобы список не рос бесконечно.
        s.store.rebaseline(head)
    s.store.update_state(last_check_commits=[c.sha for c in fresh])

    if not fresh:
        lines.append("Новых неразобранных изменений нет.")
        return "\n".join(lines)

    shown = fresh[:MAX_COMMITS_SHOWN]
    lines.append(f"Неразобранные коммиты ({len(fresh)}), старые первыми:")
    for commit in shown:
        body = commit.message.strip()
        if len(body) > MESSAGE_BODY_LIMIT:
            body = body[:MESSAGE_BODY_LIMIT] + " […]"
        lines.append(f"\n— {_short(commit.sha)} · {commit.date[:10]}\n{body}")
    if len(fresh) > len(shown):
        lines.append(f"\n…и ещё {len(fresh) - len(shown)}. Разбери показанные — остальные появятся в следующий раз.")
    return "\n".join(lines)


class CommitFilesInput(BaseModel):
    commit: str = Field(description="Короткий sha из check_updates, например 'b3a1d1c'.")


@tool(CommitFilesInput)
def commit_files(args: CommitFilesInput, ctx: ToolContext) -> str:
    """Какие файлы менял коммит. Вызывай, только если по сообщению непонятно, коснулось ли
    изменение людей: apps/web — интерфейс, apps/api — сервер, packages/shared — общие
    правила; marketing, docs, design, competitor-complaint, тесты — внутреннее."""
    s = _services(ctx)
    (sha,) = _resolve_commits(ctx, [args.commit])
    files = s.github.files(sha)
    return "\n".join(files) if files else "Коммит не менял файлов."


class SkipCommitsInput(BaseModel):
    commits: list[str] = Field(description="Короткие sha из check_updates.")
    reason: str = Field(description="Почему без поста, одной фразой: например, «только документация».")


@tool(SkipCommitsInput)
def skip_commits(args: SkipCommitsInput, ctx: ToolContext) -> str:
    """Закрыть коммиты без поста: изменение внутреннее (тесты, документация, маркетинг,
    оформление кода) или слишком мелкое для канала. После этого check_updates их больше
    не покажет. Не закрывай так изменения, заметные людям, — их место в черновике."""
    s = _services(ctx)
    shas = _resolve_commits(ctx, args.commits)
    s.store.mark_handled(shas)
    skipped = s.store.state().get("skipped", [])
    skipped = [*skipped, {"commits": [_short(sha) for sha in shas], "reason": args.reason.strip()}][-50:]
    s.store.update_state(skipped=skipped)
    return f"Закрыто без поста: {', '.join(_short(sha) for sha in shas)}."


# ------------------------------------------------------------------ поездки


class TripsInput(BaseModel):
    days: int = Field(
        default=4, ge=1, le=14, description="На сколько дней вперёд, от 1 до 14. Для дайджеста на выходные — 4."
    )


def _format_trip(item: dict, tz: ZoneInfo) -> str:
    depart = datetime.fromisoformat(item["departAt"].replace("Z", "+00:00")).astimezone(tz)
    who = "водитель" if item["role"] == "DRIVER" else "ищет водителя"
    seats = (
        f"свободно {item['seatsLeft']} из {item['seatsTotal']}"
        if item["role"] == "DRIVER"
        else f"едут {item['seatsTotal']}"
    )
    return (
        f"{item['fromCity']} → {item['toCity']}, {WEEKDAYS_SHORT[depart.weekday()]} "
        f"{depart:%d.%m}, {depart:%H:%M} — {item['priceRub']} ₽, {seats} ({who})"
    )


@tool(TripsInput)
def upcoming_trips(args: TripsInput, ctx: ToolContext) -> str:
    """Живые поездки на ближайшие дни — для дайджеста «кто едет на выходных» и для решения,
    нужен ли призыв к водителям. Данные обезличены: маршрут, время, цена, места и роль,
    без имён и телефонов. Время — местное (Оренбург)."""
    s = _services(ctx)
    if s.pp_api is None:
        raise ToolError("API «По пути» не подключён (PP_API_URL и PP_API_TOKEN в agent/.env) — поездок не видно.")
    data = s.pp_api.trips(args.days)
    tz = ZoneInfo(s.settings.timezone)
    items = data.get("items", [])
    drivers = [i for i in items if i["role"] == "DRIVER" and i["seatsLeft"] > 0]
    passengers = [i for i in items if i["role"] == "PASSENGER"]
    lines = [
        f"Ближайшие {args.days} дн.: водителей со свободными местами — {len(drivers)}, "
        f"пассажиров ищут водителя — {len(passengers)}, всего живых объявлений в окне — {len(items)}.",
        "Правило канала: дайджест только при трёх и больше поездках водителей с местами; "
        "меньше — вместо дайджеста пост «нужны водители».",
    ]
    if drivers:
        lines.append("\nВодители с местами:")
        lines += [f"• {_format_trip(i, tz)}" for i in drivers]
    if passengers:
        lines.append("\nИщут водителя:")
        lines += [f"• {_format_trip(i, tz)}" for i in passengers]
    return "\n".join(lines)


# ------------------------------------------------------------------ канал


class HistoryInput(BaseModel):
    days: int = Field(default=14, ge=1, le=90, description="За сколько дней показать историю.")


@tool(HistoryInput)
def channel_history(args: HistoryInput, ctx: ToolContext) -> str:
    """Что уже было в канале и что ждёт решения: опубликованные посты, черновики на
    согласовании и недавно отклонённые. Вызывай перед каждым черновиком — чтобы не
    повторяться, не превысить ритм (норма — один пост в неделю, потолок — два) и не
    предлагать снова то, от чего владелец отказался."""
    s = _services(ctx)
    published = s.store.published_since(args.days)
    week = s.store.published_since(7)
    drafts = s.store.all()
    pending = [d for d in drafts if d.status == "pending"]
    rejected = [d for d in drafts if d.status == "rejected"][-5:]

    def brief(text: str) -> str:
        one_line = " ".join(text.split())
        return one_line[:160] + ("…" if len(one_line) > 160 else "")

    lines = [f"Опубликовано за 7 дней: {len(week)} (норма — 1, потолок — 2)."]
    lines.append(f"\nОпубликовано за {args.days} дн.: {len(published)}")
    lines += [f"• {d.decided_at[:10]} · {d.label}: {brief(d.text)}" for d in published]
    lines.append(f"\nЖдут решения владельца: {len(pending)} (не больше {s.settings.max_pending_drafts})")
    lines += [f"• #{d.id} · {d.label}: {brief(d.text)}" for d in pending]
    if rejected:
        lines.append("\nНедавно отклонены — не предлагай то же снова:")
        lines += [f"• #{d.id} · {d.label}: {brief(d.text)}" for d in rejected]
    return "\n".join(lines)


PostKind = Literal["update", "digest", "drivers", "howto", "safety", "other"]
assert set(PostKind.__args__) == set(DRAFT_KINDS)  # список видов один — в drafts.py


class ProposeInput(BaseModel):
    kind: PostKind = Field(
        description="Вид поста: update — обновление, digest — дайджест поездок, drivers — нужны водители, "
        "howto — как пользоваться, safety — безопасность, other — другое."
    )
    text: str = Field(
        description="Текст поста ровно в том виде, в каком он уйдёт в канал. Обычный текст, без разметки."
    )
    reason: str = Field(description="Для владельца, одной-двумя фразами: почему этот пост и почему сейчас.")
    commits: list[str] = Field(
        default_factory=list,
        description="Для поста об обновлении — короткие sha всех коммитов, которые он покрывает, из check_updates.",
    )
    with_button: bool = Field(default=True, description="Кнопка «Открыть «По пути»» под постом.")
    replaces: str | None = Field(
        default=None, description="Номер черновика без «#», если это исправленная версия по просьбе владельца."
    )


@tool(ProposeInput)
def propose_post(args: ProposeInput, ctx: ToolContext) -> str:
    """Отправить черновик поста владельцу на согласование. Это единственный способ
    что-то опубликовать: владелец увидит карточку с кнопками «Опубликовать», «Править»,
    «Отклонить» и решит сам. Публикуешь не ты — никогда не пиши, что пост опубликован.
    Один обход — не больше одного черновика."""
    s = _services(ctx)
    commits = _resolve_commits(ctx, args.commits) if args.commits else []
    try:
        draft = s.store.create(
            kind=args.kind,
            text=args.text,
            reason=args.reason,
            commits=commits,
            with_button=args.with_button,
            max_pending=s.settings.max_pending_drafts,
            replaces=args.replaces.strip().lstrip("#") if args.replaces else None,
        )
    except DraftError as exc:
        raise ToolError(str(exc)) from None
    s.on_draft(draft)
    warnings = lint_post(draft.text)
    note = f" Проверка нашла, что перечитать: {'; '.join(warnings)}." if warnings else ""
    return f"Черновик #{draft.id} отправлен владельцу на согласование.{note} Дальше решает он."


# ------------------------------------------------------------------ документы проекта


class DocInput(BaseModel):
    path: str = Field(
        description="Путь в репозитории, например marketing/telegram/06-post-templates.md или design/store-copy.md."
    )


@tool(DocInput)
def read_project_doc(args: DocInput, ctx: ToolContext) -> str:
    """Прочитать документ проекта: шаблоны и правила канала (marketing/telegram/*.md), описание
    карточки приложения (design/store-copy.md), разбор монетизации (docs/*.md). Нужен, когда
    пишешь пост по шаблону. Если документ противоречит фактам из системной инструкции —
    верь системной инструкции: часть документов писалась до последних обновлений."""
    s = _services(ctx)
    path = args.path.strip().lstrip("/")
    if ".." in path or not (path.startswith(READABLE_PREFIXES) or path in READABLE_FILES):
        raise ToolError(
            "Читать можно только marketing/telegram/*.md, docs/*.md, design/store-copy.md и design/moderation.md."
        )
    ref = s.store.state().get("deployed_commit") or s.settings.github_branch
    return s.github.read_file(path, ref)
