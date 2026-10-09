import type { TripSummary } from '@vk-rideshare/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TripCard } from '../src/components/TripCard.js';

/** Фиксированное «сейчас»: подпись дня не должна зависеть от даты прогона. */
const NOW = new Date('2026-09-30T12:00:00.000Z').getTime();

const trip = (overrides: Partial<TripSummary> = {}): TripSummary => ({
  id: 'trip-1',
  role: 'DRIVER',
  fromCity: 'Оренбург',
  fromPoint: null,
  toCity: 'Соль-Илецк',
  toPoint: null,
  departAt: new Date('2026-10-01T09:30:00.000Z').toISOString(),
  seatsTotal: 3,
  seatsLeft: 2,
  priceRub: 600,
  carModel: 'Lada Vesta',
  comment: null,
  status: 'ACTIVE',
  isExpired: false,
  createdAt: new Date('2026-09-20T10:00:00.000Z').toISOString(),
  author: {
    id: 'u-1',
    vkUserId: '1000001',
    tgUserId: null,
    tgUsername: null,
    firstName: 'Анна',
    lastName: 'Ковалёва',
    photoUrl: null,
    city: 'Оренбург',
    phone: null,
    ratingAvg: 4.6,
    ratingCount: 11,
  },
  ...overrides,
});

describe('карточка поездки', () => {
  it('показывает маршрут, автора и число свободных мест', () => {
    render(<TripCard trip={trip()} now={NOW} onClick={() => undefined} />);

    expect(screen.getByLabelText('Оренбург → Соль-Илецк')).toBeTruthy();
    expect(screen.getByText('Анна Ковалёва')).toBeTruthy();
    expect(screen.getByText(/Свободно 2 места/)).toBeTruthy();
    expect(screen.getByText(/600/)).toBeTruthy();
  });

  it('цена показана всегда — поле обязательное', () => {
    render(<TripCard trip={trip({ priceRub: 850 })} now={NOW} onClick={() => undefined} />);
    expect(screen.getByText('850 ₽')).toBeTruthy();
  });

  it('при нуле мест пишет «Мест нет»', () => {
    render(<TripCard trip={trip({ seatsLeft: 0 })} now={NOW} onClick={() => undefined} />);
    expect(screen.getByText('Мест нет')).toBeTruthy();
  });

  it('роль PASSENGER подписана как «Ищет водителя»', () => {
    render(<TripCard trip={trip({ role: 'PASSENGER' })} now={NOW} onClick={() => undefined} />);
    expect(screen.getByText('Ищет водителя')).toBeTruthy();
  });

  it('у водителя и у пассажира разные иконки роли', () => {
    const { container: driver } = render(<TripCard trip={trip()} now={NOW} onClick={() => undefined} />);
    const { container: passenger } = render(
      <TripCard trip={trip({ role: 'PASSENGER' })} now={NOW} onClick={() => undefined} />,
    );

    const iconIds = (root: HTMLElement): string[] =>
      [...root.querySelectorAll('svg')].flatMap((svg) =>
        [...svg.classList].filter((name) => name.startsWith('vkuiIcon--') && name.includes('_')),
      );

    expect(iconIds(driver)).toContain('vkuiIcon--car_outline_20');
    expect(iconIds(passenger)).toContain('vkuiIcon--hand_outline_20');
    expect(iconIds(passenger)).not.toContain('vkuiIcon--car_outline_20');
  });

  it('просроченная поездка помечена «Время вышло»', () => {
    render(<TripCard trip={trip({ isExpired: true })} now={NOW} onClick={() => undefined} />);
    expect(screen.getByText('Время вышло')).toBeTruthy();
  });

  it('у живой поездки плашки состояния нет', () => {
    render(<TripCard trip={trip()} now={NOW} onClick={() => undefined} />);
    expect(screen.queryByText('Время вышло')).toBeNull();
    expect(screen.queryByText('Завершена')).toBeNull();
    expect(screen.queryByText('Отменена')).toBeNull();
  });

  it('клик по карточке зовёт обработчик', () => {
    const onClick = vi.fn();
    render(<TripCard trip={trip()} now={NOW} onClick={onClick} />);

    fireEvent.click(screen.getByLabelText('Оренбург → Соль-Илецк'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
