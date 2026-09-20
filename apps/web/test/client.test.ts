import { LAUNCH_PARAMS_HEADER } from '@vk-rideshare/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError, api } from '../src/api/client.js';

const QUERY = 'vk_user_id=1000001&vk_app_id=51234567&sign=abc';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('клиент API', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState({}, '', `/?${QUERY}`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it('шлёт исходную строку запуска заголовком X-Launch-Params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], nextCursor: null }));
    vi.stubGlobal('fetch', fetchMock);

    await api.listTrips({});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers[LAUNCH_PARAMS_HEADER]).toBe(QUERY);
  });

  it('пустые и undefined фильтры в query-строку не попадают', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], nextCursor: null }));
    vi.stubGlobal('fetch', fetchMock);

    await api.listTrips({ from: 'Москва', to: undefined, limit: 20 });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain(`from=${encodeURIComponent('Москва')}`);
    expect(url).toContain('limit=20');
    expect(url).not.toContain('to=');
  });

  it('ошибку контракта разбирает в код и сообщение', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: 'NO_SEATS_LEFT', message: 'Мест нет' } }, 409),
      ),
    );

    await expect(api.respond('trip-1', null)).rejects.toMatchObject({
      code: 'NO_SEATS_LEFT',
      status: 409,
      message: 'Мест нет',
    });
  });

  it('сетевой сбой превращается в ошибку с флагом isNetwork', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const error = await api.listTrips({}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).isNetwork).toBe(true);
  });

  it('пишущий запрос уходит методом POST с JSON-телом', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'r1' }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await api.respond('trip-1', 'Возьмёте?');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/trips/trip-1/requests');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ message: 'Возьмёте?' });
  });
});
