/**
 * Закрытый доступ.
 *
 * Отметка о блокировке — вторая половина постмодерации: без неё разбор
 * жалобы кончается удалением одного объявления, а автор публикует
 * следующее. Проверяется не только то, что запись не проходит, но и то,
 * что закрыты именно все маршруты, которым нужна личность, включая
 * чтение своих списков.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ORENBURG, SOL_ILETSK, nextDepartSlot } from '@vk-rideshare/shared';

import {
  DAY,
  authHeaders,
  createTestApp,
  createTrip,
  createUsers,
  type TestContext,
  type UserIds,
} from './helpers.js';

/** Корректное объявление: проверяем блокировку, а не валидацию. */
const validPayload = (): Record<string, unknown> => ({
  role: 'DRIVER',
  fromCity: ORENBURG,
  toCity: SOL_ILETSK,
  departAt: nextDepartSlot(new Date(Date.now() + 2 * DAY)).toISOString(),
  seatsTotal: 3,
  priceRub: 600,
});

const BLOCKED = 5_700_001n;
const NORMAL = 5_700_002n;

describe('доступ, закрытый администрацией', () => {
  let ctx: TestContext;
  let users: UserIds;

  beforeAll(async () => {
    ctx = await createTestApp();
    users = await createUsers(ctx.prisma, [BLOCKED, NORMAL]);
    await ctx.prisma.user.update({
      where: { id: users.id(BLOCKED) },
      data: { blockedAt: new Date() },
    });
  });

  afterEach(async () => {
    await ctx.prisma.trip.deleteMany({ where: { authorId: { in: users.all } } });
  });

  afterAll(async () => {
    await ctx.prisma.trip.deleteMany({ where: { authorId: { in: users.all } } });
    await ctx.prisma.user.deleteMany({ where: { id: { in: users.all } } });
    await ctx.close();
  });

  it('сессия не продлевается и профиль не обновляется', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/session',
      headers: authHeaders(BLOCKED),
      payload: { firstName: 'Новое имя' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('ACCESS_BLOCKED');

    const user = await ctx.prisma.user.findUnique({ where: { id: users.id(BLOCKED) } });
    expect(user?.firstName).not.toBe('Новое имя');
  });

  it('о блокировке сообщает уже первый, читающий запрос', async () => {
    // Важно именно здесь: без этого заблокированный без согласия сначала
    // увидел бы экран политики и согласился бы с ней впустую.
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/session',
      headers: authHeaders(BLOCKED),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('ACCESS_BLOCKED');
  });

  it('объявление не создаётся', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: authHeaders(BLOCKED),
      payload: validPayload(),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('ACCESS_BLOCKED');
    expect(await ctx.prisma.trip.count({ where: { authorId: users.id(BLOCKED) } })).toBe(0);
  });

  it('чтение своих списков тоже закрыто', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/me/trips',
      headers: authHeaders(BLOCKED),
    });

    expect(response.statusCode).toBe(403);
  });

  it('жалобу от заблокированного не принимают', async () => {
    const tripId = await createTrip(ctx.prisma, { authorId: users.id(NORMAL) });
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: authHeaders(BLOCKED),
      payload: { target: 'TRIP', targetId: tripId, reason: 'SPAM' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('ACCESS_BLOCKED');
  });

  it('остальных это не касается', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/me/trips',
      headers: authHeaders(NORMAL),
    });

    expect(response.statusCode).toBe(200);
  });

  it('снятая блокировка возвращает доступ', async () => {
    await ctx.prisma.user.update({
      where: { id: users.id(BLOCKED) },
      data: { blockedAt: null },
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/me/trips',
      headers: authHeaders(BLOCKED),
    });
    expect(response.statusCode).toBe(200);

    await ctx.prisma.user.update({
      where: { id: users.id(BLOCKED) },
      data: { blockedAt: new Date() },
    });
  });
});
