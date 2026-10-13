/**
 * «Таблетки» двухшагового выбора маршрута — общие для поиска и формы.
 *
 * Лежат отдельно, а не повторяются в двух панелях, потому что шаги
 * должны выглядеть и подписываться одинаково: человек выбирает маршрут
 * в поиске, а потом тем же жестом создаёт свой.
 */
import {
  DIRECTIONS,
  SPOKES,
  buildRoute,
  formatRoute,
  type Direction,
} from '@vk-rideshare/shared';

import type { ChipOption } from '../components/FilterChips.js';

/** Шаг первый — спица. Порядок берётся из справочника. */
export const SPOKE_CHIPS: readonly ChipOption<string>[] = SPOKES.map((spoke) => ({
  value: spoke.name,
  label: spoke.name,
}));

/**
 * Шаг второй — сторона выбранной спицы. Вариантов ровно два.
 *
 * Подписи — полные маршруты («Оренбург → Акбулак»), а не «туда» и
 * «обратно»: «туда» каждый читает от себя, и половина объявлений уехала
 * бы в обратную сторону.
 */
export function directionChips(spoke: string): readonly ChipOption<Direction>[] {
  return DIRECTIONS.map((direction) => {
    const route = buildRoute(spoke, direction);
    return { value: direction, label: formatRoute(route.from, route.to) };
  });
}
