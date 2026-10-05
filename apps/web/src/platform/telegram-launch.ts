/**
 * Перехват данных запуска Telegram.
 *
 * Telegram открывает мини-приложение по адресу вида
 * `https://домен/app/#tgWebAppData=<initData>&tgWebAppThemeParams=…`,
 * то есть кладёт всё в **хеш**. У нас хеш занят маршрутизатором, и если
 * ничего не делать, приложение попытается перейти на «маршрут»
 * `tgWebAppData=…` и покажет пустой экран.
 *
 * Поэтому модуль читается один раз, до создания маршрутизатора: он
 * забирает параметры себе и возвращает хеш к `#/`. Повторно из адреса
 * взять их уже нельзя — отсюда и кэш в sessionStorage, он же спасает при
 * перезагрузке страницы.
 *
 * initData запоминается **как есть**: пересборка через URLSearchParams
 * меняет порядок и кодирование, а подпись считается именно по исходной
 * строке.
 */

const STORAGE_KEY = 'po-puti:tg-init-data';

export type TelegramLaunch = {
  /** Исходная строка initData для заголовка запроса. */
  initData: string;
  /** Цветовая схема клиента на момент запуска: 'dark' | 'light'. */
  colorScheme: 'dark' | 'light';
};

let captured: TelegramLaunch | null = null;
let captureDone = false;

/** Параметры Telegram могут прийти и в хеше, и в query — проверяем оба. */
function findRawParams(): URLSearchParams | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const candidates = [window.location.hash.replace(/^#\/?/, ''), window.location.search.replace(/^\?/, '')];

  for (const candidate of candidates) {
    if (candidate.includes('tgWebAppData=')) {
      return new URLSearchParams(candidate);
    }
  }
  return null;
}

/** Яркость цвета #rgb или #rrggbb; null — разобрать не вышло. */
function brightness(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const hex = value.trim().replace(/^#/, '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) {
    return null;
  }
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  // Та же формула яркости, что в рекомендациях по контрасту.
  return (r * 299 + g * 587 + b * 114) / 1000;
}

/** Схема по настройке самого устройства — последний рубеж. */
function schemeFromDevice(): 'dark' | 'light' {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/**
 * Цветовая схема клиента.
 *
 * Источников три, по убыванию надёжности, и так сделано потому, что
 * первые два приходят не всегда: прямой параметр, яркость фона из
 * tgWebAppThemeParams и, если ничего нет, настройка устройства. Раньше
 * источник был один, и у тех, кому Telegram тему в адресе не прислал,
 * приложение открывалось светлым поверх тёмного клиента.
 */
export function readColorScheme(params: URLSearchParams | null): 'dark' | 'light' {
  if (params !== null) {
    const direct = params.get('tgWebAppColorScheme');
    if (direct === 'dark' || direct === 'light') {
      return direct;
    }

    const rawTheme = params.get('tgWebAppThemeParams');
    if (rawTheme !== null) {
      try {
        const theme = JSON.parse(rawTheme) as Record<string, unknown>;
        // bg_color — основной фон; secondary_bg_color встречается, когда
        // основного в наборе нет.
        const level = brightness(theme['bg_color']) ?? brightness(theme['secondary_bg_color']);
        if (level !== null) {
          return level < 128 ? 'dark' : 'light';
        }
        // Светлый текст означает тёмную тему — обратный признак.
        const text = brightness(theme['text_color']);
        if (text !== null) {
          return text >= 128 ? 'dark' : 'light';
        }
      } catch {
        // Тема не разобралась — не повод падать, спросим устройство.
      }
    }
  }

  return schemeFromDevice();
}

/**
 * Забирает параметры запуска и очищает хеш. Вызывать **до** создания
 * маршрутизатора и ровно один раз; последующие вызовы отдают запомненное.
 */
export function captureTelegramLaunch(): TelegramLaunch | null {
  if (captureDone) {
    return captured;
  }
  captureDone = true;

  const params = findRawParams();
  if (params !== null) {
    const initData = params.get('tgWebAppData') ?? '';
    if (initData !== '') {
      captured = { initData, colorScheme: readColorScheme(params) };
      try {
        window.sessionStorage.setItem(STORAGE_KEY, initData);
      } catch {
        // Приватный режим — работаем без кэша.
      }
      // Хеш отдаём маршрутизатору чистым, иначе он уедет на «маршрут» tgWebAppData.
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`);
      return captured;
    }
  }

  // Параметров в адресе нет — возможно, это переход внутри приложения.
  try {
    const cached = window.sessionStorage.getItem(STORAGE_KEY);
    if (cached !== null && cached !== '') {
      // Параметров темы в адресе уже нет — спрашиваем устройство, а не
      // ставим светлую наугад.
      captured = { initData: cached, colorScheme: readColorScheme(null) };
    }
  } catch {
    // Нет доступа к хранилищу — значит и кэша нет.
  }
  return captured;
}

/** Запущены ли мы внутри Telegram. */
export function isInsideTelegram(): boolean {
  return captureTelegramLaunch() !== null;
}

export function getTelegramInitData(): string {
  return captureTelegramLaunch()?.initData ?? '';
}
