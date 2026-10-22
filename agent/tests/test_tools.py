"""Инструменты агента: что нового, поездки, история канала, черновик, документы."""

from __future__ import annotations

from channel_agent.tools import CHANNEL_TOOLS
from channel_agent.tools.channel import (
    channel_history,
    check_updates,
    commit_files,
    propose_post,
    read_project_doc,
    skip_commits,
    upcoming_trips,
)

from .conftest import FakePP, make_commits


def run(tool, ctx, **args):
    return tool.run(args, ctx)


def test_there_is_no_publishing_tool():
    # Публикует только код бота по кнопке владельца — у модели такого инструмента быть не должно.
    names = {tool.name for tool in CHANNEL_TOOLS}
    assert not any("publish" in name or "send" in name or "post_to" in name for name in names)
    assert "propose_post" in names


def test_first_run_starts_counting_from_what_is_deployed(ctx, services, github):
    result = run(check_updates, ctx)
    assert not result.is_error
    assert "Первый запуск" in result.content
    assert services.store.state()["baseline_commit"] == github.commits[-1].sha


def test_new_deployed_commits_are_shown_until_decided(ctx, services, github):
    run(check_updates, ctx)  # первый запуск — отсчёт с commits[4]
    github.commits += make_commits(8)[5:]  # выкачены ещё три
    services.pp_api.commit = github.commits[-1].sha

    shown = run(check_updates, ctx).content
    for commit in github.commits[5:]:
        assert commit.sha[:7] in shown
    assert github.commits[4].sha[:7] not in shown

    run(skip_commits, ctx, commits=[github.commits[5].sha[:7]], reason="только тесты")
    result = run(
        propose_post,
        ctx,
        kind="update",
        text="«По пути», обновление 0.3.0\n\n1. Новое.",
        reason="Выкачено обновление.",
        commits=[c.sha[:7] for c in github.commits[6:]],
    )
    assert "отправлен владельцу" in result.content
    assert services.created[0].commits == [c.sha for c in github.commits[6:]]

    # Всё разобрано: одно закрыто без поста, остальное ждёт решения в черновике.
    assert "Новых неразобранных изменений нет" in run(check_updates, ctx).content


def test_undeployed_commits_are_not_shown(ctx, services, github):
    run(check_updates, ctx)
    github.commits += make_commits(7)[5:]  # в репозитории есть, на сервер не выкачены
    assert "Новых неразобранных изменений нет" in run(check_updates, ctx).content


def test_unknown_deployment_is_said_out_loud(ctx, services):
    services.pp_api = FakePP(commit=None)
    result = run(check_updates, ctx)
    assert "не сообщил, какой коммит выкачен" in result.content


def test_everything_handled_moves_baseline(ctx, services, github):
    run(check_updates, ctx)
    github.commits += make_commits(7)[5:]
    services.pp_api.commit = github.commits[-1].sha
    run(check_updates, ctx)
    run(skip_commits, ctx, commits=[c.sha[:7] for c in github.commits[5:]], reason="внутреннее")
    run(check_updates, ctx)
    state = services.store.state()
    assert state["baseline_commit"] == github.commits[-1].sha
    assert state["handled_commits"] == []


def test_unknown_commit_is_refused_with_hint(ctx, github):
    run(check_updates, ctx)
    result = run(propose_post, ctx, kind="update", text="Текст", reason="—", commits=["deadbee"])
    assert result.is_error and "не из последнего check_updates" in result.content
    assert run(commit_files, ctx, commit="0000000").is_error


def test_propose_post_reports_lint_and_never_claims_publication(ctx, services):
    result = run(propose_post, ctx, kind="other", text="Бесплатно навсегда.", reason="Проверка.")
    assert "перечитать" in result.content
    assert "Дальше решает он" in result.content
    assert services.store.pending()[0].text == "Бесплатно навсегда."


def test_pending_limit_is_reported_to_model(ctx, services):
    for i in range(services.settings.max_pending_drafts):
        run(propose_post, ctx, kind="other", text=f"Пост {i}", reason="—")
    result = run(propose_post, ctx, kind="other", text="Ещё один", reason="—")
    assert result.is_error and "ждут решения" in result.content


def test_upcoming_trips_are_local_time_and_split_by_role(ctx, services):
    services.pp_api.items = [
        {
            "fromCity": "Акбулак",
            "toCity": "Оренбург",
            "departAt": "2026-10-24T01:30:00.000Z",  # 06:30 по Оренбургу, суббота
            "role": "DRIVER",
            "seatsTotal": 3,
            "seatsLeft": 2,
            "priceRub": 700,
        },
        {
            "fromCity": "Оренбург",
            "toCity": "Илек",
            "departAt": "2026-10-24T05:00:00.000Z",
            "role": "DRIVER",
            "seatsTotal": 3,
            "seatsLeft": 0,
            "priceRub": 650,
        },
        {
            "fromCity": "Илек",
            "toCity": "Оренбург",
            "departAt": "2026-10-25T03:00:00.000Z",
            "role": "PASSENGER",
            "seatsTotal": 2,
            "seatsLeft": 2,
            "priceRub": 600,
        },
    ]
    result = run(upcoming_trips, ctx, days=4).content
    assert "водителей со свободными местами — 1" in result
    assert "Акбулак → Оренбург, сб 24.10, 06:30 — 700 ₽, свободно 2 из 3" in result
    # Полная машина в список водителей с местами не попадает.
    assert "Оренбург → Илек" not in result
    assert "ищет водителя" in result


def test_upcoming_trips_without_api_says_so(ctx, services):
    services.pp_api = None
    result = run(upcoming_trips, ctx)
    assert result.is_error and "PP_API_URL" in result.content


def test_channel_history_shows_rhythm_and_rejections(ctx, services):
    first = run(propose_post, ctx, kind="digest", text="Кто едет на выходных", reason="—")
    assert not first.is_error
    draft = services.store.pending()[0]
    services.store.decide(draft.id, "published")
    run(propose_post, ctx, kind="drivers", text="Нужны водители", reason="—")
    services.store.decide(services.store.pending()[0].id, "rejected")

    history = run(channel_history, ctx).content
    assert "Опубликовано за 7 дней: 1" in history
    assert "Кто едет на выходных" in history
    assert "не предлагай то же снова" in history and "Нужны водители" in history


def test_project_docs_are_allowlisted(ctx, services, github):
    github.docs["marketing/telegram/06-post-templates.md"] = "# Шаблоны"
    run(check_updates, ctx)  # запоминает выкаченный коммит — документы читаются с него
    assert run(read_project_doc, ctx, path="marketing/telegram/06-post-templates.md").content == "# Шаблоны"
    assert github.read_refs[-1] == github.commits[-1].sha
    for path in ("apps/api/src/env.ts", "marketing/../.env", "/etc/passwd"):
        assert run(read_project_doc, ctx, path=path).is_error
