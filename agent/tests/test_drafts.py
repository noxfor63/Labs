"""Черновики: жизненный цикл, решения владельца и проверка текста."""

from __future__ import annotations

import pytest

from channel_agent.drafts import DraftError, DraftStore, lint_post


def create(store: DraftStore, **overrides):
    params = {
        "kind": "update",
        "text": "«По пути», обновление 0.2.0\n\n1. Новое.",
        "reason": "Вышло обновление.",
        "commits": [],
        "with_button": True,
        "max_pending": 3,
    }
    params.update(overrides)
    return store.create(**params)


def test_draft_lifecycle_survives_restart(tmp_path):
    store = DraftStore(tmp_path)
    draft = create(store, commits=["a" * 40])
    assert [d.id for d in store.pending()] == [draft.id]

    published = store.decide(draft.id, "published", channel_message_id=77)
    assert published.status == "published" and published.channel_message_id == 77

    # Новый объект хранилища — как после перезапуска бота.
    reloaded = DraftStore(tmp_path)
    assert reloaded.get(draft.id).status == "published"
    assert reloaded.pending() == []
    assert "a" * 40 in reloaded.handled()


def test_decision_is_final(tmp_path):
    store = DraftStore(tmp_path)
    draft = create(store)
    store.decide(draft.id, "rejected")
    with pytest.raises(DraftError, match="уже не ждёт"):
        store.decide(draft.id, "published")


def test_pending_limit_protects_owner_from_flood(tmp_path):
    store = DraftStore(tmp_path)
    create(store, max_pending=2)
    create(store, max_pending=2)
    with pytest.raises(DraftError, match="ждут решения"):
        create(store, max_pending=2)


def test_revision_replaces_original_and_keeps_its_commits(tmp_path):
    store = DraftStore(tmp_path)
    original = create(store, commits=["b" * 40], max_pending=1)
    # Лимит в один черновик не мешает правке: старый уходит, новый встаёт на его место.
    revised = create(store, text="Короче.", commits=[], replaces=original.id, max_pending=1)
    assert store.get(original.id).status == "superseded"
    assert revised.commits == ["b" * 40]
    assert [d.id for d in store.pending()] == [revised.id]


def test_cannot_replace_decided_draft(tmp_path):
    store = DraftStore(tmp_path)
    original = create(store)
    store.decide(original.id, "published")
    with pytest.raises(DraftError, match="заменять нечего"):
        create(store, replaces=original.id)


def test_pending_commits_count_as_handled(tmp_path):
    store = DraftStore(tmp_path)
    create(store, commits=["c" * 40])
    assert "c" * 40 in store.handled()


@pytest.mark.parametrize(
    ("kind", "text", "message"),
    [
        ("update", "   ", "Пустой"),
        ("ad", "Текст", "Неизвестный вид"),
        ("update", "x" * 4097, "длиннее"),
    ],
)
def test_invalid_drafts_are_refused(tmp_path, kind, text, message):
    with pytest.raises(DraftError, match=message):
        create(DraftStore(tmp_path), kind=kind, text=text)


def test_lint_flags_what_to_reread():
    assert lint_post("Сухой список изменений.\n\nОткрыть: https://t.me/po_puti56_bot/app") == []
    warnings = lint_post("Звоните +7 999 123-45-67, бесплатно навсегда! Подробнее: https://example.com")
    joined = " ".join(warnings)
    assert "номер телефона" in joined
    assert "https://example.com" in joined
    assert "бесплатности" in joined and "навсегда" in joined
    assert any("проверок" in w for w in lint_post("Только проверенные водители"))
