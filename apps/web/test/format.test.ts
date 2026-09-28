import { describe, expect, it } from 'vitest';

import {
  formatPrice,
  formatReviews,
  formatSeats,
  formatTrips,
  fullName,
  pluralize,
  toDateInputValue,
} from '../src/lib/format.js';

describe('склонение и форматирование', () => {
  it('склоняет «место» по числу', () => {
    expect(formatSeats(1)).toBe('1 место');
    expect(formatSeats(2)).toBe('2 места');
    expect(formatSeats(5)).toBe('5 мест');
    expect(formatSeats(11)).toBe('11 мест');
    expect(formatSeats(21)).toBe('21 место');
    expect(formatSeats(22)).toBe('22 места');
    expect(formatSeats(111)).toBe('111 мест');
  });

  it('склоняет «отзыв» и «поездка»', () => {
    expect(formatReviews(1)).toBe('1 отзыв');
    expect(formatReviews(3)).toBe('3 отзыва');
    expect(formatReviews(14)).toBe('14 отзывов');
    expect(formatTrips(1)).toBe('1 поездка');
    expect(formatTrips(4)).toBe('4 поездки');
    expect(formatTrips(12)).toBe('12 поездок');
  });

  it('pluralize берёт третью форму для 11–14', () => {
    const forms: [string, string, string] = ['один', 'два', 'много'];
    expect(pluralize(11, forms)).toBe('много');
    expect(pluralize(12, forms)).toBe('много');
    expect(pluralize(14, forms)).toBe('много');
    expect(pluralize(15, forms)).toBe('много');
  });

  it('цена печатается с рублём и разрядами', () => {
    expect(formatPrice(500)).toBe('500 ₽');
    expect(formatPrice(850)).toBe('850 ₽');
    expect(formatPrice(1500)).toContain('₽');
  });

  it('имя склеивается без лишних пробелов', () => {
    expect(fullName({ firstName: 'Анна', lastName: 'Ковалёва' })).toBe('Анна Ковалёва');
    expect(fullName({ firstName: 'Анна', lastName: '' })).toBe('Анна');
  });

  it('дата для input[type=date] берётся из локального дня, а не из UTC', () => {
    // 1 января 00:30 по местному времени в UTC — ещё 31 декабря.
    const localNewYear = new Date(2026, 0, 1, 0, 30);
    expect(toDateInputValue(localNewYear)).toBe('2026-01-01');
  });
});
