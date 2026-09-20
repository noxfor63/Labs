/**
 * Аутентификация по launch-параметрам ВКонтакте.
 *
 * Фронтенд кладёт исходную query-строку запуска в заголовок X-Launch-Params
 * при каждом запросе. Хук проверяет подпись и свежесть на каждом запросе —
 * сессий и куки нет намеренно: состояние на бэкенде не нужно.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { LAUNCH_PARAMS_HEADER } from '@vk-rideshare/shared';

import type { AppEnv } from '../env.js';
import { unauthorized } from '../lib/errors.js';
import {
  LaunchParamsError,
  resignMockLaunchParams,
  verifyLaunchParams,
  type VerifiedLaunchParams,
} from '../lib/launch-params.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Заполняется хуком авторизации; до него обращаться нельзя. */
    vk: VerifiedLaunchParams;
  }
}

export type AuthPluginOptions = {
  env: AppEnv;
};

function readLaunchParams(request: FastifyRequest, env: AppEnv): string {
  const header = request.headers[LAUNCH_PARAMS_HEADER];
  const fromHeader = Array.isArray(header) ? header[0] : header;

  if (typeof fromHeader === 'string' && fromHeader.trim() !== '') {
    return fromHeader;
  }

  // Предохранитель №1: env.mockLaunchParams принудительно пуст в продакшене.
  // Предохранитель №2: явная проверка isProduction здесь.
  if (!env.isProduction && env.mockLaunchParams !== '') {
    return resignMockLaunchParams(env.mockLaunchParams, env.VK_APP_SECRET);
  }

  throw unauthorized('Заголовок X-Launch-Params отсутствует');
}

const plugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, options) => {
  const { env } = options;

  // Значение проставляет хук ниже; декоратор нужен, чтобы форма объекта
  // request была одинаковой для всех запросов.
  fastify.decorateRequest('vk', undefined as unknown as VerifiedLaunchParams);

  fastify.addHook('preHandler', async (request) => {
    const rawQuery = readLaunchParams(request, env);
    try {
      request.vk = verifyLaunchParams(rawQuery, env.VK_APP_SECRET);
    } catch (error) {
      if (error instanceof LaunchParamsError) {
        // Причину отдаём клиенту: она не раскрывает ключ и помогает отладке.
        throw unauthorized(error.message);
      }
      throw error;
    }
  });
};

export const authPlugin = fp(plugin, { name: 'vk-auth' });
