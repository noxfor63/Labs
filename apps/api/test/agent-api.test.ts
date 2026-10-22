/**
 * Адреса агента канала.
 *
 * Проверяется то, ради чего они сделаны такими: пускают только с ключом
 * агента, отдают то, что выкачено, и не отдают ничего личного — ни имён,
 * ни телефонов, ни идентификаторов, ни свободного текста.
 */
import { readFileSync } from 'node:fs';

import { TRIP_ROLE, TRIP_STATUS, nextDepartSlot } from '@vk-rideshare/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DAY,
  allocateVkIds,
  authHeaders,
  createTestApp,
  createTrip,
  createUsers,
  makeEnv,
  type TestContext,
} from './helpers.js';

const TOKEN = 'agent-test-token-0123456789abcdef0123456789';
const bearer = { authorization: `Bearer ${TOKEN}` };

const packageVersion = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

/** Поля, которые агенту разрешено видеть. Всё остальное — утечка. */
const ALLOWED_TRIP_FIELDS = [
  'departAt',
  'fromCity',
  'priceRub',
  'role',
  'seatsLeft',
  'seatsTotal',
  'toCity',
].sort();

describe('адреса агента канала', () => {
  let ctx: TestContext;
  const [authorVk] = allocateVkIds(1, 9_400_000);
  const tripIds: string[] = [];
  let userIds: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp({ env: makeEnv({ AGENT_API_TOKEN: TOKEN }) });
    const users = await createUsers(ctx.prisma, [authorVk!]);
    userIds = users.all;
    const authorId = users.id(authorVk!);

    // Живая поездка завтра, с личными подробностями, которых агент видеть не должен.
    const soon = await createTrip(ctx.prisma, {
      authorId,
      departAt: nextDepartSlot(new Date(Date.now() + DAY)),
    });
    await ctx.prisma.trip.update({
      where: { id: soon },
      data: { comment: 'Звоните +79990001122', fromPoint: 'у дома Петровых', carModel: 'Lada' },
    });
    tripIds.push(soon);
    // За пределами окна, отменённая и прошедшая — в выдачу не попадают.
    tripIds.push(
      await createTrip(ctx.prisma, {
        authorId,
        departAt: nextDepartSlot(new Date(Date.now() + 10 * DAY)),
      }),
      await createTrip(ctx.prisma, {
        authorId,
        status: TRIP_STATUS.CANCELLED,
        departAt: nextDepartSlot(new Date(Date.now() + DAY)),
      }),
      await createTrip(ctx.prisma, {
        authorId,
        role: TRIP_ROLE.PASSENGER,
        departAt: nextDepartSlot(new Date(Date.now() + 2 * DAY)),
      }),
    );
  });

  afterAll(async () => {
    await ctx.prisma.trip.deleteMany({ where: { id: { in: tripIds } } });
    await ctx.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await ctx.close();
  });

  it('без ключа не пускает', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/agent/status' });
    expect(response.statusCode).toBe(401);
  });

  it('с чужим ключом не пускает', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/agent/status',
      headers: { authorization: `Bearer ${TOKEN}x` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('подпись запуска пользователя ключом агента не является', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/agent/trips',
      headers: authHeaders(authorVk!),
    });
    expect(response.statusCode).toBe(401);
  });

  it('говорит, какая версия выкачена и сколько живых поездок', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/agent/status',
      headers: bearer,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ version: string; commit: string | null; activeTrips: number }>();
    expect(body.version).toBe(packageVersion);
    // В клоне репозитория коммит известен; вне его — честный null.
    expect(body.commit === null || /^[0-9a-f]{40}$/.test(body.commit)).toBe(true);
    expect(body.activeTrips).toBeGreaterThanOrEqual(3);
  });

  it('отдаёт живые поездки окна и ни одного личного поля', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/agent/trips?days=4',
      headers: bearer,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ days: number; items: Record<string, unknown>[] }>();
    expect(body.days).toBe(4);

    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(ALLOWED_TRIP_FIELDS);
      expect(new Date(String(item['departAt'])).getTime()).toBeLessThan(Date.now() + 4 * DAY);
    }
    // Телефон из комментария и место у чужого дома не просочились ни в каком виде.
    const raw = response.body;
    expect(raw).not.toContain('79990001122');
    expect(raw).not.toContain('Петровых');
    expect(raw).not.toContain('Тест'); // имя автора из фикстуры
  });

  it('держит окно в разумных пределах', async () => {
    for (const days of ['0', '15', 'много']) {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/agent/trips?days=${days}`,
        headers: bearer,
      });
      expect(response.statusCode).toBe(400);
    }
  });
});

describe('без ключа агента', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ env: makeEnv({ AGENT_API_TOKEN: '' }) });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('адресов агента нет вовсе', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/agent/status',
      headers: bearer,
    });
    expect(response.statusCode).toBe(404);
  });

  it('/health называет версию', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ version: string }>().version).toBe(packageVersion);
  });
});

describe('ключ агента в настройках', () => {
  it('короткий ключ не принимается', () => {
    expect(() => makeEnv({ AGENT_API_TOKEN: 'short' })).toThrow(/32/);
  });
});
