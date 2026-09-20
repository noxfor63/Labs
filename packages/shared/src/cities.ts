/**
 * Статический справочник городов России.
 *
 * Внешних API и геокодинга нет по условию задачи: список фиксированный,
 * около 100 крупнейших городов. Поездка хранит каноническое `name` отсюда,
 * поэтому фильтр «откуда/куда» — точное совпадение строки, а не поиск.
 */

export type City = {
  /** Латинский слаг — стабильный ключ для URL и тестов. */
  readonly id: string;
  /** Каноническое написание; именно оно едет в БД и показывается в UI. */
  readonly name: string;
};

export const CITIES: readonly City[] = [
  { id: 'moskva', name: 'Москва' },
  { id: 'sankt-peterburg', name: 'Санкт-Петербург' },
  { id: 'novosibirsk', name: 'Новосибирск' },
  { id: 'ekaterinburg', name: 'Екатеринбург' },
  { id: 'kazan', name: 'Казань' },
  { id: 'nizhniy-novgorod', name: 'Нижний Новгород' },
  { id: 'krasnoyarsk', name: 'Красноярск' },
  { id: 'chelyabinsk', name: 'Челябинск' },
  { id: 'samara', name: 'Самара' },
  { id: 'ufa', name: 'Уфа' },
  { id: 'rostov-na-donu', name: 'Ростов-на-Дону' },
  { id: 'krasnodar', name: 'Краснодар' },
  { id: 'omsk', name: 'Омск' },
  { id: 'voronezh', name: 'Воронеж' },
  { id: 'perm', name: 'Пермь' },
  { id: 'volgograd', name: 'Волгоград' },
  { id: 'saratov', name: 'Саратов' },
  { id: 'tyumen', name: 'Тюмень' },
  { id: 'tolyatti', name: 'Тольятти' },
  { id: 'makhachkala', name: 'Махачкала' },
  { id: 'barnaul', name: 'Барнаул' },
  { id: 'izhevsk', name: 'Ижевск' },
  { id: 'khabarovsk', name: 'Хабаровск' },
  { id: 'ulyanovsk', name: 'Ульяновск' },
  { id: 'irkutsk', name: 'Иркутск' },
  { id: 'vladivostok', name: 'Владивосток' },
  { id: 'yaroslavl', name: 'Ярославль' },
  { id: 'sevastopol', name: 'Севастополь' },
  { id: 'stavropol', name: 'Ставрополь' },
  { id: 'naberezhnye-chelny', name: 'Набережные Челны' },
  { id: 'tomsk', name: 'Томск' },
  { id: 'balashikha', name: 'Балашиха' },
  { id: 'kemerovo', name: 'Кемерово' },
  { id: 'novokuznetsk', name: 'Новокузнецк' },
  { id: 'ryazan', name: 'Рязань' },
  { id: 'astrakhan', name: 'Астрахань' },
  { id: 'penza', name: 'Пенза' },
  { id: 'lipetsk', name: 'Липецк' },
  { id: 'tula', name: 'Тула' },
  { id: 'kirov', name: 'Киров' },
  { id: 'cheboksary', name: 'Чебоксары' },
  { id: 'kaliningrad', name: 'Калининград' },
  { id: 'kursk', name: 'Курск' },
  { id: 'ulan-ude', name: 'Улан-Удэ' },
  { id: 'sochi', name: 'Сочи' },
  { id: 'surgut', name: 'Сургут' },
  { id: 'tver', name: 'Тверь' },
  { id: 'magnitogorsk', name: 'Магнитогорск' },
  { id: 'bryansk', name: 'Брянск' },
  { id: 'ivanovo', name: 'Иваново' },
  { id: 'belgorod', name: 'Белгород' },
  { id: 'nizhniy-tagil', name: 'Нижний Тагил' },
  { id: 'arkhangelsk', name: 'Архангельск' },
  { id: 'vladimir', name: 'Владимир' },
  { id: 'chita', name: 'Чита' },
  { id: 'kaluga', name: 'Калуга' },
  { id: 'simferopol', name: 'Симферополь' },
  { id: 'smolensk', name: 'Смоленск' },
  { id: 'volzhskiy', name: 'Волжский' },
  { id: 'yakutsk', name: 'Якутск' },
  { id: 'saransk', name: 'Саранск' },
  { id: 'kurgan', name: 'Курган' },
  { id: 'orel', name: 'Орёл' },
  { id: 'podolsk', name: 'Подольск' },
  { id: 'groznyy', name: 'Грозный' },
  { id: 'vologda', name: 'Вологда' },
  { id: 'cherepovets', name: 'Череповец' },
  { id: 'vladikavkaz', name: 'Владикавказ' },
  { id: 'murmansk', name: 'Мурманск' },
  { id: 'tambov', name: 'Тамбов' },
  { id: 'sterlitamak', name: 'Стерлитамак' },
  { id: 'petrozavodsk', name: 'Петрозаводск' },
  { id: 'kostroma', name: 'Кострома' },
  { id: 'nizhnevartovsk', name: 'Нижневартовск' },
  { id: 'novorossiysk', name: 'Новороссийск' },
  { id: 'yoshkar-ola', name: 'Йошкар-Ола' },
  { id: 'khimki', name: 'Химки' },
  { id: 'taganrog', name: 'Таганрог' },
  { id: 'komsomolsk-na-amure', name: 'Комсомольск-на-Амуре' },
  { id: 'syktyvkar', name: 'Сыктывкар' },
  { id: 'nalchik', name: 'Нальчик' },
  { id: 'nizhnekamsk', name: 'Нижнекамск' },
  { id: 'shakhty', name: 'Шахты' },
  { id: 'dzerzhinsk', name: 'Дзержинск' },
  { id: 'orsk', name: 'Орск' },
  { id: 'bratsk', name: 'Братск' },
  { id: 'blagoveshchensk', name: 'Благовещенск' },
  { id: 'engels', name: 'Энгельс' },
  { id: 'angarsk', name: 'Ангарск' },
  { id: 'korolev', name: 'Королёв' },
  { id: 'velikiy-novgorod', name: 'Великий Новгород' },
  { id: 'staryy-oskol', name: 'Старый Оскол' },
  { id: 'mytishchi', name: 'Мытищи' },
  { id: 'pskov', name: 'Псков' },
  { id: 'lyubertsy', name: 'Люберцы' },
  { id: 'biysk', name: 'Бийск' },
  { id: 'yuzhno-sakhalinsk', name: 'Южно-Сахалинск' },
  { id: 'armavir', name: 'Армавир' },
  { id: 'rybinsk', name: 'Рыбинск' },
  { id: 'prokopevsk', name: 'Прокопьевск' },
] as const;

const CITY_BY_NAME: ReadonlyMap<string, City> = new Map(CITIES.map((c) => [c.name, c]));
const CITY_BY_ID: ReadonlyMap<string, City> = new Map(CITIES.map((c) => [c.id, c]));

/** Города, отсортированные по названию — для выпадающих списков. */
export const CITIES_ALPHABETICAL: readonly City[] = [...CITIES].sort((a, b) =>
  a.name.localeCompare(b.name, 'ru'),
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

/** Подсказки в поле ввода: регистронезависимое вхождение подстроки. */
export function searchCities(query: string, limit = 10): readonly City[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return CITIES.slice(0, limit);
  }
  const startsWith: City[] = [];
  const contains: City[] = [];
  for (const city of CITIES_ALPHABETICAL) {
    const haystack = city.name.toLowerCase();
    if (haystack.startsWith(needle)) {
      startsWith.push(city);
    } else if (haystack.includes(needle)) {
      contains.push(city);
    }
  }
  return [...startsWith, ...contains].slice(0, limit);
}
