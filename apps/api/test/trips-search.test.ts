import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authHeaders, createTestApp, type TestContext } from './helpers.js';

const VIEWER = 1_000_001;

type TripItem = {
  id: string;
  fromCity: string;
  toCity: string;
  role: string;
  departAt: string;
  priceRub: number | null;
  seatsLeft: number;
  status: string;
};

describe('GET /api/trips — фильтры на сид-данных', () => {
  let ctx: TestContext;

  const fetchTrips = async (query: string): Promise<{ items: TripItem[]; nextCursor: string | null }> => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/trips${query}`,
      headers: authHeaders(VIEWER),
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  };

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('без фильтров отдаёт только будущие ACTIVE поездки', async () => {
    const { items } = await fetchTrips('?limit=50');

    expect(items.length).toBeGreaterThan(0);
    for (const trip of items) {
      expect(trip.status).toBe('ACTIVE');
      expect(new Date(trip.departAt).getTime()).toBeGreaterThan(Date.now());
    }

    // Завершённых и отменённых в ленте быть не может.
    const hidden = await ctx.prisma.trip.count({
      where: { status: { in: ['COMPLETED', 'CANCELLED'] } },
    });
    expect(hidden).toBeGreaterThan(0);
    const ids = new Set(items.map((item) => item.id));
    const hiddenRows = await ctx.prisma.trip.findMany({
      where: { status: { in: ['COMPLETED', 'CANCELLED'] } },
      select: { id: true },
    });
    for (const row of hiddenRows) {
      expect(ids.has(row.id)).toBe(false);
    }
  });

  it('фильтр «откуда» сужает выдачу и не пропускает чужие города', async () => {
    const all = await fetchTrips('?limit=50');
    const filtered = await fetchTrips(`?limit=50&from=${encodeURIComponent('Москва')}`);

    expect(filtered.items.length).toBeGreaterThan(0);
    expect(filtered.items.length).toBeLessThan(all.items.length);
    expect(filtered.items.every((trip) => trip.fromCity === 'Москва')).toBe(true);
  });

  it('фильтр «откуда + куда» сужает сильнее, чем один «откуда»', async () => {
    const byFrom = await fetchTrips(`?limit=50&from=${encodeURIComponent('Москва')}`);
    const byRoute = await fetchTrips(
      `?limit=50&from=${encodeURIComponent('Москва')}&to=${encodeURIComponent('Санкт-Петербург')}`,
    );

    expect(byRoute.items.length).toBeGreaterThan(0);
    expect(byRoute.items.length).toBeLessThan(byFrom.items.length);
    expect(
      byRoute.items.every(
        (trip) => trip.fromCity === 'Москва' && trip.toCity === 'Санкт-Петербург',
      ),
    ).toBe(true);
  });

  it('фильтр по роли отдаёт только объявления этой роли', async () => {
    const drivers = await fetchTrips('?limit=50&role=DRIVER');
    const passengers = await fetchTrips('?limit=50&role=PASSENGER');
    const all = await fetchTrips('?limit=50');

    expect(drivers.items.every((trip) => trip.role === 'DRIVER')).toBe(true);
    expect(passengers.items.every((trip) => trip.role === 'PASSENGER')).toBe(true);
    expect(drivers.items.length + passengers.items.length).toBe(all.items.length);
  });

  it('priceMax отсекает дорогие поездки и поездки без цены', async () => {
    const limit = 900;
    const { items } = await fetchTrips(`?limit=50&priceMax=${limit}`);

    expect(items.length).toBeGreaterThan(0);
    for (const trip of items) {
      expect(trip.priceRub).not.toBeNull();
      expect(trip.priceRub!).toBeLessThanOrEqual(limit);
    }

    const all = await fetchTrips('?limit=50');
    expect(items.length).toBeLessThan(all.items.length);
  });

  it('seatsMin отсекает поездки без нужного числа свободных мест', async () => {
    const { items } = await fetchTrips('?limit=50&seatsMin=3');

    expect(items.every((trip) => trip.seatsLeft >= 3)).toBe(true);

    const all = await fetchTrips('?limit=50');
    expect(items.length).toBeLessThan(all.items.length);
  });

  it('фильтр по дате оставляет только выбранный день', async () => {
    const all = await fetchTrips('?limit=50');
    const sample = all.items[3];
    expect(sample).toBeDefined();
    const day = sample!.departAt.slice(0, 10);

    const { items } = await fetchTrips(`?limit=50&date=${day}`);

    expect(items.length).toBeGreaterThan(0);
    expect(items.every((trip) => trip.departAt.slice(0, 10) === day)).toBe(true);
    expect(items.length).toBeLessThan(all.items.length);
  });

  it('неизвестный город — 400 с понятным сообщением', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/trips?from=${encodeURIComponent('Нарния')}`,
      headers: authHeaders(VIEWER),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(response.json().error.message).toMatch(/справочник/i);
  });

  it('курсорная пагинация идёт по возрастанию departAt и не теряет поездок', async () => {
    const all = await fetchTrips('?limit=50');

    const collected: TripItem[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const query: string = cursor === null ? '?limit=4' : `?limit=4&cursor=${encodeURIComponent(cursor)}`;
      const result = await fetchTrips(query);
      collected.push(...result.items);
      cursor = result.nextCursor;
      if (cursor === null) {
        break;
      }
    }

    expect(collected.map((trip) => trip.id)).toEqual(all.items.map((trip) => trip.id));

    const times = collected.map((trip) => new Date(trip.departAt).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('битый курсор — 400', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/trips?cursor=%21%21%21',
      headers: authHeaders(VIEWER),
    });
    expect(response.statusCode).toBe(400);
  });
});
