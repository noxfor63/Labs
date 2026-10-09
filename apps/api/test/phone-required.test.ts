/**
 * Номер обязателен тому, с кем иначе не связаться.
 *
 * У пришедшего из ВКонтакте всегда остаётся страница: не оставил номер —
 * напишут туда. У пришедшего из Telegram запасного пути нет: диалог
 * открывается только по @username, он есть не у всех, а в России Telegram
 * работает с перебоями, и договариваются звонком.
 *
 * Поэтому проверка стоит на сервере, а не только на экране: иначе
 * достаточно отправить запрос мимо интерфейса, и в ленте появится
 * поездка, автор которой недоступен. Для попутчика это хуже, чем
 * отсутствие поездки, — он потратит время на звонок, которого нет.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ORENBURG, SOL_ILETSK, nextDepartSlot } from '@vk-rideshare/shared';

import {
  DAY,
  authHeaders,
  createTestApp,
  createTrip,
  createUser,
  telegramHeaders,
  type TestContext,
} from './helpers.js';

const TG_ID = 881_000_001;
const VK_ID = 6_000_001n;

const tripPayload = (): Record<string, unknown> => ({
  role: 'DRIVER',
  fromCity: ORENBURG,
  toCity: SOL_ILETSK,
  departAt: nextDepartSlot(new Date(Date.now() + 2 * DAY)).toISOString(),
  seatsTotal: 3,
  priceRub: 600,
});

describe('номер телефона как условие', () => {
  let ctx: TestContext;
  let vkUserInternalId: string;
  let tgUserInternalId: string;

  const startTelegramSession = async (phone?: string): Promise<string> => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/session',
      headers: telegramHeaders({ id: TG_ID, first_name: 'Рустам', username: 'rustam_driver' }),
      payload: phone === undefined ? { privacyAccepted: true } : { privacyAccepted: true, phone },
    });
    expect(response.statusCode).toBe(200);
    return response.json().user.id as string;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    vkUserInternalId = await createUser(ctx.prisma, VK_ID);
    tgUserInternalId = await startTelegramSession();
  });

  afterEach(async () => {
    const people = [vkUserInternalId, tgUserInternalId];
    await ctx.prisma.tripRequest.deleteMany({ where: { userId: { in: people } } });
    await ctx.prisma.trip.deleteMany({ where: { authorId: { in: people } } });
    // Номер снимаем: каждый тест начинается с «связи нет».
    await ctx.prisma.user.update({ where: { id: tgUserInternalId }, data: { phone: null } });
  });

  afterAll(async () => {
    const people = [vkUserInternalId, tgUserInternalId];
    await ctx.prisma.tripRequest.deleteMany({ where: { userId: { in: people } } });
    await ctx.prisma.trip.deleteMany({ where: { authorId: { in: people } } });
    await ctx.prisma.user.deleteMany({ where: { id: { in: people } } });
    await ctx.close();
  });

  it('из Telegram без номера поездка не создаётся', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: telegramHeaders({ id: TG_ID, first_name: 'Рустам', username: 'rustam_driver' }),
      payload: tripPayload(),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('PHONE_REQUIRED');
    // Главное: объявления в ленте не появилось.
    expect(await ctx.prisma.trip.count({ where: { authorId: tgUserInternalId } })).toBe(0);
  });

  it('из Telegram без номера нельзя и откликнуться', async () => {
    const tripId = await createTrip(ctx.prisma, { authorId: vkUserInternalId });

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/trips/${tripId}/requests`,
      headers: telegramHeaders({ id: TG_ID, first_name: 'Рустам', username: 'rustam_driver' }),
      payload: { message: 'Возьмёте?' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('PHONE_REQUIRED');
    expect(await ctx.prisma.tripRequest.count({ where: { userId: tgUserInternalId } })).toBe(0);
  });

  it('с номером всё работает как раньше', async () => {
    await startTelegramSession('+79991234567');

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: telegramHeaders({ id: TG_ID, first_name: 'Рустам', username: 'rustam_driver' }),
      payload: tripPayload(),
    });
    expect(created.statusCode).toBe(201);

    const tripId = await createTrip(ctx.prisma, { authorId: vkUserInternalId });
    const responded = await ctx.app.inject({
      method: 'POST',
      url: `/api/trips/${tripId}/requests`,
      headers: telegramHeaders({ id: TG_ID, first_name: 'Рустам', username: 'rustam_driver' }),
      payload: {},
    });
    expect(responded.statusCode).toBe(201);
  });

  it('пришедшего из ВКонтакте это не касается: у него есть страница', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: authHeaders(VK_ID),
      payload: tripPayload(),
    });

    expect(response.statusCode).toBe(201);
  });

  it('снятый номер снова закрывает публикацию', async () => {
    await startTelegramSession('+79991234567');
    await startTelegramSession('');

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: telegramHeaders({ id: TG_ID, first_name: 'Рустам', username: 'rustam_driver' }),
      payload: tripPayload(),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('PHONE_REQUIRED');
  });
});
