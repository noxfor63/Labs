import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  TEST_SECRET,
  authHeaders,
  createTestApp,
  launchParams,
  makeEnv,
  type TestContext,
} from './helpers.js';

describe('авторизация по launch-параметрам', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('без заголовка X-Launch-Params — 401', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/trips' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('с пустым заголовком — 401', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/trips',
      headers: { 'x-launch-params': '   ' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('с испорченной подписью — 401', async () => {
    const broken = launchParams(1_000_001).replace(/sign=.*/, 'sign=aaaaaaaaaaaaaaaaaaaaaaa');
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/trips',
      headers: { 'x-launch-params': broken },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toMatch(/подпись/i);
  });

  it('подписанная чужим ключом строка — 401', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/trips',
      headers: authHeaders(1_000_001, { secret: 'ключ-злоумышленника' }),
    });

    expect(response.statusCode).toBe(401);
  });

  it('с vk_ts старше суток — 401', async () => {
    const stale = Math.floor(Date.now() / 1000) - 25 * 60 * 60;
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/trips',
      headers: authHeaders(1_000_001, { ts: stale }),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toMatch(/устарел/i);
  });

  it('с корректной подписью — 200', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/trips?limit=1',
      headers: authHeaders(1_000_001),
    });

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json().items)).toBe(true);
  });

  it('/health доступен без launch-параметров', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });
});

describe('моковые launch-параметры', () => {
  const mock = 'vk_user_id=1000001&vk_app_id=51234567&vk_platform=desktop_web';

  it('вне продакшена открывают приложение без заголовка', async () => {
    const ctx = await createTestApp({
      env: makeEnv({ NODE_ENV: 'development', VK_MOCK_LAUNCH_PARAMS: mock }),
    });

    try {
      const response = await ctx.app.inject({ method: 'GET', url: '/api/trips?limit=1' });
      expect(response.statusCode).toBe(200);
    } finally {
      await ctx.close();
    }
  });

  it('при NODE_ENV=production обнуляются в конфигурации', () => {
    const env = makeEnv({
      NODE_ENV: 'production',
      VK_MOCK_LAUNCH_PARAMS: mock,
      VK_APP_SECRET: TEST_SECRET,
    });

    expect(env.VK_MOCK_LAUNCH_PARAMS).toBe(mock);
    // Предохранитель №1: значение, которое реально читает хук, пустое.
    expect(env.mockLaunchParams).toBe('');
    expect(env.isProduction).toBe(true);
  });

  it('при NODE_ENV=production запрос без заголовка получает 401', async () => {
    const ctx = await createTestApp({
      env: makeEnv({
        NODE_ENV: 'production',
        VK_MOCK_LAUNCH_PARAMS: mock,
        VK_APP_SECRET: TEST_SECRET,
      }),
    });

    try {
      const response = await ctx.app.inject({ method: 'GET', url: '/api/trips' });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    } finally {
      await ctx.close();
    }
  });

  it('в продакшене без VK_APP_SECRET конфигурация вообще не собирается', () => {
    expect(() => makeEnv({ NODE_ENV: 'production', VK_APP_SECRET: '' })).toThrow(
      /VK_APP_SECRET/,
    );
  });
});
