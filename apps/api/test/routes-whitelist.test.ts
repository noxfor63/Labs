/**
 * Белый список направлений на сервере.
 *
 * Модель радиальная: поездка идёт либо в Оренбург, либо из Оренбурга.
 * Проверка стоит на сервере, а не только в интерфейсе, по обычной
 * причине: интерфейс можно обойти, отправив запрос напрямую, и тогда в
 * ленте появится поездка по маршруту, которого не существует.
 *
 * Отдельно проверяется фильтр поиска. Раньше пара в нём не
 * проверялась вовсе, и запрос «Акбулак → Соль-Илецк» молча отдавал
 * пустую ленту — человек видел «поездок нет» вместо «такого направления
 * не бывает» и ждал, что они появятся.
 */
import {
  AKBULAK,
  ALEKSANDROVKA,
  ILEK,
  ORENBURG,
  ROUTES,
  SOL_ILETSK,
  nextDepartSlot,
} from '@vk-rideshare/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DAY, authHeaders, createTestApp, createUser, type TestContext } from './helpers.js';

const AUTHOR = 6_100_001n;

let ctx: TestContext;
let authorId: string;

const payload = (fromCity: string, toCity: string): Record<string, unknown> => ({
  role: 'DRIVER',
  fromCity,
  toCity,
  departAt: nextDepartSlot(new Date(Date.now() + 2 * DAY)).toISOString(),
  seatsTotal: 3,
  priceRub: 600,
});

const create = (fromCity: string, toCity: string) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/trips',
    headers: authHeaders(AUTHOR),
    payload: payload(fromCity, toCity),
  });

const search = (from: string, to: string) =>
  ctx.app.inject({
    method: 'GET',
    url: `/api/trips?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    headers: authHeaders(AUTHOR),
  });

beforeAll(async () => {
  ctx = await createTestApp();
  authorId = await createUser(ctx.prisma, AUTHOR);
  await ctx.prisma.user.update({
    where: { id: authorId },
    data: { phone: '+79990000123' },
  });
});

afterEach(async () => {
  await ctx.prisma.trip.deleteMany({ where: { authorId } });
});

afterAll(async () => {
  await ctx.prisma.trip.deleteMany({ where: { authorId } });
  await ctx.prisma.user.deleteMany({ where: { id: authorId } });
  await ctx.close();
});

describe('создание поездки', () => {
  it('принимает все восемь направлений справочника', async () => {
    for (const route of ROUTES) {
      const response = await create(route.from, route.to);
      expect(response.statusCode, `${route.from} → ${route.to}`).toBe(201);
    }

    expect(await ctx.prisma.trip.count({ where: { authorId } })).toBe(ROUTES.length);
  });

  it('отклоняет спица→спица, включая удалённую пару Акбулак↔Соль-Илецк', async () => {
    const pairs: [string, string][] = [
      [AKBULAK, SOL_ILETSK],
      [SOL_ILETSK, AKBULAK],
      [ILEK, AKBULAK],
      [ALEKSANDROVKA, SOL_ILETSK],
    ];

    for (const [from, to] of pairs) {
      const response = await create(from, to);

      expect(response.statusCode, `${from} → ${to}`).toBe(400);
      expect(response.json().error.message).toMatch(/только в Оренбург или из Оренбурга/i);
    }

    // Главное: ни одна такая поездка не завелась.
    expect(await ctx.prisma.trip.count({ where: { authorId } })).toBe(0);
  });

  it('отклоняет пункт вне справочника', async () => {
    const response = await create(ORENBURG, 'Самара');

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/списке направлений/i);
    expect(await ctx.prisma.trip.count({ where: { authorId } })).toBe(0);
  });

  it('отклоняет поездку из пункта в него же', async () => {
    const response = await create(ORENBURG, ORENBURG);

    expect(response.statusCode).toBe(400);
  });
});

describe('фильтр поиска', () => {
  it('принимает направления справочника', async () => {
    for (const route of ROUTES) {
      const response = await search(route.from, route.to);
      expect(response.statusCode, `${route.from} → ${route.to}`).toBe(200);
    }
  });

  it('отклоняет спица→спица, а не отдаёт пустую ленту', async () => {
    const response = await search(AKBULAK, SOL_ILETSK);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/только в Оренбург или из Оренбурга/i);
  });

  it('отклоняет пункт вне справочника', async () => {
    const response = await search(ORENBURG, 'Самара');

    expect(response.statusCode).toBe(400);
  });

  it('один пункт без второго по-прежнему допустим', async () => {
    const onlyFrom = await ctx.app.inject({
      method: 'GET',
      url: `/api/trips?from=${encodeURIComponent(AKBULAK)}`,
      headers: authHeaders(AUTHOR),
    });

    expect(onlyFrom.statusCode).toBe(200);
  });
});
