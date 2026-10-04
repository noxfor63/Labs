import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DAY,
  authHeaders,
  createTestApp,
  createTrip,
  createUsers,
  type UserIds,
  type TestContext,
} from './helpers.js';

const AUTHOR = 5_100_001n;
const RIDER_A = 5_100_002n;
const RIDER_B = 5_100_003n;
const RIDER_C = 5_100_004n;

describe('POST /api/trips/:id/requests — правила отклика', () => {
  let ctx: TestContext;
  let users: UserIds;

  const respond = (tripId: string, vkUserId: bigint, message = 'Возьмёте?') =>
    ctx.app.inject({
      method: 'POST',
      url: `/api/trips/${tripId}/requests`,
      headers: authHeaders(vkUserId),
      payload: { message },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    users = await createUsers(ctx.prisma, [AUTHOR, RIDER_A, RIDER_B, RIDER_C]);
  });

  afterAll(async () => {
    await ctx.prisma.tripRequest.deleteMany({ where: { userId: { in: users.all } } });
    await ctx.prisma.trip.deleteMany({ where: { authorId: users.id(AUTHOR) } });
    await ctx.prisma.user.deleteMany({ where: { id: { in: users.all } } });
    await ctx.close();
  });

  it('обычный отклик создаётся со статусом PENDING', async () => {
    const tripId = await createTrip(ctx.prisma, { authorId: users.id(AUTHOR), seatsTotal: 2 });

    const response = await respond(tripId, RIDER_A);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      tripId,
      status: 'PENDING',
      message: 'Возьмёте?',
      user: { vkUserId: RIDER_A.toString() },
    });
  });

  it('на собственную поездку откликнуться нельзя', async () => {
    const tripId = await createTrip(ctx.prisma, { authorId: users.id(AUTHOR), seatsTotal: 2 });

    const response = await respond(tripId, AUTHOR);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'OWN_TRIP' } });
    expect(response.json().error.message).toMatch(/собственн/i);
  });

  it('повторный отклик того же человека отклоняется', async () => {
    const tripId = await createTrip(ctx.prisma, { authorId: users.id(AUTHOR), seatsTotal: 3 });

    expect((await respond(tripId, RIDER_B)).statusCode).toBe(201);
    const second = await respond(tripId, RIDER_B);

    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: { code: 'ALREADY_REQUESTED' } });

    const count = await ctx.prisma.tripRequest.count({ where: { tripId } });
    expect(count).toBe(1);
  });

  it('при нуле свободных мест отклик отклоняется', async () => {
    const tripId = await createTrip(ctx.prisma, {
      authorId: users.id(AUTHOR),
      seatsTotal: 2,
      seatsLeft: 0,
    });

    const response = await respond(tripId, RIDER_C);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'NO_SEATS_LEFT' } });
    expect(response.json().error.message).toMatch(/мест/i);
  });

  it('на отменённую поездку откликнуться нельзя', async () => {
    const tripId = await createTrip(ctx.prisma, {
      authorId: users.id(AUTHOR),
      status: 'CANCELLED',
    });

    const response = await respond(tripId, RIDER_A);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'TRIP_NOT_ACTIVE' } });
  });

  it('на уже состоявшуюся поездку откликнуться нельзя', async () => {
    const tripId = await createTrip(ctx.prisma, {
      authorId: users.id(AUTHOR),
      departAt: new Date(Date.now() - DAY),
    });

    const response = await respond(tripId, RIDER_A);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'TRIP_IN_PAST' } });
  });

  it('несуществующая поездка — 404', async () => {
    const response = await respond('нет-такой-поездки', RIDER_A);
    expect(response.statusCode).toBe(404);
  });
});

describe('PATCH /api/requests/:id — принятие и отклонение', () => {
  let ctx: TestContext;
  let users: UserIds;

  beforeAll(async () => {
    ctx = await createTestApp();
    users = await createUsers(ctx.prisma, [AUTHOR, RIDER_A, RIDER_B]);
  });

  afterAll(async () => {
    await ctx.prisma.tripRequest.deleteMany({ where: { userId: { in: users.all } } });
    await ctx.prisma.trip.deleteMany({ where: { authorId: users.id(AUTHOR) } });
    await ctx.prisma.user.deleteMany({ where: { id: { in: users.all } } });
    await ctx.close();
  });

  const makeRequest = async (seatsTotal = 2): Promise<{ tripId: string; requestId: string }> => {
    const tripId = await createTrip(ctx.prisma, { authorId: users.id(AUTHOR), seatsTotal });
    const created = await ctx.prisma.tripRequest.create({
      data: { tripId, userId: users.id(RIDER_A), message: null },
    });
    return { tripId, requestId: created.id };
  };

  it('автор принимает отклик, свободное место уменьшается', async () => {
    const { tripId, requestId } = await makeRequest(2);

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/requests/${requestId}`,
      headers: authHeaders(AUTHOR),
      payload: { status: 'ACCEPTED' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ACCEPTED' });

    const trip = await ctx.prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.seatsLeft).toBe(1);
  });

  it('отклонение не трогает счётчик мест', async () => {
    const { tripId, requestId } = await makeRequest(2);

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/requests/${requestId}`,
      headers: authHeaders(AUTHOR),
      payload: { status: 'DECLINED' },
    });

    expect(response.statusCode).toBe(200);
    const trip = await ctx.prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.seatsLeft).toBe(2);
  });

  it('чужой человек не может принять отклик', async () => {
    const { requestId } = await makeRequest();

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/requests/${requestId}`,
      headers: authHeaders(RIDER_B),
      payload: { status: 'ACCEPTED' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('повторная обработка того же отклика — 409, место не уходит дважды', async () => {
    const { tripId, requestId } = await makeRequest(3);

    const first = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/requests/${requestId}`,
      headers: authHeaders(AUTHOR),
      payload: { status: 'ACCEPTED' },
    });
    expect(first.statusCode).toBe(200);

    const second = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/requests/${requestId}`,
      headers: authHeaders(AUTHOR),
      payload: { status: 'ACCEPTED' },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: { code: 'REQUEST_NOT_PENDING' } });

    const trip = await ctx.prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.seatsLeft).toBe(2);
  });

  it('принять отклик при нуле мест нельзя, отклик остаётся PENDING', async () => {
    const tripId = await createTrip(ctx.prisma, {
      authorId: users.id(AUTHOR),
      seatsTotal: 1,
      seatsLeft: 0,
    });
    const created = await ctx.prisma.tripRequest.create({
      data: { tripId, userId: users.id(RIDER_A) },
    });

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/requests/${created.id}`,
      headers: authHeaders(AUTHOR),
      payload: { status: 'ACCEPTED' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'NO_SEATS_LEFT' } });

    // Транзакция откатилась целиком: статус отклика не изменился.
    const after = await ctx.prisma.tripRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.status).toBe('PENDING');
    const trip = await ctx.prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.seatsLeft).toBe(0);
  });
});
