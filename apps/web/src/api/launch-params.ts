/**
 * Launch-параметры запуска.
 *
 * ВКонтакте передаёт их в query-строке при открытии мини-приложения.
 * Мы запоминаем ИСХОДНУЮ строку ровно как она пришла: любая пересборка
 * (даже через URLSearchParams) может изменить порядок или кодирование
 * и сломать подпись на бэкенде.
 */

const STORAGE_KEY = 'vk-rideshare:launch-params';

/** Похожа ли строка на параметры запуска. */
const looksLikeLaunchParams = (value: string): boolean => value.includes('vk_user_id=');

function readFromLocation(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  const search = window.location.search.replace(/^\?/, '');
  if (looksLikeLaunchParams(search)) {
    return search;
  }

  const hash = window.location.hash;

  // Хеш-роутер: параметры могут оказаться после «?» внутри хеша.
  const queryStart = hash.indexOf('?');
  if (queryStart !== -1) {
    const fromHash = hash.slice(queryStart + 1);
    if (looksLikeLaunchParams(fromHash)) {
      return fromHash;
    }
  }

  // И случай без «?» — параметры сразу после решётки: «#vk_user_id=…».
  const bare = hash.replace(/^#\/?/, '');
  if (looksLikeLaunchParams(bare)) {
    return bare;
  }

  return '';
}

/**
 * Откуда взялись параметры запуска. Нужно, чтобы экран ошибки мог назвать
 * причину: «параметров нет в адресе» и «параметры есть, но протухли» —
 * это две совершенно разные поломки, а выглядят одинаково.
 */
export type LaunchParamsSource = 'address' | 'cache' | 'none';

export function getLaunchParamsSource(): LaunchParamsSource {
  if (readFromLocation() !== '') {
    return 'address';
  }
  try {
    return (window.sessionStorage.getItem(STORAGE_KEY) ?? '') !== '' ? 'cache' : 'none';
  } catch {
    return 'none';
  }
}

/**
 * Исходная строка запуска. Кэшируется в sessionStorage: при переходах
 * внутри приложения адрес меняется, а подписанная строка должна остаться.
 */
export function getLaunchParams(): string {
  const fromLocation = readFromLocation();
  if (fromLocation !== '') {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, fromLocation);
    } catch {
      // Приватный режим — просто работаем без кэша.
    }
    return fromLocation;
  }

  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}
