import type { TripSummary } from '@vk-rideshare/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TripCard } from '../src/components/TripCard.js';

const trip = (overrides: Partial<TripSummary> = {}): TripSummary => ({
  id: 'trip-1',
  role: 'DRIVER',
  fromCity: 'Москва',
  fromPoint: null,
  toCity: 'Тула',
  toPoint: null,
  departAt: new Date('2026-10-01T09:30:00.000Z').toISOString(),
  seatsTotal: 3,
  seatsLeft: 2,
  priceRub: 900,
  carModel: 'Lada Vesta',
  comment: null,
  status: 'ACTIVE',
  createdAt: new Date('2026-09-20T10:00:00.000Z').toISOString(),
  author: {
    vkUserId: '1000001',
    firstName: 'Анна',
    lastName: 'Ковалёва',
    photoUrl: null,
    city: 'Москва',
    ratingAvg: 4.6,
    ratingCount: 11,
  },
  ...overrides,
});

describe('карточка поездки', () => {
  it('показывает маршрут, автора и число свободных мест', () => {
    render(<TripCard trip={trip()} onClick={() => undefined} />);

    expect(screen.getByText(/Москва → Тула/)).toBeTruthy();
    expect(screen.getByText('Анна Ковалёва')).toBeTruthy();
    expect(screen.getByText(/Свободно 2 места/)).toBeTruthy();
    expect(screen.getByText(/900/)).toBeTruthy();
  });

  it('без цены пишет «Цена не указана»', () => {
    render(<TripCard trip={trip({ priceRub: null })} onClick={() => undefined} />);
    expect(screen.getByText('Цена не указана')).toBeTruthy();
  });

  it('при нуле мест пишет «Мест нет»', () => {
    render(<TripCard trip={trip({ seatsLeft: 0 })} onClick={() => undefined} />);
    expect(screen.getByText('Мест нет')).toBeTruthy();
  });

  it('роль PASSENGER подписана как «Ищет водителя»', () => {
    render(<TripCard trip={trip({ role: 'PASSENGER' })} onClick={() => undefined} />);
    expect(screen.getByText('Ищет водителя')).toBeTruthy();
  });

  it('клик по карточке зовёт обработчик', () => {
    const onClick = vi.fn();
    render(<TripCard trip={trip()} onClick={onClick} />);

    fireEvent.click(screen.getByText(/Москва → Тула/));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
