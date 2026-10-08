import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import { ERROR_CODE } from '@vk-rideshare/shared';

import { prisma as defaultPrisma } from './db.js';
import { env as defaultEnv, type AppEnv } from './env.js';
import { ApiError } from './lib/errors.js';
import { authPlugin } from './plugins/auth.js';
import { meRoutes } from './routes/me.js';
import { reportRoutes } from './routes/reports.js';
import { requestRoutes } from './routes/requests.js';
import { reviewRoutes } from './routes/reviews.js';
import { sessionRoutes } from './routes/session.js';
import { tripRoutes } from './routes/trips.js';
import type { RateLimitConfig, RouteDeps } from './routes/types.js';
import { userRoutes } from './routes/users.js';

export type BuildAppOptions = {
  env?: AppEnv;
  prisma?: PrismaClient;
  logger?: boolean;
  /** Переопределение лимита на запись — нужно тестам самого лимита. */
  rateLimit?: RateLimitConfig;
};

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? defaultEnv;
  const prisma = options.prisma ?? defaultPrisma;

  const fastify = Fastify({
    logger:
      (options.logger ?? env.NODE_ENV !== 'test')
        ? {
            level: env.isProduction ? 'info' : 'debug',
            // x-launch-params содержит подпись запуска — в логи она не нужна.
            redact: {
              paths: ['req.headers["x-launch-params"]', 'req.headers.authorization'],
              remove: true,
            },
          }
        : false,
  });

  /**
   * Точные адреса из CORS_ORIGIN плюс шаблон хостинга VK, если задан
   * VK_APP_ID. @fastify/cors разбирает массив поэлементно и умеет
   * сравнивать и со строкой, и с регуляркой (см. isRequestOriginAllowed
   * в его исходниках), поэтому колбэк здесь не нужен.
   *
   * Пустой список остаётся запретом: origin: false — ни одного заголовка.
   */
  const allowedOrigins: (string | RegExp)[] = [
    ...env.corsOrigins,
    ...(env.vkHostingOrigin === null ? [] : [env.vkHostingOrigin]),
  ];

  await fastify.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    /*
     * Заголовки авторизации обеих площадок. Пропустить здесь новый
     * заголовок — классическая тихая поломка: сервер его принимает,
     * тесты через inject проходят, а браузер режет запрос на предполётной
     * проверке, и в приложении видно только «нет связи с сервером».
     */
    allowedHeaders: ['Content-Type', 'X-Launch-Params', 'X-Telegram-Init-Data'],
    maxAge: 600,
  });

  await fastify.register(rateLimit, {
    // Лимит включается точечно на пишущих маршрутах через config.rateLimit.
    global: false,
    /*
     * Ключ — площадка и идентификатор на ней, если запрос уже проверен,
     * иначе IP. Площадка в ключе обязательна: нумерация у ВКонтакте и
     * Telegram своя, и без неё двое разных людей с одинаковым числовым
     * идентификатором делили бы один лимит.
     */
    keyGenerator: (request) =>
      request.principal === undefined
        ? request.ip
        : `${request.principal.platform}:${request.principal.platformUserId}`,
  });

  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      void reply.code(error.statusCode).send(error.toResponse());
      return;
    }

    if (error instanceof ZodError) {
      void reply.code(400).send({
        error: {
          code: ERROR_CODE.VALIDATION_FAILED,
          message: error.issues.map((issue) => issue.message).join('; '),
        },
      });
      return;
    }

    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    const message =
      typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : 'Неизвестная ошибка';

    if (statusCode === 429) {
      void reply.code(429).send({
        error: {
          code: ERROR_CODE.RATE_LIMITED,
          message: 'Слишком много запросов, попробуйте чуть позже',
        },
      });
      return;
    }

    if (statusCode < 500) {
      void reply.code(statusCode).send({
        error: { code: ERROR_CODE.VALIDATION_FAILED, message },
      });
      return;
    }

    request.log.error({ err: error }, 'Необработанная ошибка');
    void reply.code(500).send({
      error: { code: ERROR_CODE.INTERNAL, message: 'Внутренняя ошибка сервера' },
    });
  });

  fastify.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send({
      error: { code: ERROR_CODE.NOT_FOUND, message: 'Маршрут не найден' },
    });
  });

  fastify.get('/health', async () => ({ status: 'ok' }));

  const writeRateLimit: RateLimitConfig =
    options.rateLimit ??
    (env.NODE_ENV === 'test'
      ? { max: 10_000, timeWindow: '1 minute' }
      : { max: 30, timeWindow: '1 minute' });

  const deps: RouteDeps = { prisma, env, writeRateLimit };

  await fastify.register(
    async (api) => {
      await api.register(authPlugin, { env });
      await api.register(sessionRoutes(deps));
      await api.register(tripRoutes(deps));
      await api.register(requestRoutes(deps));
      await api.register(meRoutes(deps));
      await api.register(reviewRoutes(deps));
      await api.register(userRoutes(deps));
      await api.register(reportRoutes(deps));
    },
    { prefix: '/api' },
  );

  return fastify;
}
