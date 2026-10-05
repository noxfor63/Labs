/**
 * Официальный скрипт Telegram — только ради оформления окна.
 *
 * Авторизация его не требует: initData мы берём из адреса сами
 * (см. telegram-launch.ts). Скрипт нужен для другого — развернуть
 * мини-приложение на всю высоту и следить за сменой темы. Без него
 * приложение открывается шторкой примерно в половину экрана, и это
 * заметно хуже, но не смертельно.
 *
 * Поэтому он грузится **динамически и только в Telegram**: добавлять
 * тег в index.html значило бы тянуть запрос к telegram.org при каждом
 * запуске из ВКонтакте. Если загрузка не удалась, приложение продолжает
 * работать — просто без разворота на всю высоту.
 */
import type { ColorSchemeType } from '@vkontakte/vkui';

import { captureTelegramLaunch, isInsideTelegram, readColorScheme } from './telegram-launch.js';

const SDK_URL = 'https://telegram.org/js/telegram-web-app.js';
const SDK_TIMEOUT_MS = 3_000;

/** Только то, чем мы действительно пользуемся. */
type TelegramWebApp = {
  ready?: () => void;
  expand?: () => void;
  colorScheme?: string;
  onEvent?: (event: string, handler: () => void) => void;
  offEvent?: (event: string, handler: () => void) => void;
};

function webApp(): TelegramWebApp | null {
  const telegram = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram;
  return telegram?.WebApp ?? null;
}

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  // Загрузка одна на всё приложение: инициализацию зовут и из подписки на
  // тему, и из запуска площадки, а два тега подряд ничего не улучшат.
  loading ??= startLoading();
  return loading;
}

function startLoading(): Promise<void> {
  return new Promise((resolve) => {
    if (webApp() !== null) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;

    // Ждём ограниченное время: приложение не должно зависеть от сети до
    // первого кадра. Не успели — рисуем как есть.
    const timer = setTimeout(resolve, SDK_TIMEOUT_MS);
    const finish = (): void => {
      clearTimeout(timer);
      resolve();
    };
    script.addEventListener('load', finish);
    script.addEventListener('error', finish);

    document.head.appendChild(script);
  });
}

export async function initTelegramSdk(): Promise<void> {
  if (!isInsideTelegram()) {
    return;
  }

  await loadScript();

  const app = webApp();
  if (app === null) {
    return;
  }
  app.ready?.();
  app.expand?.();
}

function toColorScheme(value: string | undefined): ColorSchemeType {
  return value === 'dark' ? 'dark' : 'light';
}

/**
 * Подписка на смену темы.
 *
 * Сразу отдаём схему из параметров запуска — иначе приложение успевает
 * мигнуть светлым у тех, у кого клиент тёмный. Дальше, когда загрузится
 * скрипт, переходим на его значение: оно точнее и обновляется само.
 *
 * Если скрипт не загрузился, остаётся подписка на настройку устройства —
 * раньше в этом случае тема просто застывала светлой.
 */
export function subscribeTelegramColorScheme(
  listener: (scheme: ColorSchemeType) => void,
): () => void {
  listener(captureTelegramLaunch()?.colorScheme ?? readColorScheme(null));

  let app: TelegramWebApp | null = null;
  let cancelled = false;

  const fromApp = (): void => {
    listener(toColorScheme(app?.colorScheme));
  };

  // Запасной источник на случай, если скрипт Telegram не доехал.
  let media: MediaQueryList | null = null;
  const fromDevice = (): void => {
    if (app === null) {
      listener(media?.matches === true ? 'dark' : 'light');
    }
  };
  try {
    media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', fromDevice);
  } catch {
    media = null;
  }

  void initTelegramSdk().then(() => {
    if (cancelled) {
      return;
    }
    app = webApp();
    if (app === null) {
      return;
    }
    fromApp();
    app.onEvent?.('themeChanged', fromApp);
  });

  return () => {
    cancelled = true;
    media?.removeEventListener('change', fromDevice);
    app?.offEvent?.('themeChanged', fromApp);
  };
}
