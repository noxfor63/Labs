/**
 * Разбор жалоб из приложения.
 *
 * Экран существует потому, что оповестить владельца нечем: сервер не
 * достаёт до Telegram, почта не настроена. Значит, единственный канал —
 * само приложение, и к нему два требования. Первое: посторонний не
 * должен видеть ни жалоб, ни чужих текстов. Второе: нажатие на кнопку
 * должно менять то же самое, что меняет команда на сервере, — иначе два
 * пути разойдутся, и владелец будет видеть разное в разных местах.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  authHeaders,
  createTestApp,
  createTrip,
  createUsers,
  makeEnv,
  type TestContext,
  type UserIds,
} from './helpers.js';

const MODERATOR = 5_800_001n;
const AUTHOR = 5_800_002n;
const COMPLAINER = 5_800_003n;

describe('разбор жалоб в приложении', () => {
  let ctx: TestContext;
  let users: UserIds;
  let tripId: string;

  beforeAll(async () => {
    ctx = await createTestApp({
      env: makeEnv({ MODERATOR_IDS: `VK:${MODERATOR}` }),
    });
    users = await createUsers(ctx.prisma, [MODERATOR, AUTHOR, COMPLAINER]);
  });

  beforeEach(async () => {
    tripId = await createTrip(ctx.prisma, { authorId: users.id(AUTHOR) });
    await ctx.prisma.report.create({
      data: {
        reporterId: users.id(COMPLAINER),
        target: 'TRIP',
        targetId: tripId,
        // Так же, как это делает POST /api/reports: автор запоминается
        // в момент жалобы, иначе после удаления контента его не найти.
        ownerId: users.id(AUTHOR),
        reason: 'FRAUD',
        comment: 'Просит предоплату',
      },
    });
  });

  afterEach(async () => {
    await ctx.prisma.report.deleteMany({ where: { reporterId: { in: users.all } } });
    await ctx.prisma.trip.deleteMany({ where: { authorId: { in: users.all } } });
    await ctx.prisma.user.updateMany({
      where: { id: { in: users.all } },
      data: { blockedAt: null },
    });
  });

  afterAll(async () => {
    await ctx.prisma.user.deleteMany({ where: { id: { in: users.all } } });
    await ctx.close();
  });

  const list = (vkUserId: bigint, query = '') =>
    ctx.app.inject({
      method: 'GET',
      url: `/api/moderation/reports${query}`,
      headers: authHeaders(vkUserId),
    });

  const act = (vkUserId: bigint, reportId: string, action: string) =>
    ctx.app.inject({
      method: 'POST',
      url: `/api/moderation/reports/${reportId}`,
      headers: authHeaders(vkUserId),
      payload: { action },
    });

  const currentReportId = async (): Promise<string> => {
    const report = await ctx.prisma.report.findFirstOrThrow({
      where: { targetId: tripId },
    });
    return report.id;
  };

  it('посторонний не видит ни жалоб, ни чужого текста', async () => {
    const response = await list(COMPLAINER);

    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('предоплату');
  });

  it('модератор видит жалобу вместе с содержимым объявления', async () => {
    const response = await list(MODERATOR);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.newCount).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      target: 'TRIP',
      reason: 'FRAUD',
      comment: 'Просит предоплату',
      status: 'NEW',
      ownerBlocked: false,
    });
    // Разбирать по идентификатору нельзя — в ответе должен быть сам текст.
    expect(body.items[0].content).toContain('Оренбург');
    expect(body.items[0].owner.id).toBe(users.id(AUTHOR));
    expect(body.items[0].reporter.id).toBe(users.id(COMPLAINER));
  });

  it('«нарушения нет» закрывает жалобу и ничего не трогает', async () => {
    const response = await act(MODERATOR, await currentReportId(), 'DISMISS');

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('DISMISSED');
    expect(await ctx.prisma.trip.count({ where: { id: tripId } })).toBe(1);
    expect((await list(MODERATOR)).json().newCount).toBe(0);
  });

  it('«удалить» убирает объявление и закрывает жалобу', async () => {
    const response = await act(MODERATOR, await currentReportId(), 'REMOVE');

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('REVIEWED');
    expect(await ctx.prisma.trip.count({ where: { id: tripId } })).toBe(0);
    // Объявления больше нет, а автор в жалобе остался: иначе некого было
    // бы закрыть, если выяснится, что это не первое его объявление.
    expect(response.json().owner.id).toBe(users.id(AUTHOR));
    expect(response.json().content).toMatch(/удалено/i);

    const author = await ctx.prisma.user.findUnique({ where: { id: users.id(AUTHOR) } });
    expect(author?.blockedAt).toBeNull();
  });

  it('«закрыть доступ» удаляет объявление и блокирует автора', async () => {
    const response = await act(MODERATOR, await currentReportId(), 'BLOCK');

    expect(response.statusCode).toBe(200);
    expect(await ctx.prisma.trip.count({ where: { id: tripId } })).toBe(0);

    const author = await ctx.prisma.user.findUnique({ where: { id: users.id(AUTHOR) } });
    expect(author?.blockedAt).toBeInstanceOf(Date);
  });

  it('«вернуть доступ» снимает блокировку и не меняет состояние жалобы', async () => {
    const reportId = await currentReportId();
    await act(MODERATOR, reportId, 'BLOCK');

    const response = await act(MODERATOR, reportId, 'UNBLOCK');

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('REVIEWED');
    expect(response.json().ownerBlocked).toBe(false);

    const author = await ctx.prisma.user.findUnique({ where: { id: users.id(AUTHOR) } });
    expect(author?.blockedAt).toBeNull();
  });

  it('у жалобы на профиль «удалить» объясняет, что удалять нечего', async () => {
    const report = await ctx.prisma.report.create({
      data: {
        reporterId: users.id(COMPLAINER),
        target: 'USER',
        targetId: users.id(AUTHOR),
        ownerId: users.id(AUTHOR),
        reason: 'PERSONAL_DATA',
        comment: 'Чужой номер в имени',
      },
    });

    const response = await act(MODERATOR, report.id, 'REMOVE');

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/закройте доступ/i);

    const stored = await ctx.prisma.report.findUnique({ where: { id: report.id } });
    expect(stored?.status).toBe('NEW');
  });

  it('у жалобы без сохранённого автора блокировка объясняет, почему не вышло', async () => {
    // Такие строки могли остаться от версии, где автор в жалобе не
    // сохранялся. Разбор не должен падать на них стектрейсом.
    const legacy = await ctx.prisma.report.create({
      data: {
        reporterId: users.id(COMPLAINER),
        target: 'TRIP',
        targetId: 'ckno-such-trip',
        reason: 'SPAM',
      },
    });

    const response = await act(MODERATOR, legacy.id, 'BLOCK');

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/неизвестен/i);
  });

  it('разобранные жалобы видны по запросу, а не по умолчанию', async () => {
    await act(MODERATOR, await currentReportId(), 'DISMISS');

    expect((await list(MODERATOR)).json().items).toHaveLength(0);
    expect((await list(MODERATOR, '?status=DISMISSED')).json().items).toHaveLength(1);
  });

  it('без MODERATOR_IDS экран не доступен никому', async () => {
    const plain = await createTestApp();
    try {
      const response = await plain.app.inject({
        method: 'GET',
        url: '/api/moderation/reports',
        headers: authHeaders(MODERATOR),
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await plain.close();
    }
  });

  it('сессия сообщает, показывать ли экран жалоб', async () => {
    const asModerator = await ctx.app.inject({
      method: 'GET',
      url: '/api/session',
      headers: authHeaders(MODERATOR),
    });
    expect(asModerator.json().isModerator).toBe(true);

    const asUser = await ctx.app.inject({
      method: 'GET',
      url: '/api/session',
      headers: authHeaders(COMPLAINER),
    });
    expect(asUser.json().isModerator).toBe(false);
  });
});
