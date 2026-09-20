import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DAY,
  authHeaders,
  createTestApp,
  createTrip,
  createUser,
  type TestContext,
} from './helpers.js';

const DRIVER = 5_300_001n;
const RIDER = 5_300_002n;
const OTHER_RIDER = 5_300_003n;
const STRANGER = 5_300_004n;

describe('POST /api/reviews', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    for (const vkUserId of [DRIVER, RIDER, OTHER_RIDER, STRANGER]) {
      await createUser(ctx.prisma, vkUserId);
    }
  });

  afterAll(async () => {
    const people = [DRIVER, RIDER, OTHER_RIDER, STRANGER];
    await ctx.prisma.review.deleteMany({ where: { authorVkId: { in: people } } });
    await ctx.prisma.tripRequest.deleteMany({ where: { userVkId: { in: people } } });
    await ctx.prisma.trip.deleteMany({ where: { authorVkId: { in: people } } });
    await ctx.prisma.user.deleteMany({ where: { vkUserId: { in: people } } });
    await ctx.close();
  });

  /** Завершённая поездка, в которой RIDER — принятый пассажир. */
  const completedTrip = async (): Promise<string> => {
    const tripId = await createTrip(ctx.prisma, {
      authorVkId: DRIVER,
      seatsTotal: 3,
      seatsLeft: 2,
      status: 'COMPLETED',
      departAt: new Date(Date.now() - 2 * DAY),
    });
    await ctx.prisma.tripRequest.create({
      data: { tripId, userVkId: RIDER, status: 'ACCEPTED' },
    });
    // Отклонённый пассажир участником не считается.
    await ctx.prisma.tripRequest.create({
      data: { tripId, userVkId: OTHER_RIDER, status: 'DECLINED' },
    });
    return tripId;
  };

  const postReview = (
    vkUserId: bigint,
    payload: Record<string, unknown>,
  ) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/reviews',
      headers: authHeaders(vkUserId),
      payload,
    });

  it('участник завершённой поездки оставляет отзыв, рейтинг пересчитывается', async () => {
    const tripId = await completedTrip();

    const response = await postReview(RIDER, {
      tripId,
      targetVkId: DRIVER.toString(),
      rating: 5,
      text: 'Доехали спокойно и вовремя.',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      rating: 5,
      author: { vkUserId: RIDER.toString() },
      target: { vkUserId: DRIVER.toString() },
    });

    const driver = await ctx.prisma.user.findUniqueOrThrow({ where: { vkUserId: DRIVER } });
    expect(driver.ratingCount).toBe(1);
    expect(driver.ratingAvg).toBe(5);

    // Второй отзыв по другой поездке двигает среднюю.
    const secondTripId = await completedTrip();
    const second = await postReview(RIDER, {
      tripId: secondTripId,
      targetVkId: DRIVER.toString(),
      rating: 3,
    });
    expect(second.statusCode).toBe(201);

    const updated = await ctx.prisma.user.findUniqueOrThrow({ where: { vkUserId: DRIVER } });
    expect(updated.ratingCount).toBe(2);
    expect(updated.ratingAvg).toBe(4);
  });

  it('по незавершённой поездке отзыв оставить нельзя', async () => {
    const tripId = await createTrip(ctx.prisma, { authorVkId: DRIVER, seatsTotal: 2 });
    await ctx.prisma.tripRequest.create({
      data: { tripId, userVkId: RIDER, status: 'ACCEPTED' },
    });

    const response = await postReview(RIDER, {
      tripId,
      targetVkId: DRIVER.toString(),
      rating: 5,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'TRIP_NOT_COMPLETED' } });
    expect(await ctx.prisma.review.count({ where: { tripId } })).toBe(0);
  });

  it('по отменённой поездке отзыв оставить нельзя', async () => {
    const tripId = await createTrip(ctx.prisma, {
      authorVkId: DRIVER,
      status: 'CANCELLED',
    });
    await ctx.prisma.tripRequest.create({
      data: { tripId, userVkId: RIDER, status: 'ACCEPTED' },
    });

    const response = await postReview(RIDER, {
      tripId,
      targetVkId: DRIVER.toString(),
      rating: 4,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'TRIP_NOT_COMPLETED' } });
  });

  it('дважды одному и тому же адресату по одной поездке — нельзя', async () => {
    const tripId = await completedTrip();

    const first = await postReview(RIDER, {
      tripId,
      targetVkId: DRIVER.toString(),
      rating: 5,
    });
    expect(first.statusCode).toBe(201);

    const second = await postReview(RIDER, {
      tripId,
      targetVkId: DRIVER.toString(),
      rating: 1,
    });

    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: { code: 'ALREADY_REVIEWED' } });
    expect(await ctx.prisma.review.count({ where: { tripId, authorVkId: RIDER } })).toBe(1);
  });

  it('не участник поездки отзыв оставить не может', async () => {
    const tripId = await completedTrip();

    const response = await postReview(STRANGER, {
      tripId,
      targetVkId: DRIVER.toString(),
      rating: 5,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_A_PARTICIPANT' } });
  });

  it('отклонённый пассажир участником не считается', async () => {
    const tripId = await completedTrip();

    const response = await postReview(OTHER_RIDER, {
      tripId,
      targetVkId: DRIVER.toString(),
      rating: 5,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_A_PARTICIPANT' } });
  });

  it('адресат отзыва тоже должен быть участником', async () => {
    const tripId = await completedTrip();

    const response = await postReview(RIDER, {
      tripId,
      targetVkId: STRANGER.toString(),
      rating: 5,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_A_PARTICIPANT' } });
  });

  it('отзыв самому себе запрещён', async () => {
    const tripId = await completedTrip();

    const response = await postReview(DRIVER, {
      tripId,
      targetVkId: DRIVER.toString(),
      rating: 5,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'SELF_REVIEW' } });
  });

  it('оценка вне диапазона 1..5 — 400', async () => {
    const tripId = await completedTrip();

    for (const rating of [0, 6, -1]) {
      const response = await postReview(RIDER, {
        tripId,
        targetVkId: DRIVER.toString(),
        rating,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
  });

  it('профиль отдаёт рейтинг, завершённые поездки и отзывы', async () => {
    const tripId = await completedTrip();
    await postReview(RIDER, { tripId, targetVkId: DRIVER.toString(), rating: 5 });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/users/${DRIVER}`,
      headers: authHeaders(RIDER),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.user.vkUserId).toBe(DRIVER.toString());
    expect(body.completedTripsCount).toBeGreaterThan(0);
    expect(body.reviews.length).toBeGreaterThan(0);
    expect(body.user.ratingCount).toBe(body.reviews.length);
  });
});
