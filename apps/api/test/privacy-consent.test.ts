/**
 * Согласие с политикой конфиденциальности.
 *
 * Правила мини-приложений требуют согласия **до** обработки персональных
 * данных. Проверка стоит на сервере, а не только на экране: запрос можно
 * отправить и мимо интерфейса, и тогда «согласие на экране» не значит
 * ничего.
 *
 * Главное, что здесь проверяется, — не код ответа, а отсутствие строки в
 * базе. Вернуть 403 и всё равно завести пользователя было бы ровно тем
 * нарушением, против которого эта проверка и написана.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { authHeaders, createTestApp, type TestContext } from './helpers.js';

const VK_USER_ID = 7_400_001n;

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterEach(async () => {
  await ctx.prisma.user.deleteMany({ where: { vkUserId: VK_USER_ID } });
});

afterAll(async () => {
  await ctx.close();
});

const post = (body: Record<string, unknown>) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/session',
    headers: authHeaders(VK_USER_ID),
    payload: body,
  });

const get = () =>
  ctx.app.inject({
    method: 'GET',
    url: '/api/session',
    headers: authHeaders(VK_USER_ID),
  });

const stored = () => ctx.prisma.user.findUnique({ where: { vkUserId: VK_USER_ID } });

describe('согласие с политикой конфиденциальности', () => {
  it('без согласия ничего не сохраняет и отвечает PRIVACY_NOT_ACCEPTED', async () => {
    const response = await post({ firstName: 'Иван', lastName: 'Иванов', city: 'Оренбург' });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('PRIVACY_NOT_ACCEPTED');
    // Самая важная строка файла: данных в базе не появилось.
    expect(await stored()).toBeNull();
  });

  it('номер телефона без согласия тоже не сохраняется', async () => {
    const response = await post({ phone: '+79991234567' });

    expect(response.statusCode).toBe(403);
    expect(await stored()).toBeNull();
  });

  it('GET /api/session ничего не создаёт и сообщает, что согласия нет', async () => {
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user: null, privacyAcceptedAt: null, isModerator: false });
    expect(await stored()).toBeNull();
  });

  it('с согласием заводит пользователя и возвращает дату', async () => {
    const response = await post({ privacyAccepted: true, firstName: 'Иван' });

    expect(response.statusCode).toBe(200);
    expect(response.json().privacyAcceptedAt).toEqual(expect.any(String));

    const user = await stored();
    expect(user?.privacyAcceptedAt).toBeInstanceOf(Date);
    expect(user?.firstName).toBe('Иван');
  });

  it('повторное «принимаю» не переписывает момент согласия', async () => {
    await post({ privacyAccepted: true, firstName: 'Иван' });
    const first = (await stored())?.privacyAcceptedAt;

    await new Promise((resolve) => setTimeout(resolve, 20));
    await post({ privacyAccepted: true, firstName: 'Иван' });
    const second = (await stored())?.privacyAcceptedAt;

    expect(second?.getTime()).toBe(first?.getTime());
  });

  it('после согласия обычные запросы идут без него', async () => {
    await post({ privacyAccepted: true, firstName: 'Иван' });
    const response = await post({ phone: '+79991234567' });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.phone).toBe('+79991234567');
  });

  it('GET /api/session после согласия отдаёт профиль и дату', async () => {
    await post({ privacyAccepted: true, firstName: 'Иван' });
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.json().user.firstName).toBe('Иван');
    expect(response.json().privacyAcceptedAt).toEqual(expect.any(String));
  });
});
