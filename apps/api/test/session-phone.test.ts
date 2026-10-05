/**
 * Номер телефона в профиле.
 *
 * Клиент приводит номер к общей форме перед отправкой, но запрос можно
 * послать и мимо клиента, поэтому нормализация обязана быть на сервере.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authHeaders, createTestApp, type TestContext } from './helpers.js';

const VK_USER_ID = 7_300_001n;

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx.prisma.user.deleteMany({ where: { vkUserId: VK_USER_ID } });
  await ctx.close();
});

/** Согласие подставляется всем запросам: этот файл проверяет номер, а не его. */
const session = (body: Record<string, unknown>) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/session',
    headers: authHeaders(VK_USER_ID),
    payload: { privacyAccepted: true, ...body },
  });

describe('POST /api/session — номер телефона', () => {
  it('приводит номер к +7XXXXXXXXXX независимо от записи', async () => {
    for (const raw of ['8 (999) 123-45-67', '+7 999 123 45 67', '9991234567']) {
      const response = await session({ firstName: 'Тест', phone: raw });
      expect(response.statusCode, raw).toBe(200);
      expect(response.json().user.phone, raw).toBe('+79991234567');
    }
  });

  it('отклоняет то, что не похоже на мобильный', async () => {
    for (const raw of ['123', '+7 495 123 45 67', 'позвоните мне']) {
      const response = await session({ firstName: 'Тест', phone: raw });
      expect(response.statusCode, raw).toBe(400);
    }
  });

  it('пустая строка стирает номер', async () => {
    await session({ firstName: 'Тест', phone: '+79991234567' });
    const response = await session({ firstName: 'Тест', phone: '' });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.phone).toBeNull();
  });

  it('отсутствие поля не трогает сохранённый номер', async () => {
    await session({ firstName: 'Тест', phone: '+79997654321' });
    const response = await session({ firstName: 'Тест' });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.phone).toBe('+79997654321');
  });

  it('номер виден в профиле пользователя', async () => {
    // Профиль запрашивается по внутреннему id, а не по идентификатору
    // ВКонтакте: у человека он один на все площадки. Сам id отдаётся
    // в ответе на создание сессии.
    const created = await session({ firstName: 'Тест', phone: '+79991112233' });
    const userId = created.json().user.id as string;

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/users/${userId}`,
      headers: authHeaders(VK_USER_ID),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.phone).toBe('+79991112233');
  });
});
