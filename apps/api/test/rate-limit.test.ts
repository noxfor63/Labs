import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authHeaders, createTestApp, createUser, type TestContext } from './helpers.js';

const AUTHOR = 5_500_001n;

describe('rate limit на запись', () => {
  let ctx: TestContext;
  let authorId: string;

  beforeAll(async () => {
    // Порог опущен до 2 запросов в минуту: проверяем механизм, а не цифру.
    ctx = await createTestApp({ rateLimit: { max: 2, timeWindow: '1 minute' } });
    authorId = await createUser(ctx.prisma, AUTHOR);
  });

  afterAll(async () => {
    await ctx.prisma.trip.deleteMany({ where: { authorId } });
    await ctx.prisma.user.deleteMany({ where: { id: authorId } });
    await ctx.close();
  });

  it('превышение лимита даёт 429 с кодом RATE_LIMITED', async () => {
    const send = () =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/session',
        headers: authHeaders(AUTHOR),
        payload: { privacyAccepted: true, firstName: 'Тест', lastName: 'Тестов' },
      });

    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);

    const third = await send();
    expect(third.statusCode).toBe(429);
    expect(third.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });

  it('чтение лимитом не ограничено', async () => {
    for (let index = 0; index < 5; index += 1) {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/trips?limit=1',
        headers: authHeaders(AUTHOR),
      });
      expect(response.statusCode).toBe(200);
    }
  });
});
