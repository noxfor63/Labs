/**
 * Сквозная проверка площадки Telegram: от заголовка до строки в базе.
 *
 * Отдельно от telegram-init-data.test.ts: там проверяется алгоритм
 * подписи, здесь — что приложение действительно пускает такого
 * пользователя, заводит его в той же таблице и даёт ему работать наравне
 * с пришедшими из ВКонтакте.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ORENBURG, SOL_ILETSK, nextDepartSlot } from '@vk-rideshare/shared';

import {
  authHeaders,
  createTestApp,
  createUser,
  makeEnv,
  telegramHeaders,
  type TestContext,
} from './helpers.js';

const TG_ID = 880_000_001;
const VK_ID = 5_900_001n;

describe('площадка Telegram', () => {
  let ctx: TestContext;
  let tgUserId: string;
  let vkUserInternalId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    vkUserInternalId = await createUser(ctx.prisma, VK_ID);
  });

  afterAll(async () => {
    const people = [tgUserId, vkUserInternalId].filter((id) => id !== undefined);
    await ctx.prisma.tripRequest.deleteMany({ where: { userId: { in: people } } });
    await ctx.prisma.trip.deleteMany({ where: { authorId: { in: people } } });
    await ctx.prisma.user.deleteMany({ where: { id: { in: people } } });
    await ctx.close();
  });

  it('заводит пользователя по подписанному initData', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/session',
      headers: telegramHeaders({ id: TG_ID, first_name: 'Рустам', last_name: 'Тележный' }),
      payload: { privacyAccepted: true },
    });

    expect(response.statusCode).toBe(200);
    const user = response.json().user;
    tgUserId = user.id;

    // Идентификатор площадки лёг в свою колонку, чужая осталась пустой.
    expect(user.tgUserId).toBe(String(TG_ID));
    expect(user.vkUserId).toBeNull();
    expect(user.firstName).toBe('Рустам');
  });

  it('имя берёт из подписи, а не из тела запроса', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/session',
      headers: telegramHeaders({ id: TG_ID, first_name: 'Рустам', last_name: 'Тележный' }),
      // Тело можно подделать, подпись — нет. Выигрывает подпись.
      payload: { privacyAccepted: true, firstName: 'Самозванец', lastName: 'Поддельный' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.firstName).toBe('Рустам');
    expect(response.json().user.lastName).toBe('Тележный');
  });

  it('пользователь Telegram создаёт поездку, и её видно из ВКонтакте', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: telegramHeaders({ id: TG_ID }),
      payload: {
        role: 'DRIVER',
        fromCity: ORENBURG,
        toCity: SOL_ILETSK,
        departAt: nextDepartSlot(new Date(Date.now() + 4 * 24 * 60 * 60 * 1000)).toISOString(),
        seatsTotal: 3,
        priceRub: 650,
      },
    });
    expect(created.statusCode).toBe(201);
    const tripId = created.json().id;

    // Тот же маршрут, но запрос из ВКонтакте: лента у площадок общая.
    const seen = await ctx.app.inject({
      method: 'GET',
      url: `/api/trips/${tripId}`,
      headers: authHeaders(VK_ID),
    });

    expect(seen.statusCode).toBe(200);
    const body = seen.json();
    expect(body.author.tgUserId).toBe(String(TG_ID));
    expect(body.author.vkUserId).toBeNull();
    expect(body.isAuthor).toBe(false);
  });

  it('чужая подпись не пускает', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/session',
      headers: telegramHeaders({ id: TG_ID }, { botToken: '7000000000:ЧужойТокен' }),
      payload: { privacyAccepted: true },
    });

    expect(response.statusCode).toBe(401);
  });

  it('без настроенного токена бота площадка выключена, а не открыта', async () => {
    const offline = await createTestApp({ env: makeEnv({ TELEGRAM_BOT_TOKEN: '' }) });
    try {
      const response = await offline.app.inject({
        method: 'POST',
        url: '/api/session',
        headers: telegramHeaders({ id: TG_ID }),
        payload: { privacyAccepted: true },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.message).toMatch(/не настроена/i);
    } finally {
      await offline.close();
    }
  });
});
