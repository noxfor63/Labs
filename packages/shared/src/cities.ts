/**
 * Справочник городов и направлений.
 *
 * Приложение обслуживает не всю страну, а три города Оренбургской области
 * и шесть направлений между ними. Набор фиксированный и закрытый: и поиск,
 * и создание поездки проверяются по нему, произвольный город ввести нельзя.
 */

export type City = {
  /** Латинский слаг — стабильный ключ для URL и тестов. */
  readonly id: string;
  /** Каноническое написание; именно оно едет в БД и показывается в UI. */
  readonly name: string;
};

export const ORENBURG = 'Оренбург';
export const SOL_ILETSK = 'Соль-Илецк';
export const AKBULAK = 'Акбулак';

export const CITIES: readonly City[] = [
  { id: 'orenburg', name: ORENBURG },
  { id: 'sol-iletsk', name: SOL_ILETSK },
  { id: 'akbulak', name: AKBULAK },
] as const;

/** Направление: строго упорядоченная пара «откуда → куда». */
export type Route = {
  readonly from: string;
  readonly to: string;
};

/**
 * Все допустимые направления. Каждая пара городов доступна в обе стороны,
 * поэтому маршрутов шесть, а не три.
 */
export const ROUTES: readonly Route[] = [
  { from: ORENBURG, to: SOL_ILETSK },
  { from: SOL_ILETSK, to: ORENBURG },
  { from: ORENBURG, to: AKBULAK },
  { from: AKBULAK, to: ORENBURG },
  { from: AKBULAK, to: SOL_ILETSK },
  { from: SOL_ILETSK, to: AKBULAK },
] as const;

const CITY_BY_NAME: ReadonlyMap<string, City> = new Map(CITIES.map((city) => [city.name, city]));
const CITY_BY_ID: ReadonlyMap<string, City> = new Map(CITIES.map((city) => [city.id, city]));

const ROUTE_KEYS: ReadonlySet<string> = new Set(
  ROUTES.map((route) => `${route.from}→${route.to}`),
);

export function isKnownCity(name: string): boolean {
  return CITY_BY_NAME.has(name);
}

export function findCityByName(name: string): City | undefined {
  return CITY_BY_NAME.get(name);
}

export function findCityById(id: string): City | undefined {
  return CITY_BY_ID.get(id);
}

/** Существует ли такое направление. Порядок городов важен. */
export function isKnownRoute(from: string, to: string): boolean {
  return ROUTE_KEYS.has(`${from}→${to}`);
}

/**
 * Куда можно уехать из города. Форма создания поездки сужает по этому
 * списку выбор «куда», чтобы невозможный маршрут нельзя было и собрать.
 */
export function destinationsFrom(from: string): readonly City[] {
  const names = ROUTES.filter((route) => route.from === from).map((route) => route.to);
  return CITIES.filter((city) => names.includes(city.name));
}

/** Человекочитаемое направление для заголовков и подписей. */
export function formatRoute(from: string, to: string): string {
  return `${from} → ${to}`;
}
