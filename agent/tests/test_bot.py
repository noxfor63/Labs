"""Сквозные тесты бота редакции: локальный сервер отвечает как Telegram Bot API, вместо Claude — подмена.

Главное, что проверяется: в канал уходит только то, что владелец одобрил кнопкой, и ровно в том виде,
в каком видел в карточке. Структура сервера-подмены перенесена из тестов MetodiLabs.
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from channel_agent.bot import ChannelBot

from .conftest import CHANNEL, OWNER, FakeClient, make_message, text, tool_use

TOKEN = "123:TEST"
STRANGER = 999


class FakeTelegram:
    def __init__(self) -> None:
        self.updates: list[dict] = []
        self.sent: list[tuple[str, dict]] = []
        self.fail_channel = False
        self._update_id = 0
        self._message_id = 1000
        self.cond = threading.Condition()

    def _push(self, update: dict) -> None:
        with self.cond:
            self._update_id += 1
            self.updates.append({"update_id": self._update_id, **update})

    @staticmethod
    def _user(user_id: int) -> dict:
        return {"id": user_id, "is_bot": False, "first_name": "Саша"}

    def message(self, user_id: int, value: str) -> None:
        msg = {
            "message_id": 1,
            "date": int(time.time()),
            "chat": {"id": user_id, "type": "private"},
            "from": self._user(user_id),
            "text": value,
        }
        if value.startswith("/"):
            msg["entities"] = [{"type": "bot_command", "offset": 0, "length": len(value.split()[0])}]
        self._push({"message": msg})

    def press(self, user_id: int, data: str, message_id: int) -> None:
        self._push(
            {
                "callback_query": {
                    "id": f"cb{self._update_id}",
                    "from": self._user(user_id),
                    "chat_instance": "ci",
                    "data": data,
                    "message": {
                        "message_id": message_id,
                        "date": int(time.time()),
                        "chat": {"id": user_id, "type": "private"},
                        "text": "карточка",
                    },
                }
            }
        )

    def wait_for(self, predicate, timeout: float = 10.0):
        deadline = time.time() + timeout
        with self.cond:
            while True:
                for method, params in self.sent:
                    if predicate(method, params):
                        return params
                remaining = deadline - time.time()
                if remaining <= 0:
                    raise AssertionError(f"Не дождались. Отправлено: {[(m, p.get('text')) for m, p in self.sent]}")
                self.cond.wait(remaining)

    def sent_to(self, chat: str) -> list[dict]:
        return [p for m, p in self.sent if m == "sendMessage" and str(p.get("chat_id")) == chat]

    def handle(self, method: str, params: dict):
        if method == "getMe":
            return {"id": 1, "is_bot": True, "first_name": "Editor", "username": "test_editor_bot"}
        if method == "getUpdates":
            offset = int(params.get("offset") or 0)
            with self.cond:
                ready = [u for u in self.updates if u["update_id"] >= offset]
            if not ready:
                time.sleep(0.05)
            return ready
        if method == "sendMessage" and params.get("chat_id") == CHANNEL and self.fail_channel:
            return {"__error__": "Forbidden: bot is not a member of the channel chat"}
        with self.cond:
            self.sent.append((method, params))
            self.cond.notify_all()
        if method in ("sendMessage", "editMessageText"):
            self._message_id += 1
            chat_id = params.get("chat_id") or OWNER
            return {
                "message_id": self._message_id,
                "date": int(time.time()),
                "chat": {"id": -100 if chat_id == CHANNEL else int(chat_id), "type": "private"},
                "text": params.get("text", ""),
            }
        return True


def make_handler(tg: FakeTelegram):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            method = self.path.rsplit("/", 1)[-1]
            body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            if self.headers.get("Content-Type", "").startswith("application/json"):
                params = json.loads(body or b"{}")
            else:
                params = dict(urllib.parse.parse_qsl(body.decode()))
            result = tg.handle(method, params)
            if isinstance(result, dict) and "__error__" in result:
                payload = {"ok": False, "error_code": 403, "description": result["__error__"]}
            else:
                payload = {"ok": True, "result": result}
            data = json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(200 if payload["ok"] else 403)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    return Handler


@pytest.fixture
def telegram():
    tg = FakeTelegram()
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(tg))
    tg.url = f"http://127.0.0.1:{server.server_address[1]}"
    threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
    yield tg
    server.shutdown()


@pytest.fixture
def run_bot(telegram, settings, services):
    stop = threading.Event()
    threads = []

    def start(responses: list, **settings_changes) -> ChannelBot:
        bot_settings = dataclasses.replace(settings, **settings_changes)
        services.settings = bot_settings
        clients = []

        def make_client():
            client = FakeClient(responses)
            clients.append(client)
            return client

        bot = ChannelBot(bot_settings, services, make_client=make_client)
        bot.startup_delay_seconds = 3600  # плановый обход в тестах не нужен — его зовут /scan
        bot.clients = clients
        app = bot.build_application(TOKEN, base_url=f"{telegram.url}/bot", base_file_url=f"{telegram.url}/file/bot")

        async def main():
            async with app:
                await app.start()
                await app.updater.start_polling(poll_interval=0.02, timeout=1)
                while not stop.is_set():
                    await asyncio.sleep(0.02)
                await app.updater.stop()
                await app.stop()

        thread = threading.Thread(target=asyncio.run, args=(main(),), daemon=True)
        thread.start()
        threads.append(thread)
        return bot

    yield start
    stop.set()
    for thread in threads:
        thread.join(timeout=10)


POST = "Кто едет на выходных\n\nАкбулак → Оренбург, сб 24.10, 06:30. 700 ₽ за место, свободно 2."


def propose(text_value: str = POST, **extra) -> list:
    return [
        make_message(
            [tool_use("propose_post", {"kind": "digest", "text": text_value, "reason": "Пятница.", **extra})],
            "tool_use",
        ),
        make_message([text("Черновик в карточке выше.")]),
    ]


def card(telegram) -> dict:
    return telegram.wait_for(
        lambda m, p: m == "sendMessage" and "reply_markup" in p and "Черновик #" in p.get("text", "")
    )


def button(card_params: dict, action: str) -> str:
    rows = json.loads(card_params["reply_markup"])["inline_keyboard"]
    return next(b["callback_data"] for row in rows for b in row if b["callback_data"].endswith(f":{action}"))


def test_stranger_is_refused_and_agent_not_used(telegram, run_bot):
    bot = run_bot([])
    telegram.message(STRANGER, "Опубликуй что-нибудь")
    reply = telegram.wait_for(lambda m, p: m == "sendMessage" and str(p.get("chat_id")) == str(STRANGER))
    assert str(STRANGER) in reply["text"] and "TELEGRAM_ALLOWED_USERS" in reply["text"]
    assert bot.clients == [] and bot.sessions == {}


def test_approved_draft_goes_to_channel_exactly_as_shown(telegram, run_bot, services):
    run_bot(propose())
    telegram.message(OWNER, "Собери дайджест на выходные")
    shown = card(telegram)
    assert "Почему сейчас" in shown["text"] and "Акбулак → Оренбург" in shown["text"]
    assert telegram.sent_to(CHANNEL) == []  # без согласования в канале ничего нет

    telegram.press(OWNER, button(shown, "publish"), message_id=1)
    posted = telegram.wait_for(lambda m, p: m == "sendMessage" and p.get("chat_id") == CHANNEL)
    assert posted["text"] == POST
    assert "parse_mode" not in posted
    url_button = json.loads(posted["reply_markup"])["inline_keyboard"][0][0]
    assert url_button["url"] == services.settings.post_button_url

    telegram.wait_for(lambda m, p: m == "editMessageReplyMarkup")
    telegram.wait_for(lambda m, p: m == "sendMessage" and "Опубликовано" in p.get("text", ""))
    draft = services.store.all()[0]
    assert draft.status == "published"


def test_double_press_publishes_once(telegram, run_bot):
    run_bot(propose())
    telegram.message(OWNER, "Дайджест")
    data = button(card(telegram), "publish")
    telegram.press(OWNER, data, message_id=1)
    telegram.press(OWNER, data, message_id=1)
    telegram.wait_for(lambda m, p: m == "answerCallbackQuery" and "уже не ждёт" in p.get("text", ""))
    assert len(telegram.sent_to(CHANNEL)) == 1


def test_stranger_cannot_press_publish(telegram, run_bot, services):
    run_bot(propose())
    telegram.message(OWNER, "Дайджест")
    data = button(card(telegram), "publish")
    telegram.press(STRANGER, data, message_id=1)
    telegram.wait_for(lambda m, p: m == "answerCallbackQuery" and "Нет доступа" in p.get("text", ""))
    assert telegram.sent_to(CHANNEL) == []
    assert services.store.pending()


def test_rejected_draft_never_reaches_channel(telegram, run_bot, services):
    run_bot(propose())
    telegram.message(OWNER, "Дайджест")
    telegram.press(OWNER, button(card(telegram), "reject"), message_id=1)
    telegram.wait_for(lambda m, p: m == "sendMessage" and "Отклонено" in p.get("text", ""))
    assert telegram.sent_to(CHANNEL) == []
    assert services.store.all()[0].status == "rejected"


def test_edit_request_produces_revision_and_retires_original(telegram, run_bot, services):
    bot = run_bot(
        [
            *propose()[:1],
            make_message([text("Готово.")]),
            make_message(
                [
                    tool_use(
                        "propose_post",
                        {"kind": "digest", "text": "Короче.", "reason": "Правка.", "replaces": "PLACEHOLDER"},
                    )
                ],
                "tool_use",
            ),
            make_message([text("Исправил.")]),
        ]
    )
    telegram.message(OWNER, "Дайджест")
    first = card(telegram)
    original = services.store.pending()[0]
    # Подставляем настоящий номер черновика в ответ модели.
    bot.clients[0].api._responses[1].content[0].input["replaces"] = original.id

    telegram.press(OWNER, button(first, "edit"), message_id=1)
    telegram.wait_for(lambda m, p: m == "sendMessage" and "Что поправить" in p.get("text", ""))
    telegram.message(OWNER, "Сделай короче")
    telegram.wait_for(lambda m, p: m == "sendMessage" and "Заменён черновиком" in p.get("text", ""))

    request = bot.clients[0].api.calls[2]["messages"][-1]["content"]
    assert f"черновик #{original.id}" in request and POST in request and "Сделай короче" in request
    assert services.store.get(original.id).status == "superseded"
    assert [d.text for d in services.store.pending()] == ["Короче."]


def test_channel_failure_keeps_draft_pending(telegram, run_bot, services):
    run_bot(propose())
    telegram.fail_channel = True
    telegram.message(OWNER, "Дайджест")
    telegram.press(OWNER, button(card(telegram), "publish"), message_id=1)
    reply = telegram.wait_for(lambda m, p: m == "sendMessage" and "Не удалось опубликовать" in p.get("text", ""))
    assert "администратор канала" in reply["text"]
    assert services.store.pending()


def test_scan_command_runs_scan_and_reports(telegram, run_bot, services):
    run_bot([make_message([text("Повода нет: обновлений нет, до пятницы далеко.")])])
    telegram.message(OWNER, "/scan")
    telegram.wait_for(lambda m, p: m == "sendMessage" and p.get("text", "").startswith("Повода нет"))
    state = services.store.state()
    assert state["last_scan_at"] and state["last_scan_result"].startswith("Повода нет")


def test_drafts_command_resends_pending_cards(telegram, run_bot, services):
    services.store.create(kind="other", text="Ждёт решения", reason="—", commits=[], with_button=False, max_pending=3)
    run_bot([])
    telegram.message(OWNER, "/drafts")
    resent = card(telegram)
    assert "Ждёт решения" in resent["text"] and "Без кнопки" in resent["text"]


def test_scheduled_scan_turns_new_commits_into_a_card(telegram, run_bot, services, github):
    services.store.update_state(baseline_commit=github.commits[2].sha)
    fresh = [c.sha[:7] for c in github.commits[3:]]
    run_bot(
        [
            make_message([tool_use("check_updates", {})], "tool_use"),
            make_message(
                [
                    tool_use(
                        "propose_post",
                        {
                            "kind": "update",
                            "text": "«По пути», обновление 0.2.0\n\n1. Изменение 3.",
                            "reason": "Выкачено.",
                            "commits": fresh,
                        },
                        tool_id="toolu_2",
                    )
                ],
                "tool_use",
            ),
            make_message([text("Черновик #… про обновление 0.2.0.")]),
        ]
    )
    telegram.message(OWNER, "/scan")
    shown = card(telegram)
    assert "обновление" in shown["text"]
    first_request = services.store.pending()[0]
    assert first_request.commits == [c.sha for c in github.commits[3:]]
