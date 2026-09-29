/**
 * Автозакрытие поездок, время которых прошло.
 *
 * Проверяем три вещи: что уборка не трогает живое, что закрывает
 * просроченное правильным статусом и что её можно звать повторно.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  REQUEST_STATUS,
  TRIP_EXPIRY_GRACE_MINUTES,
  TRIP_STATUS,
  nextDepartSlot,
} from '@vk-rideshare/shared';

import { createPrismaClient } from '../src/db.js';
import { sweepExpiredTrips } from '../src/lib/expiry.js';
import { allocateVkIds, createTrip, createUser, HOUR } from './helpers.js';
import { TEST_DATABASE_URL } from './global-setup.js';

const GRACE_MS = TRIP_EXPIRY_GRACE_MINUTES * 60 * 1000;

let prisma: PrismaClient;
let authorVkId: bigint;
let passengerVkId: bigint;

beforeAll(async () => {
  prisma = createPrismaClient(TEST_DATABASE_URL);
  const [author, passenger] = allocateVkIds(2, 7_100_000);
  authorVkId = await createUser(prisma, author!);
  passengerVkId = await createUser(prisma, passenger!);
});

afterAll(async () => {
  const people = [authorVkId, passengerVkId];
  await prisma.tripRequest.deleteMany({ where: { userVkId: { in: people } } });
  await prisma.trip.deleteMany({ where: { authorVkId: { in: people } } });
  await prisma.user.deleteMany({ where: { vkUserId: { in: people } } });
  await prisma.$disconnect();
});

/**
 * Время выезда по сетке получасов.
 *
 * Выравнивание обязательно даже для фикстур, которые сами по себе его не
 * требуют: тестовая база общая, и будущая поездка из этого файла попадает
 * в ленту, которую параллельно проверяет trips-search.test.ts — а он
 * требует сетку от всех поездок ленты.
 */
const slot = (offsetMs: number): Date => nextDepartSlot(new Date(Date.now() + offsetMs));

/** «Сейчас» для уборки: настолько позже выезда, что запас уже израсходован. */
const afterGrace = (departAt: Date): Date => new Date(departAt.getTime() + GRACE_MS + 60_000);

describe('уборка просроченных поездок', () => {
  it('поездку без принятых пассажиров отменяет', async () => {
    const departAt = slot(-10 * HOUR);
    const tripId = await createTrip(prisma, { authorVkId, departAt });

    await sweepExpiredTrips(prisma, { now: afterGrace(departAt) });

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.status).toBe(TRIP_STATUS.CANCELLED);
  });

  it('поездку с принятым пассажиром завершает — чтобы открыть отзывы', async () => {
    const departAt = slot(-10 * HOUR);
    const tripId = await createTrip(prisma, { authorVkId, departAt });
    await prisma.tripRequest.create({
      data: { tripId, userVkId: passengerVkId, status: REQUEST_STATUS.ACCEPTED },
    });

    await sweepExpiredTrips(prisma, { now: afterGrace(departAt) });

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.status).toBe(TRIP_STATUS.COMPLETED);
  });

  it('оставшиеся без ответа отклики отменяет, а не отклоняет', async () => {
    const departAt = slot(-10 * HOUR);
    const tripId = await createTrip(prisma, { authorVkId, departAt });
    const request = await prisma.tripRequest.create({
      data: { tripId, userVkId: passengerVkId, status: REQUEST_STATUS.PENDING },
    });

    await sweepExpiredTrips(prisma, { now: afterGrace(departAt) });

    const updated = await prisma.tripRequest.findUniqueOrThrow({ where: { id: request.id } });
    // Не DECLINED: автор их не отклонял, просто вышло время. Врать
    // о причине в истории нельзя — её читает и сам пользователь.
    expect(updated.status).toBe(REQUEST_STATUS.CANCELLED);
  });

  it('внутри запаса времени поездку не трогает', async () => {
    const departAt = slot(-10 * HOUR);
    const tripId = await createTrip(prisma, { authorVkId, departAt });

    // Выезд уже прошёл, но запас ещё не вышел.
    await sweepExpiredTrips(prisma, {
      now: new Date(departAt.getTime() + GRACE_MS - 60_000),
    });

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.status).toBe(TRIP_STATUS.ACTIVE);
  });

  it('будущую поездку не трогает', async () => {
    const departAt = slot(10 * HOUR);
    const tripId = await createTrip(prisma, { authorVkId, departAt });

    await sweepExpiredTrips(prisma, { now: new Date() });

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.status).toBe(TRIP_STATUS.ACTIVE);
  });

  it('не перетирает статус, который автор выставил сам', async () => {
    const departAt = slot(-10 * HOUR);
    const tripId = await createTrip(prisma, {
      authorVkId,
      departAt,
      status: TRIP_STATUS.CANCELLED,
    });

    await sweepExpiredTrips(prisma, { now: afterGrace(departAt) });

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.status).toBe(TRIP_STATUS.CANCELLED);
  });

  it('повторный проход ничего не находит', async () => {
    const departAt = slot(-10 * HOUR);
    await createTrip(prisma, { authorVkId, departAt });
    const now = afterGrace(departAt);

    const first = await sweepExpiredTrips(prisma, { now });
    expect(first.completed + first.cancelled).toBeGreaterThan(0);

    const second = await sweepExpiredTrips(prisma, { now });
    expect(second).toEqual({ completed: 0, cancelled: 0, cancelledRequests: 0 });
  });
});
