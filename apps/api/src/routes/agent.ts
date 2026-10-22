/**
 * Адреса для агента канала: что выкачено и какие поездки есть.
 *
 * Агент пишет посты в канал и сам их не публикует — публикует владелец,
 * нажав кнопку. Но черновик должен опираться на правду, и правда двух
 * видов: что сейчас работает на сервере (о невыкаченном писать нельзя) и
 * какие поездки на ближайшие дни (из них собирается дайджест).
 *
 * Главное ограничение — здесь нет ничего личного. Агент работает на
 * Claude, то есть всё, что он видит, уходит стороннему сервису за
 * границу, а политика конфиденциальности (пункты 9.1 и 9.2) обещает, что
 * этого не происходит. Поэтому в ответе нет ни имён, ни телефонов, ни
 * идентификаторов, ни свободного текста: места сбора, комментарий и
 * машину человек пишет сам, и туда легко попадает телефон или имя.
 * Остаётся маршрут, время, роль, места и цена — то, что и так видно
 * любому в ленте и ни на кого не указывает.
 *
 * Авторизация отдельная от приложения — ключ в заголовке Authorization.
 * Подпись запуска ВКонтакте или Telegram сюда не пускает: агент — не
 * пользователь, а пользователю эти адреса не нужны. Без AGENT_API_TOKEN
 * адреса не регистрируются вовсе (см. app.ts).
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { TRIP_STATUS } from '@vk-rideshare/shared';

import { getBuildInfo } from '../lib/build-info.js';
import { unauthorized } from '../lib/errors.js';
import { parseWith } from '../lib/validate.js';
import type { RouteDeps } from './types.js';

const DAY = 24 * 60 * 60 * 1000;

/** Больше двух недель вперёд дайджесту не нужно, а лишнее — лишние токены. */
const tripsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(14).default(4),
});

/** Сотни строк агенту не прочитать с пользой; ближайшие — самые нужные. */
const TRIPS_LIMIT = 100;

/*
 * Сравнение через хеш: timingSafeEqual требует буферов одной длины, а
 * длина присланного ключа не должна ни ронять сравнение, ни подсказывать
 * длину настоящего.
 */
const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

function bearerToken(request: FastifyRequest): string | null {
  const value = request.headers.authorization;
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/.exec(value.trim());
  return match === null ? null : (match[1] ?? null);
}

export const agentRoutes = ({ prisma, env }: RouteDeps): FastifyPluginAsync => {
  const expected = digest(env.AGENT_API_TOKEN);

  return async (fastify) => {
    fastify.addHook('onRequest', async (request) => {
      const token = bearerToken(request);
      if (token === null || !timingSafeEqual(digest(token), expected)) {
        throw unauthorized('Нужен ключ агента в заголовке Authorization');
      }
    });

    /** Что выкачено и сколько живых поездок — с этого агент начинает обход. */
    fastify.get('/status', async () => {
      const build = getBuildInfo(env.APP_COMMIT);
      const activeTrips = await prisma.trip.count({
        where: { status: TRIP_STATUS.ACTIVE, departAt: { gt: new Date() } },
      });
      return { version: build.version, commit: build.commit, activeTrips };
    });

    /** Живые поездки на ближайшие дни — без единого личного поля. */
    fastify.get('/trips', async (request) => {
      const { days } = parseWith(tripsQuerySchema, request.query);
      const now = new Date();
      const rows = await prisma.trip.findMany({
        where: {
          status: TRIP_STATUS.ACTIVE,
          departAt: { gt: now, lt: new Date(now.getTime() + days * DAY) },
        },
        select: {
          fromCity: true,
          toCity: true,
          departAt: true,
          role: true,
          seatsTotal: true,
          seatsLeft: true,
          priceRub: true,
        },
        orderBy: { departAt: 'asc' },
        take: TRIPS_LIMIT,
      });

      return {
        generatedAt: now.toISOString(),
        days,
        items: rows.map((row) => ({ ...row, departAt: row.departAt.toISOString() })),
      };
    });
  };
};
