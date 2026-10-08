/**
 * Жалобы на пользовательский контент.
 *
 * Правила мини-приложений требуют, чтобы при постмодерации у человека
 * была возможность пожаловаться на неприемлемое. Возможность — это не
 * кнопка в интерфейсе, а то, что после нажатия жалоба действительно
 * где-то лежит и её можно найти. Поэтому проверки здесь смотрят в базу,
 * а не только на код ответа.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  DAY,
  authHeaders,
  createTestApp,
  createTrip,
  createUsers,
  type TestContext,
  type UserIds,
} from './helpers.js';

const AUTHOR = 5_600_001n;
const COMPLAINER = 5_600_002n;
const OUTSIDER = 5_600_003n;

describe('POST /api/reports', () => {
  let ctx: TestContext;
  let users: UserIds;
  let tripId: string;
  let reviewId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    users = await createUsers(ctx.prisma, [AUTHOR, COMPLAINER, OUTSIDER]);

    // Завершённая поездка автора и отзыв, который он оставил о другом:
    // это и есть тот контент, на который можно пожаловаться.
    tripId = await createTrip(ctx.prisma, {
      authorId: users.id(AUTHOR),
      status: 'COMPLETED',
      departAt: new Date(Date.now() - 2 * DAY),
    });
    const review = await ctx.prisma.review.create({
      data: {
        tripId,
        authorId: users.id(AUTHOR),
        targetId: users.id(COMPLAINER),
        rating: 1,
        text: 'Текст, на который жалуются',
      },
    });
    reviewId = review.id;
  });

  afterEach(async () => {
    await ctx.prisma.report.deleteMany({ where: { reporterId: { in: users.all } } });
  });

  afterAll(async () => {
    await ctx.prisma.report.deleteMany({ where: { reporterId: { in: users.all } } });
    await ctx.prisma.review.deleteMany({ where: { authorId: { in: users.all } } });
    await ctx.prisma.trip.deleteMany({ where: { authorId: { in: users.all } } });
    await ctx.prisma.user.deleteMany({ where: { id: { in: users.all } } });
    await ctx.close();
  });

  const post = (vkUserId: bigint, payload: Record<string, unknown>) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: authHeaders(vkUserId),
      payload,
    });

  it('жалоба на объявление сохраняется и ждёт разбора', async () => {
    const response = await post(COMPLAINER, {
      target: 'TRIP',
      targetId: tripId,
      reason: 'FRAUD',
      comment: 'Просит предоплату на карту',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe('NEW');

    // Главное: жалоба действительно есть в базе, и её видно по статусу.
    const stored = await ctx.prisma.report.findFirst({
      where: { reporterId: users.id(COMPLAINER), target: 'TRIP', targetId: tripId },
    });
    expect(stored?.reason).toBe('FRAUD');
    expect(stored?.comment).toBe('Просит предоплату на карту');
    expect(stored?.status).toBe('NEW');
  });

  it('жалоба на отзыв сохраняется', async () => {
    const response = await post(COMPLAINER, {
      target: 'REVIEW',
      targetId: reviewId,
      reason: 'OFFENSIVE',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().comment).toBeNull();
  });

  it('жалоба на профиль сохраняется', async () => {
    const response = await post(COMPLAINER, {
      target: 'USER',
      targetId: users.id(AUTHOR),
      reason: 'PERSONAL_DATA',
      comment: 'В имени чужой номер телефона',
    });

    expect(response.statusCode).toBe(201);
  });

  it('на свой контент пожаловаться нельзя', async () => {
    const trip = await post(AUTHOR, { target: 'TRIP', targetId: tripId, reason: 'SPAM' });
    expect(trip.statusCode).toBe(409);
    expect(trip.json().error.code).toBe('SELF_REPORT');

    const review = await post(AUTHOR, {
      target: 'REVIEW',
      targetId: reviewId,
      reason: 'SPAM',
    });
    expect(review.statusCode).toBe(409);

    const self = await post(AUTHOR, {
      target: 'USER',
      targetId: users.id(AUTHOR),
      reason: 'SPAM',
    });
    expect(self.statusCode).toBe(409);
    expect(self.json().error.code).toBe('SELF_REPORT');
  });

  it('повторная жалоба на то же — 409, а не вторая строка', async () => {
    const first = await post(COMPLAINER, { target: 'TRIP', targetId: tripId, reason: 'SPAM' });
    expect(first.statusCode).toBe(201);

    const second = await post(COMPLAINER, {
      target: 'TRIP',
      targetId: tripId,
      reason: 'OFFENSIVE',
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('ALREADY_REPORTED');

    expect(
      await ctx.prisma.report.count({
        where: { reporterId: users.id(COMPLAINER), target: 'TRIP', targetId: tripId },
      }),
    ).toBe(1);
  });

  it('разные люди жалуются на одно и то же независимо', async () => {
    expect(
      (await post(COMPLAINER, { target: 'TRIP', targetId: tripId, reason: 'SPAM' })).statusCode,
    ).toBe(201);
    expect(
      (await post(OUTSIDER, { target: 'TRIP', targetId: tripId, reason: 'SPAM' })).statusCode,
    ).toBe(201);

    expect(await ctx.prisma.report.count({ where: { target: 'TRIP', targetId: tripId } })).toBe(2);
  });

  it('жалоба на удалённое — 404, строки не появляется', async () => {
    const response = await post(COMPLAINER, {
      target: 'TRIP',
      targetId: 'ckno-such-trip',
      reason: 'SPAM',
    });

    expect(response.statusCode).toBe(404);
    expect(await ctx.prisma.report.count({ where: { reporterId: users.id(COMPLAINER) } })).toBe(0);
  });

  it('причина «другое» без пояснения не принимается', async () => {
    const response = await post(COMPLAINER, {
      target: 'TRIP',
      targetId: tripId,
      reason: 'OTHER',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    expect(await ctx.prisma.report.count({ where: { reporterId: users.id(COMPLAINER) } })).toBe(0);
  });

  it('неизвестная причина не принимается', async () => {
    const response = await post(COMPLAINER, {
      target: 'TRIP',
      targetId: tripId,
      reason: 'НЕ_ПОНРАВИЛСЯ',
    });

    expect(response.statusCode).toBe(400);
  });

  it('без сессии жалобу не принять', async () => {
    const response = await post(5_600_099n, {
      target: 'TRIP',
      targetId: tripId,
      reason: 'SPAM',
    });

    expect(response.statusCode).toBe(401);
  });
});
