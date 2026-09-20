/**
 * Launch-параметры запуска.
 *
 * ВКонтакте передаёт их в query-строке при открытии мини-приложения.
 * Мы запоминаем ИСХОДНУЮ строку ровно как она пришла: любая пересборка
 * (даже через URLSearchParams) может изменить порядок или кодирование
 * и сломать подпись на бэкенде.
 */

const STORAGE_KEY = 'vk-rideshare:launch-params';

function readFromLocation(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  const search = window.location.search.replace(/^\?/, '');
  if (search.includes('vk_user_id=')) {
    return search;
  }
  // Хеш-роутер: параметры могут оказаться после #.
  const hash = window.location.hash;
  const queryStart = hash.indexOf('?');
  if (queryStart !== -1) {
    const fromHash = hash.slice(queryStart + 1);
    if (fromHash.includes('vk_user_id=')) {
      return fromHash;
    }
  }
  return '';
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
