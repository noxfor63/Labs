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

function readColorScheme(params: URLSearchParams): 'dark' | 'light' {
  // Сначала явный параметр, если он есть.
  const direct = params.get('tgWebAppColorScheme');
  if (direct === 'dark' || direct === 'light') {
    return direct;
  }

  /*
   * Иначе выводим из темы: tgWebAppThemeParams — это JSON с цветами
   * клиента. Светлота фона решает надёжнее, чем угадывание по названию.
   */
  const rawTheme = params.get('tgWebAppThemeParams');
  if (rawTheme !== null) {
    try {
      const theme = JSON.parse(rawTheme) as Record<string, unknown>;
      const bg = theme['bg_color'];
      if (typeof bg === 'string' && /^#[0-9a-f]{6}$/i.test(bg)) {
        const r = parseInt(bg.slice(1, 3), 16);
        const g = parseInt(bg.slice(3, 5), 16);
        const b = parseInt(bg.slice(5, 7), 16);
        // Та же формула яркости, что в рекомендациях по контрасту.
        return (r * 299 + g * 587 + b * 114) / 1000 < 128 ? 'dark' : 'light';
      }
    } catch {
      // Тема не разобралась — не повод падать, берём светлую.
    }
  }

  return 'light';
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
      captured = { initData: cached, colorScheme: 'light' };
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
