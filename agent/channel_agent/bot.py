"""Telegram-бот редакции: черновики на согласование, публикация по кнопке, обход по расписанию.

Запуск из папки agent/:
    python -m channel_agent

Как устроено:

- Агент готовит черновик (инструмент propose_post) — бот присылает владельцу
  карточку с кнопками «Опубликовать», «Править», «Отклонить».
- «Опубликовать» обрабатывает код этого файла, а не модель: в канал уходит
  ровно тот текст, что был в карточке. Нажатие принимается только от людей
  из TELEGRAM_ALLOWED_USERS — от остальных бот даже сообщения не читает.
- «Править» — следующее сообщение владельца уходит агенту как просьба
  исправить черновик; исправленная версия приходит новой карточкой, а
  старая теряет кнопки.
- Плановый обход раз в AGENT_SCAN_INTERVAL_HOURS, только в AGENT_ACTIVE_HOURS:
  черновик не должен будить владельца ночью. Если повода нет, бот молчит.

Сетевой слой (long polling, прокси для Telegram, мост между потоком агента и
циклом событий) перенесён из MetodiLabs (agent/telegram_bot.py).
"""

from __future__ import annotations

import asyncio
import html
import logging
import os
from collections.abc import Callable
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import anthropic
from telegram import (
    BotCommand,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    LinkPreviewOptions,
    Update,
)
from telegram.constants import ChatAction, ParseMode
from telegram.error import BadRequest, Conflict, Forbidden, InvalidToken, NetworkError, TelegramError
from telegram.ext import (
    Application,
    ApplicationBuilder,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)
from telegram.request import HTTPXRequest

from .config import Settings
from .core import Agent, AgentEvents
from .drafts import Draft, DraftError, lint_post, now_utc
from .runtime import create_agent, describe_api_error, local_now, run_scan, usage_report
from .services import Services
from .telegram_format import markdown_to_telegram_html, split_message

log = logging.getLogger("po_puti.bot")

CHAT_PROMPT = """
## Интерфейс: личный чат с владельцем

Ты в личном чате бота с владельцем канала. Черновики, которые ты отправляешь через propose_post,
он видит отдельной карточкой с кнопками — в ответе не повторяй текст черновика, достаточно одной строки.
"""

HELP_TEXT = (
    "Я готовлю посты для канала «По пути» и присылаю их сюда на согласование. "
    "Публикую только после вашей кнопки «Опубликовать».\n\n"
    "Сам проверяю обновления и поездки по расписанию. Можно и попросить: «сделай пост про жалобы».\n\n"
    "/scan — обход прямо сейчас\n"
    "/drafts — черновики, которые ждут решения\n"
    "/status — что выкачено, когда был обход, есть ли права в канале\n"
    "/new — начать разговор заново (черновики и заметки останутся)\n"
    "/usage — расход токенов"
)

STATUS_LINES_SHOWN = 12
TYPING_INTERVAL_SECONDS = 4
CARD_LIMIT = 4000
EDIT_PROMPT = (
    "Владелец просит поправить черновик #{id} ({label}).\n"
    "Текст черновика:\n«««\n{text}\n»»»\n"
    "Просьба владельца: {request}\n"
    'Отправь исправленную версию через propose_post с replaces="{id}". '
    "Если владелец прислал готовый текст целиком — используй его дословно."
)


async def send_long_message(bot: Any, chat_id: int, text: str) -> None:
    """Ответ частями с оформлением; если Telegram не принял разметку — обычным текстом."""
    for part in split_message(text):
        try:
            await bot.send_message(chat_id, markdown_to_telegram_html(part), parse_mode=ParseMode.HTML)
        except BadRequest:
            await bot.send_message(chat_id, part)


def _describe_call(name: str, tool_input: Any) -> str:
    if isinstance(tool_input, dict) and tool_input:
        value = " ".join(str(next(iter(tool_input.values()))).split())
        return f"{name}: {value[:47] + '…' if len(value) > 48 else value}"
    return name


def draft_keyboard(draft_id: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("✅ Опубликовать", callback_data=f"draft:{draft_id}:publish"),
                InlineKeyboardButton("✏️ Править", callback_data=f"draft:{draft_id}:edit"),
            ],
            [InlineKeyboardButton("❌ Отклонить", callback_data=f"draft:{draft_id}:reject")],
        ]
    )


def card_header(draft: Draft, settings: Settings) -> str:
    lines = [f"<b>Черновик #{draft.id} · {html.escape(draft.label)}</b>"]
    if draft.replaces:
        lines.append(f"Исправленная версия #{html.escape(draft.replaces)}")
    if draft.reason:
        lines.append(f"<i>Почему сейчас:</i> {html.escape(draft.reason)}")
    warnings = lint_post(draft.text)
    if warnings:
        lines.append("⚠️ <b>Перечитать:</b> " + html.escape("; ".join(warnings)))
    if draft.with_button and settings.post_button_url:
        lines.append(f"Под постом кнопка «{html.escape(settings.post_button_text)}»")
    else:
        lines.append("Без кнопки под постом")
    return "\n".join(lines)


class ChatEvents(AgentEvents):
    """События агента → сообщение «Работаю…» в чате. Вызываются из рабочего потока агента."""

    def __init__(self, chat: ChatSession) -> None:
        self.chat = chat

    def on_tool_call(self, name: str, tool_input: Any) -> None:
        self.chat.add_status(f"🔧 {_describe_call(name, tool_input)}")

    def on_notice(self, message: str) -> None:
        self.chat.send_text(f"⚠️ {message}")


class ChatSession:
    """Разговор владельца с агентом. Перенесено из MetodiLabs в упрощённом виде: без файлов."""

    def __init__(
        self,
        chat_id: int,
        bot: Any,
        loop: asyncio.AbstractEventLoop,
        make_agent: Callable[[AgentEvents], Agent],
        session_file: Path,
    ) -> None:
        self.chat_id = chat_id
        self.bot = bot
        self.loop = loop
        self.session_file = session_file
        self.lock = asyncio.Lock()
        self.agent = make_agent(ChatEvents(self))
        self._status_lines: list[str] = []
        self._status_message_id: int | None = None
        if session_file.is_file():
            try:
                self.agent.load_session(session_file)
            except (OSError, ValueError):
                log.warning("Не удалось загрузить историю чата %s — начинаю заново", chat_id)

    def start_turn(self) -> None:
        self._status_lines = []
        self._status_message_id = None

    def save(self) -> None:
        self.agent.save_session(self.session_file)

    def _run(self, coroutine: Any, timeout: float = 60) -> Any:
        return asyncio.run_coroutine_threadsafe(coroutine, self.loop).result(timeout)

    def send_text(self, text: str) -> None:
        self._run(send_long_message(self.bot, self.chat_id, text))

    def add_status(self, line: str) -> None:
        self._status_lines.append(line)
        text = "⏳ Работаю…\n" + "\n".join(self._status_lines[-STATUS_LINES_SHOWN:])
        try:
            if self._status_message_id is None:
                message = self._run(self.bot.send_message(self.chat_id, text))
                self._status_message_id = message.message_id
            else:
                self._run(self.bot.edit_message_text(text, chat_id=self.chat_id, message_id=self._status_message_id))
        except (TelegramError, TimeoutError) as exc:
            log.warning("Не удалось обновить статус: %s", exc)


class ChannelBot:
    # Как часто проверять, не пора ли на обход. Меньше — точнее расписание, но расписание
    # и так в часах, а лишние пробуждения ничего не стоят.
    scan_check_seconds: float = 300.0
    # Задержка перед первой проверкой после запуска: выкатка перезапускает бота, и обход
    # в ту же секунду увидел бы сервер ещё на полпути.
    startup_delay_seconds: float = 120.0

    def __init__(
        self,
        settings: Settings,
        services: Services,
        *,
        make_client: Callable[[], Any] | None = None,
    ) -> None:
        self.settings = settings
        self.services = services
        self.allowed_users = settings.telegram_allowed_users
        self.make_client = make_client  # для тестов: подменный клиент Claude API
        self.sessions: dict[int, ChatSession] = {}
        self.awaiting_edit: dict[int, str] = {}
        self.app: Application | None = None
        self.loop: asyncio.AbstractEventLoop | None = None
        self._decision_lock = asyncio.Lock()
        self._scan_lock = asyncio.Lock()
        self._scan_task: asyncio.Task | None = None
        services.on_draft = self._on_draft_from_agent_thread

    # ------------------------------------------------------------------ сборка

    def build_application(
        self, token: str, *, base_url: str | None = None, base_file_url: str | None = None
    ) -> Application:
        builder = (
            ApplicationBuilder()
            .token(token)
            .concurrent_updates(True)
            .post_init(self._post_init)
            .post_stop(self._post_stop)
        )
        proxy = self.settings.telegram_proxy
        if proxy == "none":
            builder = builder.request(HTTPXRequest(httpx_kwargs={"trust_env": False}))
            builder = builder.get_updates_request(
                HTTPXRequest(connection_pool_size=1, httpx_kwargs={"trust_env": False})
            )
        elif proxy:
            builder = builder.proxy(proxy).get_updates_proxy(proxy)
        if base_url:
            builder = builder.base_url(base_url)
        if base_file_url:
            builder = builder.base_file_url(base_file_url)
        app = builder.build()
        app.add_handler(CommandHandler(["start", "help"], self.on_help))
        app.add_handler(CommandHandler("scan", self.on_scan))
        app.add_handler(CommandHandler("drafts", self.on_drafts))
        app.add_handler(CommandHandler("status", self.on_status))
        app.add_handler(CommandHandler("new", self.on_new))
        app.add_handler(CommandHandler("usage", self.on_usage))
        app.add_handler(CallbackQueryHandler(self.on_callback, pattern=r"^draft:"))
        app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, self.on_text))
        app.add_error_handler(self.on_error)
        self.app = app
        return app

    async def _post_init(self, app: Application) -> None:
        self.loop = asyncio.get_running_loop()
        try:
            await app.bot.set_my_commands(
                [
                    BotCommand("scan", "Обход прямо сейчас"),
                    BotCommand("drafts", "Черновики на согласовании"),
                    BotCommand("status", "Состояние агента"),
                    BotCommand("new", "Начать разговор заново"),
                    BotCommand("help", "Справка"),
                ]
            )
        except TelegramError as exc:
            log.warning("Не удалось установить меню команд: %s", exc)
        self._scan_task = asyncio.create_task(self._scan_loop())

    async def _post_stop(self, app: Application) -> None:
        if self._scan_task is not None:
            self._scan_task.cancel()

    # ------------------------------------------------------------------ доступ

    def _allowed(self, update: Update) -> bool:
        user = update.effective_user
        return user is not None and user.id in self.allowed_users

    async def _deny(self, update: Update) -> None:
        user = update.effective_user
        log.warning("Отказано в доступе пользователю %s", user.id if user else "?")
        if update.effective_message:
            await update.effective_message.reply_text(
                f"Это бот редакции канала «По пути». Ваш Telegram ID: {user.id if user else '?'}\n\n"
                "Если это ваш бот, впишите этот номер в TELEGRAM_ALLOWED_USERS в agent/.env и перезапустите его."
            )

    # ------------------------------------------------------------------ карточки

    def _on_draft_from_agent_thread(self, draft: Draft) -> None:
        """Инструмент propose_post вызывает это из потока агента: показываем карточку и ждём отправки."""
        if self.loop is None or self.app is None:
            log.error("Черновик #%s создан, но бот ещё не запущен — карточка не отправлена", draft.id)
            return
        asyncio.run_coroutine_threadsafe(self.send_card(draft), self.loop).result(60)

    async def send_card(self, draft: Draft) -> None:
        """Карточка черновика всем, кто может согласовывать. Исправленная версия снимает кнопки со старой."""
        bot = self.app.bot
        header = card_header(draft, self.settings)
        body = html.escape(draft.text)
        for chat_id in sorted(self.allowed_users):
            try:
                if len(header) + len(body) + 2 <= CARD_LIMIT:
                    message = await bot.send_message(
                        chat_id,
                        f"{header}\n\n{body}",
                        parse_mode=ParseMode.HTML,
                        reply_markup=draft_keyboard(draft.id),
                        link_preview_options=LinkPreviewOptions(is_disabled=True),
                    )
                else:
                    # Длинный пост: шапка отдельно, а текст — ровно как уйдёт в канал, с кнопками.
                    await bot.send_message(chat_id, header, parse_mode=ParseMode.HTML)
                    message = await bot.send_message(
                        chat_id,
                        draft.text,
                        reply_markup=draft_keyboard(draft.id),
                        link_preview_options=LinkPreviewOptions(is_disabled=True),
                    )
            except TelegramError as exc:
                log.error("Не удалось отправить карточку #%s в чат %s: %s", draft.id, chat_id, exc)
                continue
            self.services.store.add_card(draft.id, chat_id, message.message_id)
        if draft.replaces:
            replaced = self.services.store.get(draft.replaces)
            if replaced is not None:
                await self._close_cards(replaced, f"↪️ Заменён черновиком #{draft.id}")

    async def _close_cards(self, draft: Draft, note: str) -> None:
        """Снять кнопки со всех карточек черновика и ответить на них решением."""
        for chat_id, message_id in draft.cards:
            try:
                await self.app.bot.edit_message_reply_markup(chat_id=chat_id, message_id=message_id, reply_markup=None)
            except TelegramError as exc:
                log.warning("Не удалось снять кнопки с карточки #%s: %s", draft.id, exc)
            try:
                await self.app.bot.send_message(chat_id, note, reply_to_message_id=message_id)
            except TelegramError as exc:
                log.warning("Не удалось отметить решение по #%s: %s", draft.id, exc)

    # ------------------------------------------------------------------ решения

    async def on_callback(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        query = update.callback_query
        if not self._allowed(update):
            await query.answer("Нет доступа", show_alert=True)
            return
        try:
            _, draft_id, action = query.data.split(":", 2)
        except ValueError:
            await query.answer()
            return
        if action == "publish":
            await self._publish(query, draft_id)
        elif action == "reject":
            await self._reject(query, draft_id)
        elif action == "edit":
            await self._ask_edit(query, draft_id)
        else:
            await query.answer()

    async def _publish(self, query: Any, draft_id: str) -> None:
        # Под замком: двойное нажатие не должно дать два поста.
        async with self._decision_lock:
            draft = self.services.store.get(draft_id)
            if draft is None or draft.status != "pending":
                await query.answer("Этот черновик уже не ждёт решения.", show_alert=True)
                return
            if not self.settings.channel_id:
                await query.answer("Не задан TELEGRAM_CHANNEL в agent/.env — публиковать некуда.", show_alert=True)
                return
            markup = None
            if draft.with_button and self.settings.post_button_url:
                markup = InlineKeyboardMarkup(
                    [[InlineKeyboardButton(self.settings.post_button_text, url=self.settings.post_button_url)]]
                )
            try:
                # Без parse_mode: в канал уходит ровно тот текст, что был в карточке.
                posted = await self.app.bot.send_message(
                    self.settings.channel_id,
                    draft.text,
                    reply_markup=markup,
                    link_preview_options=LinkPreviewOptions(is_disabled=True),
                )
            except TelegramError as exc:
                await query.answer()
                await self.app.bot.send_message(
                    query.message.chat.id,
                    f"Не удалось опубликовать #{draft.id}: {exc}\n"
                    "Проверьте, что бот — администратор канала с правом публиковать сообщения. "
                    "Черновик ждёт дальше, кнопка снова сработает.",
                )
                return
            draft = self.services.store.decide(draft.id, "published", channel_message_id=posted.message_id)
        await query.answer("Опубликовано")
        log.info("Черновик #%s опубликован в %s", draft.id, self.settings.channel_id)
        await self._close_cards(draft, f"✅ Опубликовано в канале, {local_now(self.settings):%d.%m %H:%M}")

    async def _reject(self, query: Any, draft_id: str) -> None:
        async with self._decision_lock:
            try:
                draft = self.services.store.decide(draft_id, "rejected")
            except DraftError:
                await query.answer("Этот черновик уже не ждёт решения.", show_alert=True)
                return
        await query.answer("Отклонено")
        self.awaiting_edit.pop(query.message.chat.id, None)
        await self._close_cards(draft, "❌ Отклонено. Если напишете почему — учту в следующих черновиках.")

    async def _ask_edit(self, query: Any, draft_id: str) -> None:
        draft = self.services.store.get(draft_id)
        if draft is None or draft.status != "pending":
            await query.answer("Этот черновик уже не ждёт решения.", show_alert=True)
            return
        await query.answer()
        self.awaiting_edit[query.message.chat.id] = draft_id
        await self.app.bot.send_message(
            query.message.chat.id,
            f"Что поправить в #{draft_id}? Напишите, что изменить, или пришлите готовый текст целиком.",
        )

    # ------------------------------------------------------------------ чат с агентом

    def _session(self, chat_id: int, bot: Any) -> ChatSession:
        session = self.sessions.get(chat_id)
        if session is None:
            session = ChatSession(
                chat_id,
                bot,
                asyncio.get_running_loop(),
                self._make_agent,
                self.settings.data_dir / "telegram" / f"{chat_id}.json",
            )
            self.sessions[chat_id] = session
        return session

    def _make_agent(self, events: AgentEvents) -> Agent:
        client = self.make_client() if self.make_client else None
        return create_agent(self.settings, self.services, events, extra_system_prompt=CHAT_PROMPT, client=client)

    async def on_text(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not self._allowed(update):
            return await self._deny(update)
        chat_id = update.effective_chat.id
        text = update.effective_message.text
        draft_id = self.awaiting_edit.pop(chat_id, None)
        if draft_id is not None:
            draft = self.services.store.get(draft_id)
            if draft is not None and draft.status == "pending":
                text = EDIT_PROMPT.format(id=draft.id, label=draft.label, text=draft.text, request=text)
        await self._run_turn(update, context, text)

    async def _run_turn(self, update: Update, context: ContextTypes.DEFAULT_TYPE, text: str) -> None:
        session = self._session(update.effective_chat.id, context.bot)
        log.info("Сообщение в чате %s (%d симв.)", session.chat_id, len(text))
        if session.lock.locked():
            await update.effective_message.reply_text("Ещё работаю над предыдущим сообщением — отвечу по порядку.")
        async with session.lock:
            session.start_turn()
            # Цикл событий запоминается здесь, а не в post_init: агент присылает черновики
            # из своего потока, и мост нужен ровно к тому циклу, в котором крутится бот.
            self.loop = asyncio.get_running_loop()
            typing = asyncio.create_task(self._keep_typing(context.bot, session.chat_id))
            try:
                reply = await asyncio.to_thread(session.agent.ask, text)
            except anthropic.APIError as exc:
                reply = describe_api_error(exc, self.settings)
            except Exception as exc:
                log.exception("Ошибка агента")
                reply = f"Непредвиденная ошибка: {type(exc).__name__}: {exc}"
            finally:
                typing.cancel()
            session.save()
            if reply.strip():
                await send_long_message(context.bot, session.chat_id, reply)

    @staticmethod
    async def _keep_typing(bot: Any, chat_id: int) -> None:
        while True:
            try:
                await bot.send_chat_action(chat_id, ChatAction.TYPING)
            except TelegramError:
                pass
            await asyncio.sleep(TYPING_INTERVAL_SECONDS)

    # ------------------------------------------------------------------ команды

    async def on_help(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not self._allowed(update):
            return await self._deny(update)
        await update.effective_message.reply_text(HELP_TEXT)

    async def on_new(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not self._allowed(update):
            return await self._deny(update)
        session = self._session(update.effective_chat.id, context.bot)
        async with session.lock:
            session.agent.reset()
            session.session_file.unlink(missing_ok=True)
        self.awaiting_edit.pop(update.effective_chat.id, None)
        await update.effective_message.reply_text("Начинаю разговор заново. Черновики и заметки на месте.")

    async def on_usage(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not self._allowed(update):
            return await self._deny(update)
        session = self._session(update.effective_chat.id, context.bot)
        await update.effective_message.reply_text("С момента запуска бота:\n" + "\n".join(usage_report(session.agent)))

    async def on_drafts(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Черновики, которые ждут решения, — новыми карточками: старые могли утонуть в чате."""
        if not self._allowed(update):
            return await self._deny(update)
        pending = self.services.store.pending()
        if not pending:
            await update.effective_message.reply_text("Ничего не ждёт решения.")
            return
        for draft in pending:
            await self.send_card(draft)

    async def on_status(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not self._allowed(update):
            return await self._deny(update)
        state = self.services.store.state()
        lines = []
        deployed = state.get("deployed_commit")
        lines.append(f"Выкачено: коммит {deployed[:7]}" if deployed else "Что выкачено — пока неизвестно")
        last = state.get("last_scan_at")
        if last:
            when = datetime.fromisoformat(last).astimezone(local_now(self.settings).tzinfo)
            lines.append(f"Последний обход: {when:%d.%m %H:%M} — {state.get('last_scan_result', '')[:300]}")
        else:
            lines.append("Обходов ещё не было")
        start, end = self.settings.active_hours
        lines.append(
            f"Обход каждые {self.settings.scan_interval_hours:g} ч, с {start}:00 до {end}:00 ({self.settings.timezone})"
        )
        lines.append(f"Ждут решения: {len(self.services.store.pending())}")
        lines.append(f"Опубликовано за 7 дней: {len(self.services.store.published_since(7))}")
        lines.append(await self._channel_rights(context.bot))
        await update.effective_message.reply_text("\n".join(lines))

    async def _channel_rights(self, bot: Any) -> str:
        channel = self.settings.channel_id
        if not channel:
            return "Канал: не задан TELEGRAM_CHANNEL"
        try:
            me = await bot.get_me()
            member = await bot.get_chat_member(channel, me.id)
        except (Forbidden, BadRequest) as exc:
            return f"Канал {channel}: бот его не видит ({exc}). Добавьте бота администратором."
        except TelegramError as exc:
            return f"Канал {channel}: не удалось проверить ({exc})"
        if member.status == "creator" or (
            member.status == "administrator" and getattr(member, "can_post_messages", False)
        ):
            return f"Канал {channel}: права на публикацию есть"
        return f"Канал {channel}: у бота нет права публиковать — дайте его в настройках администраторов"

    async def on_scan(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not self._allowed(update):
            return await self._deny(update)
        if self._scan_lock.locked():
            await update.effective_message.reply_text("Обход уже идёт.")
            return
        await update.effective_message.reply_text("Начинаю обход…")
        result = await self._run_scan()
        await update.effective_message.reply_text(result or "Обход завершён.")

    # ------------------------------------------------------------------ обход по расписанию

    def _scan_due(self) -> bool:
        last = self.services.store.state().get("last_scan_at")
        if not last:
            return True
        elapsed = now_utc() - datetime.fromisoformat(last)
        return elapsed >= timedelta(hours=self.settings.scan_interval_hours)

    def _in_active_hours(self) -> bool:
        start, end = self.settings.active_hours
        return start <= local_now(self.settings).hour < end

    async def _run_scan(self) -> str:
        async with self._scan_lock:
            self.loop = asyncio.get_running_loop()
            client = self.make_client() if self.make_client else None
            return await asyncio.to_thread(run_scan, self.settings, self.services, client=client)

    async def _scan_loop(self) -> None:
        await asyncio.sleep(self.startup_delay_seconds)
        while True:
            try:
                if self._in_active_hours() and self._scan_due() and not self._scan_lock.locked():
                    await self._run_scan()
            except asyncio.CancelledError:
                raise
            except Exception:
                # Сбой одного обхода не должен останавливать расписание.
                log.exception("Плановый обход упал")
            await asyncio.sleep(self.scan_check_seconds)

    # ------------------------------------------------------------------ ошибки

    async def on_error(self, update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
        error = context.error
        if isinstance(error, Conflict):
            log.error("Этот бот уже запущен в другом месте — Telegram отдаёт сообщения только одной копии.")
        elif isinstance(error, NetworkError):
            log.warning("Временный сбой связи с Telegram, повторяю автоматически: %s", error)
        else:
            log.error("Ошибка при обработке сообщения", exc_info=error)


def run_bot(settings: Settings, services: Services) -> int:
    """python -m channel_agent"""
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        print("Не задан TELEGRAM_BOT_TOKEN в agent/.env. Как получить — agent/README.md, шаг 1.")
        return 2
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    # В адресе Telegram API стоит токен бота — журналы HTTP-библиотек его бы напечатали.
    for noisy in ("httpx", "httpx2", "httpcore", "httpcore2"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    if not settings.telegram_allowed_users:
        log.warning("TELEGRAM_ALLOWED_USERS не задан: бот никому не ответит и ничего не опубликует.")
    if not settings.channel_id:
        log.warning("TELEGRAM_CHANNEL не задан: черновики будут, публиковать их будет некуда.")
    bot = ChannelBot(settings, services)
    log.info("Бот редакции запущен. Остановить — Ctrl+C.")
    try:
        bot.build_application(token).run_polling()
    except InvalidToken:
        log.error("Telegram не принял TELEGRAM_BOT_TOKEN. Проверьте токен в agent/.env.")
        return 1
    return 0
