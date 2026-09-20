import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DAY,
  authHeaders,
  createTestApp,
  createTrip,
  createUser,
  type TestContext,
} from './helpers.js';

const AUTHOR = 5_400_001n;
const RIDER = 5_400_002n;
const OUTSIDER = 5_400_003n;

const futureIso = (days: number): string => new Date(Date.now() + days * DAY).toISOString();

describe('POST /api/trips — создание и валидация', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    for (const vkUserId of [AUTHOR, RIDER, OUTSIDER]) {
      await createUser(ctx.prisma, vkUserId);
    }
  });

  afterAll(async () => {
    const people = [AUTHOR, RIDER, OUTSIDER];
    await ctx.prisma.tripRequest.deleteMany({ where: { userVkId: { in: people } } });
    await ctx.prisma.trip.deleteMany({ where: { authorVkId: { in: people } } });
    await ctx.prisma.user.deleteMany({ where: { vkUserId: { in: people } } });
    await ctx.close();
  });

  const create = (payload: Record<string, unknown>, vkUserId: bigint = AUTHOR) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: authHeaders(vkUserId),
      payload,
    });

  const validPayload = (): Record<string, unknown> => ({
    role: 'DRIVER',
    fromCity: 'Москва',
    fromPoint: 'метро Тёплый Стан',
    toCity: 'Тула',
    departAt: futureIso(2),
    seatsTotal: 3,
    priceRub: 900,
    carModel: 'Lada Vesta',
    comment: 'Еду спокойно.',
  });

  it('создаёт поездку и ставит seatsLeft равным seatsTotal', async () => {
    const response = await create(validPayload());

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      role: 'DRIVER',
      fromCity: 'Москва',
      toCity: 'Тула',
      seatsTotal: 3,
      seatsLeft: 3,
      status: 'ACTIVE',
      author: { vkUserId: AUTHOR.toString() },
    });
  });

  it('дата отправления в прошлом — 400', async () => {
    const response = await create({ ...validPayload(), departAt: new Date(Date.now() - DAY).toISOString() });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/будущем/i);
  });

  it('число мест вне диапазона 1..8 — 400', async () => {
    for (const seatsTotal of [0, 9, 100]) {
      const response = await create({ ...validPayload(), seatsTotal });
      expect(response.statusCode).toBe(400);
    }
  });

  it('совпадающие «откуда» и «куда» — 400', async () => {
    const response = await create({
      ...validPayload(),
      fromCity: 'Казань',
      fromPoint: null,
      toCity: 'Казань',
      toPoint: null,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/различаться/i);
  });

  it('один и тот же город с разными точками — разрешено', async () => {
    const response = await create({
      ...validPayload(),
      fromCity: 'Казань',
      fromPoint: 'аэропорт',
      toCity: 'Казань',
      toPoint: 'ж/д вокзал',
    });

    expect(response.statusCode).toBe(201);
  });

  it('город вне справочника — 400', async () => {
    const response = await create({ ...validPayload(), toCity: 'Хогсмид' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/справочник/i);
  });

  it('поездка приписывается автору из подписи, а не из тела запроса', async () => {
    const response = await create({ ...validPayload(), authorVkId: OUTSIDER.toString() }, AUTHOR);

    expect(response.statusCode).toBe(201);
    expect(response.json().author.vkUserId).toBe(AUTHOR.toString());
  });
});

describe('GET /api/trips/:id — видимость откликов', () => {
  let ctx: TestContext;
  let tripId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    for (const vkUserId of [AUTHOR, RIDER, OUTSIDER]) {
      await createUser(ctx.prisma, vkUserId);
    }
    tripId = await createTrip(ctx.prisma, { authorVkId: AUTHOR, seatsTotal: 3 });
    await ctx.prisma.tripRequest.create({ data: { tripId, userVkId: RIDER, message: 'Возьмёте?' } });
    await ctx.prisma.tripRequest.create({ data: { tripId, userVkId: OUTSIDER } });
  });

  afterAll(async () => {
    await ctx.prisma.tripRequest.deleteMany({ where: { tripId } });
    await ctx.prisma.trip.deleteMany({ where: { id: tripId } });
    await ctx.prisma.user.deleteMany({
      where: { vkUserId: { in: [AUTHOR, RIDER, OUTSIDER] } },
    });
    await ctx.close();
  });

  const read = (vkUserId: bigint) =>
    ctx.app.inject({
      method: 'GET',
      url: `/api/trips/${tripId}`,
      headers: authHeaders(vkUserId),
    });

  it('автор видит все отклики', async () => {
    const body = (await read(AUTHOR)).json();

    expect(body.isAuthor).toBe(true);
    expect(body.requests).toHaveLength(2);
    expect(body.myRequest).toBeNull();
  });

  it('откликнувшийся видит только свой отклик', async () => {
    const body = (await read(RIDER)).json();

    expect(body.isAuthor).toBe(false);
    expect(body.requests).toHaveLength(0);
    expect(body.myRequest).toMatchObject({
      user: { vkUserId: RIDER.toString() },
      message: 'Возьмёте?',
    });
  });

  it('посторонний не видит ни чужих откликов, ни своего', async () => {
    const stranger = 5_400_009n;
    await createUser(ctx.prisma, stranger);

    const body = (await read(stranger)).json();

    expect(body.requests).toHaveLength(0);
    expect(body.myRequest).toBeNull();

    await ctx.prisma.user.delete({ where: { vkUserId: stranger } });
  });
});

describe('PATCH /api/trips/:id и мои разделы', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    for (const vkUserId of [AUTHOR, RIDER]) {
      await createUser(ctx.prisma, vkUserId);
    }
  });

  afterAll(async () => {
    await ctx.prisma.tripRequest.deleteMany({ where: { userVkId: { in: [AUTHOR, RIDER] } } });
    await ctx.prisma.trip.deleteMany({ where: { authorVkId: { in: [AUTHOR, RIDER] } } });
    await ctx.prisma.user.deleteMany({ where: { vkUserId: { in: [AUTHOR, RIDER] } } });
    await ctx.close();
  });

  const patch = (tripId: string, vkUserId: bigint, status: string) =>
    ctx.app.inject({
      method: 'PATCH',
      url: `/api/trips/${tripId}`,
      headers: authHeaders(vkUserId),
      payload: { status },
    });

  it('автор завершает поездку', async () => {
    const tripId = await createTrip(ctx.prisma, { authorVkId: AUTHOR });

    const response = await patch(tripId, AUTHOR, 'COMPLETED');

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('COMPLETED');
  });

  it('не автор получает 403', async () => {
    const tripId = await createTrip(ctx.prisma, { authorVkId: AUTHOR });

    const response = await patch(tripId, RIDER, 'CANCELLED');

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('повторная смена статуса — 409', async () => {
    const tripId = await createTrip(ctx.prisma, { authorVkId: AUTHOR });

    expect((await patch(tripId, AUTHOR, 'CANCELLED')).statusCode).toBe(200);
    const second = await patch(tripId, AUTHOR, 'COMPLETED');

    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: { code: 'TRIP_NOT_ACTIVE' } });
  });

  it('недопустимый статус — 400', async () => {
    const tripId = await createTrip(ctx.prisma, { authorVkId: AUTHOR });
    const response = await patch(tripId, AUTHOR, 'ACTIVE');
    expect(response.statusCode).toBe(400);
  });

  it('GET /api/me/trips отдаёт только мои объявления', async () => {
    await createTrip(ctx.prisma, { authorVkId: AUTHOR });
    await createTrip(ctx.prisma, { authorVkId: RIDER });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/me/trips',
      headers: authHeaders(AUTHOR),
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items as Array<{ author: { vkUserId: string } }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((trip) => trip.author.vkUserId === AUTHOR.toString())).toBe(true);
  });

  it('GET /api/me/requests отдаёт мои отклики вместе с поездкой', async () => {
    const tripId = await createTrip(ctx.prisma, { authorVkId: AUTHOR });
    await ctx.prisma.tripRequest.create({ data: { tripId, userVkId: RIDER } });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/me/requests',
      headers: authHeaders(RIDER),
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items as Array<{
      user: { vkUserId: string };
      trip: { id: string };
    }>;
    expect(items.every((item) => item.user.vkUserId === RIDER.toString())).toBe(true);
    expect(items.some((item) => item.trip.id === tripId)).toBe(true);
  });

  it('POST /api/session заводит и обновляет кэш профиля', async () => {
    const newcomer = 5_400_777n;

    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/session',
      headers: authHeaders(newcomer),
      payload: { firstName: 'Пётр', lastName: 'Петров', city: 'Казань' },
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().user).toMatchObject({
      vkUserId: newcomer.toString(),
      firstName: 'Пётр',
      city: 'Казань',
    });

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/session',
      headers: authHeaders(newcomer),
      payload: { firstName: 'Пётр', lastName: 'Сидоров', city: 'Уфа' },
    });

    expect(second.json().user).toMatchObject({ lastName: 'Сидоров', city: 'Уфа' });
    expect(await ctx.prisma.user.count({ where: { vkUserId: newcomer } })).toBe(1);

    await ctx.prisma.user.delete({ where: { vkUserId: newcomer } });
  });
});
