/**
 * Площадка, в которой запущено приложение.
 *
 * Весь остальной код работает через этот слой и не знает, ВКонтакте
 * вокруг или Telegram. Площадки отличаются в четырёх вещах, и ровно они
 * и вынесены в интерфейс: заголовок авторизации, профиль, телефон и
 * оформление.
 *
 * Выбор делается один раз при загрузке: Telegram кладёт данные запуска в
 * адрес, и если они там есть — мы в Telegram, иначе считаем, что в
 * ВКонтакте. Порядок именно такой, потому что проверка Telegram
 * однозначна, а `bridge.isEmbedded()` возвращает true и в чужом фрейме.
 */
import {
  LAUNCH_PARAMS_HEADER,
  TELEGRAM_INIT_DATA_HEADER,
} from '@vk-rideshare/shared';
import type { ColorSchemeType } from '@vkontakte/vkui';

import { getLaunchParams, getLaunchParamsSource } from '../api/launch-params.js';
import {
  fetchVkPhone,
  fetchVkProfile,
  initBridge,
  subscribeColorScheme as subscribeVkColorScheme,
} from '../vk/bridge.js';
import {
  captureTelegramLaunch,
  getTelegramInitData,
  isInsideTelegram,
} from './telegram-launch.js';
import { initTelegramSdk, subscribeTelegramColorScheme } from './telegram-sdk.js';

export type PlatformId = 'vk' | 'tg';

/** Профиль, который площадка готова отдать для POST /api/session. */
export type PlatformProfile = {
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  city: string | null;
};

export type Platform = {
  id: PlatformId;
  /** Человеческое название — для экранов ошибок. */
  title: string;
  /** Заголовок авторизации, свой у каждой площадки. */
  authHeaders: () => Record<string, string>;
  /** Есть ли данные запуска вообще. */
  hasLaunchData: () => boolean;
  /** Подсказка, почему запуск не подтвердился. */
  launchHint: () => string;
  init: () => Promise<void>;
  /**
   * Профиль для отправки на сервер. null — площадка его не даёт либо он
   * приходит подписанным и серверу не нужен.
   */
  fetchProfile: () => Promise<PlatformProfile | null>;
  /** Телефон из профиля площадки. null — вводится руками. */
  fetchPhone: () => Promise<string | null>;
  subscribeColorScheme: (listener: (scheme: ColorSchemeType) => void) => () => void;
};

const vkPlatform: Platform = {
  id: 'vk',
  title: 'ВКонтакте',
  authHeaders: () => ({ [LAUNCH_PARAMS_HEADER]: getLaunchParams() }),
  hasLaunchData: () => getLaunchParams() !== '',
  launchHint: () => {
    switch (getLaunchParamsSource()) {
      case 'address':
        return 'Параметры запуска есть, но сервер их не принял. Чаще всего это значит, что они устарели — откройте приложение заново.';
      case 'cache':
        return 'Параметры запуска взяты из кэша вкладки и, похоже, устарели. Откройте приложение заново из ВКонтакте.';
      default:
        return 'В адресе нет параметров запуска. Так бывает, если открыть приложение по прямой ссылке, а не из ВКонтакте.';
    }
  },
  init: initBridge,
  fetchProfile: fetchVkProfile,
  fetchPhone: fetchVkPhone,
  subscribeColorScheme: subscribeVkColorScheme,
};

const telegramPlatform: Platform = {
  id: 'tg',
  title: 'Telegram',
  authHeaders: () => ({ [TELEGRAM_INIT_DATA_HEADER]: getTelegramInitData() }),
  hasLaunchData: () => getTelegramInitData() !== '',
  launchHint: () =>
    'Данные запуска не приняты сервером. Обычно это значит, что они устарели — закройте приложение и откройте заново из бота.',
  init: initTelegramSdk,
  /*
   * Профиль не отправляем намеренно: Telegram кладёт имя и фото прямо в
   * подписанный initData, и сервер берёт их оттуда. Присылать то же
   * самое телом запроса — значит давать себе возможность подделки там,
   * где её не было.
   */
  fetchProfile: async () => null,
  /*
   * Телефон Telegram отдаёт только через бота, по явному согласию в
   * диалоге, а не из мини-приложения. Пока это не сделано, номер
   * вводится руками — поле для него в форме и так есть.
   */
  fetchPhone: async () => null,
  subscribeColorScheme: subscribeTelegramColorScheme,
};

let resolved: Platform | null = null;

export function getPlatform(): Platform {
  if (resolved === null) {
    // Побочный эффект важен: перехват очищает хеш до запуска маршрутизатора.
    captureTelegramLaunch();
    resolved = isInsideTelegram() ? telegramPlatform : vkPlatform;
  }
  return resolved;
}
