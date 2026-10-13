/**
 * Справочник пунктов и направлений.
 *
 * Модель радиальная: Оренбург — единственный хаб, остальные пункты —
 * спицы. Любая поездка идёт либо в хаб, либо из хаба; прямых рейсов
 * между спицами не существует. Так устроено не из экономии, а по жизни:
 * между райцентрами никто не ездит напрямую, все маршруты сходятся в
 * областном центре.
 *
 * Отсюда главное свойство файла: направления **не перечислены руками**,
 * а собираются из хаба и списка спиц. Добавить пункт — одна строка в
 * SPOKES, и маршруты, валидация, интерфейс и сид подхватят его сами.
 * Прошлая версия держала шесть пар списком, и пара Акбулак↔Соль-Илецк
 * жила в нём ровно потому, что её никто не пересматривал.
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
/**
 * Без «ё»: справочные источники по Илекскому району пишут «Илек», и
 * вариант «Илёк» в них не встречается. Название видят люди, поэтому
 * написание зафиксировано здесь, а не подбирается по месту.
 */
export const ILEK = 'Илек';
export const ALEKSANDROVKA = 'Александровка';

/** Хаб. Все направления проходят через него. */
export const HUB: City = { id: 'orenburg', name: ORENBURG };

/**
 * Спицы. Добавление нового пункта — одна строка здесь.
 *
 * Порядок значим: в таком виде пункты показываются в интерфейсе.
 */
export const SPOKES: readonly City[] = [
  { id: 'sol-iletsk', name: SOL_ILETSK },
  { id: 'akbulak', name: AKBULAK },
  { id: 'ilek', name: ILEK },
  { id: 'aleksandrovka', name: ALEKSANDROVKA },
] as const;

/** Все пункты: хаб первым, дальше спицы в порядке объявления. */
export const CITIES: readonly City[] = [HUB, ...SPOKES];

/** Направление: строго упорядоченная пара «откуда → куда». */
export type Route = {
  readonly from: string;
  readonly to: string;
};

/**
 * Куда идёт поездка относительно хаба.
 *
 * Два значения, а не свободная пара городов: в радиальной модели выбор
 * маршрута — это выбор спицы плюс выбор стороны.
 */
export const DIRECTION = {
  /** Из Оренбурга в спицу. */
  FROM_HUB: 'FROM_HUB',
  /** Из спицы в Оренбург. */
  TO_HUB: 'TO_HUB',
} as const;
export type Direction = (typeof DIRECTION)[keyof typeof DIRECTION];
export const DIRECTIONS = [DIRECTION.FROM_HUB, DIRECTION.TO_HUB] as const;

/** Маршрут по спице и стороне. Единственный способ собрать пару городов. */
export function buildRoute(spoke: string, direction: Direction): Route {
  return direction === DIRECTION.FROM_HUB
    ? { from: HUB.name, to: spoke }
    : { from: spoke, to: HUB.name };
}

/**
 * Все допустимые направления: по два на каждую спицу.
 *
 * Собирается программно — список и правило не могут разойтись.
 */
export const ROUTES: readonly Route[] = SPOKES.flatMap((spoke) =>
  DIRECTIONS.map((direction) => buildRoute(spoke.name, direction)),
);

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

/** Хаб ли это. */
export function isHub(name: string): boolean {
  return name === HUB.name;
}

/** Существует ли такое направление. Порядок пунктов важен. */
export function isKnownRoute(from: string, to: string): boolean {
  return ROUTE_KEYS.has(`${from}→${to}`);
}

/** Человекочитаемое направление для заголовков и подписей. */
export function formatRoute(from: string, to: string): string {
  return `${from} → ${to}`;
}
