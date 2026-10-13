/**
 * Снимок ленты на устройстве.
 *
 * Он нужен для одного случая: мобильный интернет ограничен, до сервера не
 * достучаться, а человеку нужен номер телефона водителя — звонки в это
 * время работают. Поэтому проверяется не только «сохранили и прочитали»,
 * но и поведение в тех условиях, где хранилище ведёт себя плохо:
 * недоступно, забито, содержит мусор от прошлой версии приложения.
 */
import type { TripSummary } from '@vk-rideshare/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findCachedTrip, readFeed, saveFeed } from '../src/lib/feedCache.js';

const trip = (overrides: Partial<TripSummary> = {}): TripSummary => ({
  id: 'trip-1',
  role: 'DRIVER',
  fromCity: 'Оренбург',
  fromPoint: null,
  toCity: 'Соль-Илецк',
  toPoint: null,
  departAt: new Date('2026-10-20T09:30:00.000Z').toISOString(),
  seatsTotal: 3,
  seatsLeft: 2,
  priceRub: 600,
  carModel: null,
  comment: null,
  status: 'ACTIVE',
  isExpired: false,
  createdAt: new Date('2026-10-19T10:00:00.000Z').toISOString(),
  author: {
    id: 'u-1',
    vkUserId: '1000001',
    tgUserId: null,
    tgUsername: null,
    firstName: 'Анна',
    lastName: 'Ковалёва',
    photoUrl: null,
    city: 'Оренбург',
    phone: '+79990000001',
    ratingAvg: 5,
    ratingCount: 3,
  },
  ...overrides,
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('снимок ленты', () => {
  it('сохраняется и читается вместе с номером телефона', () => {
    saveFeed([trip()], new Date('2026-10-19T12:00:00.000Z'));

    const snapshot = readFeed();

    expect(snapshot?.savedAt).toBe('2026-10-19T12:00:00.000Z');
    expect(snapshot?.items).toHaveLength(1);
    // Ради этого всё и делается: без связи остаётся возможность позвонить.
    expect(snapshot?.items[0]?.author.phone).toBe('+79990000001');
  });

  it('пустое хранилище — просто нет снимка', () => {
    expect(readFeed()).toBeNull();
  });

  it('мусор в хранилище не роняет приложение', () => {
    window.localStorage.setItem('po-puti:feed-v1', 'не json');

    expect(readFeed()).toBeNull();
  });

  it('снимок от прошлой версии приложения выбрасывается целиком', () => {
    // У поездки нет половины полей — так выглядел бы кэш до того, как в
    // карточку добавили телефон и @username. Показать такое нельзя.
    window.localStorage.setItem(
      'po-puti:feed-v1',
      JSON.stringify({ savedAt: '2026-10-19T12:00:00.000Z', items: [{ id: 'trip-1' }] }),
    );

    expect(readFeed()).toBeNull();
  });

  it('недоступное хранилище не роняет ни чтение, ни запись', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('доступ запрещён');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('квота исчерпана');
    });

    expect(() => {
      saveFeed([trip()]);
    }).not.toThrow();
    expect(readFeed()).toBeNull();
  });

  it('хранится не больше страницы ленты', () => {
    saveFeed(Array.from({ length: 50 }, (_, index) => trip({ id: `trip-${index}` })));

    expect(readFeed()?.items).toHaveLength(20);
  });

  it('поездку из снимка можно найти по идентификатору', () => {
    saveFeed([trip({ id: 'a' }), trip({ id: 'b' })]);

    expect(findCachedTrip('b')?.id).toBe('b');
    expect(findCachedTrip('нет такой')).toBeNull();
  });
});
