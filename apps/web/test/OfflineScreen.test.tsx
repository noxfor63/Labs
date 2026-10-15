/**
 * Экран без связи.
 *
 * Проверяется ровно то, ради чего он сделан: человек видит сохранённые
 * поездки и может позвонить. Плюс честность — на экране должно быть
 * написано, когда снят список, иначе легко принять вчерашнюю поездку за
 * сегодняшнюю.
 */
import type { TripSummary } from '@vk-rideshare/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OfflineScreen } from '../src/components/OfflineScreen.js';
import { saveFeed } from '../src/lib/feedCache.js';

/*
 * Экран без связи нужен телефону: интернет ограничен, а звонки работают.
 * В jsdom устройство определилось бы как компьютер, и вместо «Позвонить»
 * была бы кнопка копирования — поэтому режим закреплён явно. Сами режимы
 * проверяются в ContactButtons.test.tsx.
 */
vi.mock('../src/platform/phone-call.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCallMode: () => 'dial',
}));

const trip = (overrides: Partial<TripSummary> = {}): TripSummary => ({
  id: 'trip-1',
  role: 'DRIVER',
  fromCity: 'Оренбург',
  fromPoint: 'ж/д вокзал',
  toCity: 'Акбулак',
  toPoint: null,
  departAt: new Date('2026-10-20T09:30:00.000Z').toISOString(),
  seatsTotal: 3,
  seatsLeft: 2,
  priceRub: 700,
  carModel: 'Lada Vesta',
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

describe('экран без связи', () => {
  it('объясняет причину и даёт повторить', () => {
    const onRetry = vi.fn();
    render(<OfflineScreen onRetry={onRetry} />);

    expect(screen.getByText(/ограничен мобильный интернет/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Повторить'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('без снимка честно говорит, что сохранённых поездок нет', () => {
    render(<OfflineScreen onRetry={() => undefined} />);

    expect(screen.getByText(/Сохранённых поездок нет/i)).toBeTruthy();
  });

  it('показывает сохранённые поездки и время снимка', () => {
    saveFeed([trip()], new Date('2026-10-19T12:00:00.000Z'));

    render(<OfflineScreen onRetry={() => undefined} />);

    expect(screen.getByText('Акбулак')).toBeTruthy();
    // Без даты снимка человек примет вчерашнюю поездку за сегодняшнюю.
    expect(screen.getByText(/Список загружен/i)).toBeTruthy();
  });

  it('по нажатию на карточку открывает номер телефона', () => {
    saveFeed([trip()], new Date('2026-10-19T12:00:00.000Z'));

    render(<OfflineScreen onRetry={() => undefined} />);
    expect(screen.queryByText('Позвонить')).toBeNull();

    fireEvent.click(screen.getByText('Акбулак'));

    const call = screen.getByText('Позвонить').closest('a');
    expect(call?.getAttribute('href')).toBe('tel:+79990000001');
  });
});
