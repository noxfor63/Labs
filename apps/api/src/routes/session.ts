import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { phoneInputSchema, type SessionResponse } from '@vk-rideshare/shared';

import { principalWhere } from '../lib/principal.js';
import { parseWith } from '../lib/validate.js';
import { toUserPublic } from '../lib/serializers.js';
import type { RouteDeps } from './types.js';

/**
 * Профиль, который фронтенд получил у своей площадки.
 * Бэкенд ему доверяет ровно настолько, насколько доверяет подписи запуска:
 * идентификатор берётся из подписанных параметров, а не из тела.
 *
 * Все поля необязательны: вне фрейма площадки профиль не отдаётся, и
 * затирать уже сохранённое имя заглушкой в таком случае нельзя.
 */
const sessionBodySchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  photoUrl: z.string().trim().max(500).nullish(),
  city: z.string().trim().max(100).nullish(),
  /**
   * Номер для связи. Приводится к +7XXXXXXXXXX здесь же: доверять
   * нормализации на клиенте нельзя — запрос можно отправить и мимо него.
   */
  phone: phoneInputSchema.optional(),
});

export const sessionRoutes = ({ prisma, writeRateLimit }: RouteDeps): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.post(
      '/session',
      { config: { rateLimit: writeRateLimit } },
      async (request): Promise<SessionResponse> => {
        const body = parseWith(sessionBodySchema, request.body ?? {});
        const principal = request.principal;

        /*
         * Подписанный профиль площадки важнее присланного телом: Telegram
         * кладёт имя и фото прямо в initData, и подделать их нельзя, а
         * тело запроса — можно. У ВКонтакте подписанного профиля нет,
         * поэтому там всё остаётся как было.
         */
        const signed = principal.profile;

        // В update попадают только присланные поля — то, чего клиент не знает,
        // остаётся как было.
        const update: {
          firstName?: string;
          lastName?: string;
          photoUrl?: string | null;
          city?: string | null;
          phone?: string | null;
        } = {};
        if (signed !== undefined) {
          update.firstName = signed.firstName;
          update.lastName = signed.lastName;
          update.photoUrl = signed.photoUrl;
        } else {
          if (body.firstName !== undefined) {
            update.firstName = body.firstName;
          }
          if (body.lastName !== undefined) {
            update.lastName = body.lastName;
          }
          if (body.photoUrl !== undefined) {
            update.photoUrl = body.photoUrl ?? null;
          }
        }
        if (body.city !== undefined) {
          update.city = body.city ?? null;
        }
        if (body.phone !== undefined) {
          update.phone = body.phone;
        }

        /**
         * Единственное место, где пользователь заводится. Ключ поиска и
         * колонка при создании — одна и та же, своя для каждой площадки,
         * поэтому и то и другое собирается из principal.
         */
        const user = await prisma.user.upsert({
          where: principalWhere(principal),
          create: {
            ...principalWhere(principal),
            firstName: signed?.firstName ?? body.firstName ?? 'Пользователь',
            lastName: signed?.lastName ?? body.lastName ?? '',
            photoUrl: signed?.photoUrl ?? body.photoUrl ?? null,
            city: body.city ?? null,
            phone: body.phone ?? null,
          },
          update,
        });

        return { user: toUserPublic(user) };
      },
    );
  };
};
