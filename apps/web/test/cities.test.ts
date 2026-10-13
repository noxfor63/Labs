/**
 * Справочник направлений.
 *
 * Тест лежит в веб-пакете по той же причине, что и тест телефонов:
 * vitest настроен здесь, а сам справочник общий.
 *
 * Проверяется не список, а правило: маршруты собираются из хаба и спиц,
 * поэтому достаточно убедиться, что собранное обладает нужными
 * свойствами. Перечислять восемь пар в тесте — значит завести вторую
 * копию списка, которая разойдётся с первой.
 */
import {
  AKBULAK,
  ALEKSANDROVKA,
  CITIES,
  DIRECTION,
  DIRECTIONS,
  HUB,
  ILEK,
  ORENBURG,
  ROUTES,
  SOL_ILETSK,
  SPOKES,
  buildRoute,
  isHub,
  isKnownCity,
  isKnownRoute,
} from '@vk-rideshare/shared';
import { describe, expect, it } from 'vitest';

describe('радиальный справочник направлений', () => {
  it('на каждую спицу ровно два направления, и других нет', () => {
    expect(ROUTES).toHaveLength(SPOKES.length * 2);
    expect(SPOKES).toHaveLength(4);
  });

  it('в каждом направлении участвует хаб', () => {
    for (const route of ROUTES) {
      expect(isHub(route.from) || isHub(route.to)).toBe(true);
    }
  });

  it('ни одно направление не соединяет две спицы', () => {
    for (const from of SPOKES) {
      for (const to of SPOKES) {
        expect(isKnownRoute(from.name, to.name)).toBe(false);
      }
    }
  });

  it('удалённая пара Акбулак↔Соль-Илецк больше не маршрут', () => {
    expect(isKnownRoute(AKBULAK, SOL_ILETSK)).toBe(false);
    expect(isKnownRoute(SOL_ILETSK, AKBULAK)).toBe(false);
  });

  it('новые пункты доступны в обе стороны', () => {
    for (const spoke of [ILEK, ALEKSANDROVKA]) {
      expect(isKnownCity(spoke)).toBe(true);
      expect(isKnownRoute(ORENBURG, spoke)).toBe(true);
      expect(isKnownRoute(spoke, ORENBURG)).toBe(true);
    }
  });

  it('хаб сам себе не направление', () => {
    expect(isKnownRoute(ORENBURG, ORENBURG)).toBe(false);
  });

  it('пункты — это хаб и спицы, без повторов', () => {
    expect(CITIES[0]).toEqual(HUB);
    expect(CITIES).toHaveLength(SPOKES.length + 1);
    expect(new Set(CITIES.map((city) => city.name)).size).toBe(CITIES.length);
    expect(new Set(CITIES.map((city) => city.id)).size).toBe(CITIES.length);
  });

  it('сторона решает, с какого конца хаб', () => {
    for (const spoke of SPOKES) {
      expect(buildRoute(spoke.name, DIRECTION.FROM_HUB)).toEqual({
        from: ORENBURG,
        to: spoke.name,
      });
      expect(buildRoute(spoke.name, DIRECTION.TO_HUB)).toEqual({
        from: spoke.name,
        to: ORENBURG,
      });
    }
  });

  it('любая собранная пара — существующее направление', () => {
    // Интерфейс собирает маршрут только так, поэтому невозможную пару
    // в нём нельзя и выбрать.
    for (const spoke of SPOKES) {
      for (const direction of DIRECTIONS) {
        const route = buildRoute(spoke.name, direction);
        expect(isKnownRoute(route.from, route.to)).toBe(true);
      }
    }
  });

  it('пункт вне справочника направлением не становится', () => {
    expect(isKnownCity('Самара')).toBe(false);
    expect(isKnownRoute('Самара', ORENBURG)).toBe(false);
    expect(isKnownRoute(ORENBURG, 'Самара')).toBe(false);
  });
});
