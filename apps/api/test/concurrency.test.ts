/**
 * Конкурентное принятие откликов.
 *
 * Самое опасное место приложения: два принятия последнего места, пришедшие
 * одновременно. Защита — условный UPDATE ... WHERE "seatsLeft" > 0 внутри
 * транзакции: второй запрос встаёт на блокировке строки, после её снятия
 * Postgres перепроверяет условие на новой версии строки и не находит её.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authHeaders, createTestApp, createTrip, createUser, type TestContext } from './helpers.js';

const AUTHOR = 5_200_001n;
const RIDERS = [5_200_002n, 5_200_003n, 5_200_004n, 5_200_005n, 5_200_006n] as const;

describe('гонка за последним местом', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    await createUser(ctx.prisma, AUTHOR);
    for (const rider of RIDERS) {
      await createUser(ctx.prisma, rider);
    }
  });

  afterAll(async () => {
    await ctx.prisma.tripRequest.deleteMany({ where: { userVkId: { in: [...RIDERS] } } });
    await ctx.prisma.trip.deleteMany({ where: { authorVkId: AUTHOR } });
    await ctx.prisma.user.deleteMany({ where: { vkUserId: { in: [AUTHOR, ...RIDERS] } } });
    await ctx.close();
  });

  const setup = async (seatsTotal: number, riders: readonly bigint[]) => {
    const tripId = await createTrip(ctx.prisma, { authorVkId: AUTHOR, seatsTotal });
    const requestIds: string[] = [];
    for (const rider of riders) {
      const created = await ctx.prisma.tripRequest.create({
        data: { tripId, userVkId: rider },
      });
      requestIds.push(created.id);
    }
    return { tripId, requestIds };
  };

  const accept = (requestId: string) =>
    ctx.app.inject({
      method: 'PATCH',
      url: `/api/requests/${requestId}`,
      headers: authHeaders(AUTHOR),
      payload: { status: 'ACCEPTED' },
    });

  it('два одновременных принятия на одно место: одно проходит, второе получает 409', async () => {
    const { tripId, requestIds } = await setup(1, RIDERS.slice(0, 2));

    const responses = await Promise.all(requestIds.map(accept));
    const codes = responses.map((response) => response.statusCode).sort();

    expect(codes).toEqual([200, 409]);

    const failed = responses.find((response) => response.statusCode === 409);
    expect(failed?.json()).toMatchObject({ error: { code: 'NO_SEATS_LEFT' } });

    const trip = await ctx.prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.seatsLeft).toBe(0);
    expect(trip.seatsLeft).toBeGreaterThanOrEqual(0);

    const accepted = await ctx.prisma.tripRequest.count({
      where: { tripId, status: 'ACCEPTED' },
    });
    expect(accepted).toBe(1);
  });

  it('пять одновременных принятий на два места: ровно два принятых, seatsLeft = 0', async () => {
    const { tripId, requestIds } = await setup(2, RIDERS);

    const responses = await Promise.all(requestIds.map(accept));

    const ok = responses.filter((response) => response.statusCode === 200).length;
    const conflicts = responses.filter((response) => response.statusCode === 409).length;

    expect(ok).toBe(2);
    expect(conflicts).toBe(3);

    const trip = await ctx.prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.seatsLeft).toBe(0);

    const accepted = await ctx.prisma.tripRequest.count({
      where: { tripId, status: 'ACCEPTED' },
    });
    expect(accepted).toBe(2);

    // Отклонённые гонкой остаются PENDING — автор может вернуться к ним позже.
    const pending = await ctx.prisma.tripRequest.count({
      where: { tripId, status: 'PENDING' },
    });
    expect(pending).toBe(3);
  });

  it('seatsLeft не уходит ниже нуля ни при каком числе параллельных принятий', async () => {
    const { tripId, requestIds } = await setup(1, RIDERS);

    await Promise.all(requestIds.map(accept));

    const trip = await ctx.prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.seatsLeft).toBe(0);

    const negative = await ctx.prisma.trip.count({ where: { seatsLeft: { lt: 0 } } });
    expect(negative).toBe(0);
  });
});
