/**
 * CORS: кому браузер разрешит читать ответы API.
 *
 * Адрес хостинга VK меняется на каждой боевой выкатке, поэтому он
 * разрешается шаблоном, а не точным совпадением. Тесты здесь стерегут
 * ровно одно: шаблон не должен оказаться шире, чем задумано.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authHeaders, createTestApp, makeEnv, TEST_APP_ID, type TestContext } from './helpers.js';

const ALLOWED_ORIGIN = 'https://app.example';

/** Адрес хостинга VK вида prod-app<ID>-<хэш>.pages-ac.vk-apps.ru. */
const hosting = (
  environment: string,
  appId: string = TEST_APP_ID,
  hash = '0a1b2c3d4e5f',
  domain = 'pages-ac',
): string => `https://${environment}-app${appId}-${hash}.${domain}.vk-apps.ru`;

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp({ env: makeEnv({ CORS_ORIGIN: ALLOWED_ORIGIN }) });
});

afterAll(async () => {
  await ctx.close();
});

/** Возвращает Access-Control-Allow-Origin для запроса с этим Origin. */
async function allowOriginHeader(
  origin: string,
  context: TestContext = ctx,
): Promise<string | undefined> {
  const response = await context.app.inject({
    method: 'GET',
    url: '/api/trips',
    headers: { ...authHeaders(1_000_001n), origin },
  });
  const header = response.headers['access-control-allow-origin'];
  return typeof header === 'string' ? header : undefined;
}

describe('CORS: разрешённые адреса', () => {
  it('точный адрес из CORS_ORIGIN', async () => {
    expect(await allowOriginHeader(ALLOWED_ORIGIN)).toBe(ALLOWED_ORIGIN);
  });

  it('боевой хостинг VK с любым хэшем', async () => {
    for (const hash of ['0a1b2c3d4e5f', 'a1b2c3d4e5f6', 'abcdef']) {
      const origin = hosting('prod', TEST_APP_ID, hash);
      expect(await allowOriginHeader(origin), origin).toBe(origin);
    }
  });

  it('тестовый хостинг VK — домен pages, а не pages-ac', async () => {
    const origin = hosting('stage', TEST_APP_ID, 'fedcba987654', 'pages');
    expect(await allowOriginHeader(origin)).toBe(origin);
  });
});

describe('CORS: отклонённые адреса', () => {
  it('чужое мини-приложение — другой app_id в имени хоста', async () => {
    expect(await allowOriginHeader(hosting('prod', '99999999'))).toBeUndefined();
  });

  it('домен-подделка, у которого наш адрес лишь в начале', async () => {
    const origin = `${hosting('prod')}.zloydomen.example`;
    expect(await allowOriginHeader(origin)).toBeUndefined();
  });

  it('домен-подделка, у которого наш адрес в середине', async () => {
    const origin = `https://zloydomen.example/${hosting('prod')}`;
    expect(await allowOriginHeader(origin)).toBeUndefined();
  });

  it('тот же хост без шифрования', async () => {
    expect(await allowOriginHeader(hosting('prod').replace('https://', 'http://'))).toBeUndefined();
  });

  it('хэш не шестнадцатеричный', async () => {
    expect(await allowOriginHeader(hosting('prod', TEST_APP_ID, 'zzzzzz'))).toBeUndefined();
  });

  it('посторонний сайт', async () => {
    expect(await allowOriginHeader('https://example.org')).toBeUndefined();
  });
});

describe('CORS: шаблон без VK_APP_ID', () => {
  it('не действует — разрешены только точные адреса', async () => {
    const other = await createTestApp({
      env: makeEnv({ CORS_ORIGIN: ALLOWED_ORIGIN, VK_APP_ID: '' }),
    });
    try {
      expect(await allowOriginHeader(hosting('prod'), other)).toBeUndefined();
      expect(await allowOriginHeader(ALLOWED_ORIGIN, other)).toBe(ALLOWED_ORIGIN);
    } finally {
      await other.close();
    }
  });
});
