/**
 * Аутентификация запроса.
 *
 * Площадка определяется по заголовку: X-Launch-Params — ВКонтакте,
 * X-Telegram-Init-Data — Telegram. Подпись и свежесть проверяются на
 * каждом запросе; сессий и куки нет намеренно — состояние на бэкенде не
 * нужно.
 *
 * В базу хук не ходит: он устанавливает только то, что следует из
 * подписи, — площадку, идентификатор на ней и, если площадка его
 * подписала, профиль. Сопоставление с пользователем приложения делают
 * маршруты через requireUserId, потому что самому частому запросу —
 * ленте поездок — личность не нужна.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { LAUNCH_PARAMS_HEADER, TELEGRAM_INIT_DATA_HEADER } from '@vk-rideshare/shared';

import type { AppEnv } from '../env.js';
import { unauthorized } from '../lib/errors.js';
import {
  LaunchParamsError,
  resignMockLaunchParams,
  verifyLaunchParams,
} from '../lib/launch-params.js';
import { PLATFORM, type Principal } from '../lib/principal.js';
import { TelegramInitDataError, verifyInitData } from '../lib/telegram-init-data.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Площадка, идентификатор на ней и подписанный профиль. Заполняется хуком. */
    principal: Principal;
  }
}

export type AuthPluginOptions = {
  env: AppEnv;
};

/** Значение заголовка как одна строка; пустое — считаем отсутствующим. */
function header(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === 'string' && single.trim() !== '' ? single : null;
}

function authenticateVk(raw: string | null, env: AppEnv): Principal {
  let query = raw;
  if (query === null) {
    // Предохранитель №1: env.mockLaunchParams принудительно пуст в продакшене.
    // Предохранитель №2: явная проверка isProduction здесь.
    if (!env.isProduction && env.mockLaunchParams !== '') {
      query = resignMockLaunchParams(env.mockLaunchParams, env.VK_APP_SECRET);
    } else {
      throw unauthorized('Заголовок X-Launch-Params отсутствует');
    }
  }

  try {
    const verified = verifyLaunchParams(query, env.VK_APP_SECRET);
    return { platform: PLATFORM.VK, platformUserId: verified.vkUserId };
  } catch (error) {
    if (error instanceof LaunchParamsError) {
      // Причину отдаём клиенту: она не раскрывает ключ и помогает отладке.
      throw unauthorized(error.message);
    }
    throw error;
  }
}

function authenticateTelegram(raw: string, env: AppEnv): Principal {
  if (!env.telegramEnabled) {
    throw unauthorized('Площадка Telegram не настроена на этом сервере');
  }

  try {
    const verified = verifyInitData(raw, env.TELEGRAM_BOT_TOKEN);
    return {
      platform: PLATFORM.TG,
      platformUserId: verified.user.id,
      /*
       * Профиль пришёл подписанным — в отличие от ВКонтакте, где имя и
       * фото фронтенд получает мостом и присылает телом запроса. Раз
       * Telegram их подписал, тело для этих полей больше не нужно: ему
       * верить не обязательно.
       */
      profile: {
        firstName: verified.user.firstName,
        lastName: verified.user.lastName,
        photoUrl: verified.user.photoUrl,
      },
    };
  } catch (error) {
    if (error instanceof TelegramInitDataError) {
      throw unauthorized(error.message);
    }
    throw error;
  }
}

const plugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, options) => {
  const { env } = options;

  // Значение проставляет хук ниже; декоратор нужен, чтобы форма объекта
  // request была одинаковой для всех запросов.
  fastify.decorateRequest('principal', undefined as unknown as Principal);

  fastify.addHook('preHandler', async (request) => {
    const telegram = header(request, TELEGRAM_INIT_DATA_HEADER);
    request.principal =
      telegram === null
        ? authenticateVk(header(request, LAUNCH_PARAMS_HEADER), env)
        : authenticateTelegram(telegram, env);
  });
};

export const authPlugin = fp(plugin, { name: 'auth' });
