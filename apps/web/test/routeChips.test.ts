/**
 * «Таблетки» двухшагового выбора маршрута.
 *
 * Проверяется то, из-за чего выбор и переделали: свободного ввода нет, а
 * собрать невозможную пару вроде «Акбулак → Соль-Илецк» нельзя даже
 * нарочно — во втором шаге её просто нет среди вариантов.
 */
import {
  ORENBURG,
  SPOKES,
  buildRoute,
  isKnownRoute,
  type Direction,
} from '@vk-rideshare/shared';
import { describe, expect, it } from 'vitest';

import { SPOKE_CHIPS, directionChips } from '../src/lib/routeChips.js';

describe('двухшаговый выбор маршрута', () => {
  it('первый шаг — спицы, и только они', () => {
    expect(SPOKE_CHIPS.map((chip) => chip.value)).toEqual(SPOKES.map((spoke) => spoke.name));
    // Оренбург в первом шаге не нужен: он есть в каждом маршруте.
    expect(SPOKE_CHIPS.some((chip) => chip.value === ORENBURG)).toBe(false);
  });

  it('второй шаг — две стороны, подписанные полным маршрутом', () => {
    for (const spoke of SPOKES) {
      const chips = directionChips(spoke.name);

      expect(chips).toHaveLength(2);
      expect(chips.map((chip) => chip.label)).toEqual([
        `${ORENBURG} → ${spoke.name}`,
        `${spoke.name} → ${ORENBURG}`,
      ]);
    }
  });

  it('любой возможный выбор даёт существующее направление', () => {
    const chosen: Direction[] = [];
    for (const spoke of SPOKES) {
      for (const chip of directionChips(spoke.name)) {
        const route = buildRoute(spoke.name, chip.value);
        expect(isKnownRoute(route.from, route.to)).toBe(true);
        chosen.push(chip.value);
      }
    }
    // Вариантов ровно столько, сколько направлений в справочнике.
    expect(chosen).toHaveLength(SPOKES.length * 2);
  });
});
