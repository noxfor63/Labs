import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { phoneInputSchema, type SessionResponse } from '@vk-rideshare/shared';

import { parseWith } from '../lib/validate.js';
import { toUserPublic } from '../lib/serializers.js';
import type { RouteDeps } from './types.js';

/**
 * Профиль, который фронтенд получил через VKWebAppGetUserInfo.
 * Бэкенд ему доверяет ровно настолько, насколько доверяет подписи запуска:
 * vkUserId берётся из подписанных launch-параметров, а не из тела.
 *
 * Все поля необязательны: вне фрейма ВКонтакте мост профиль не отдаёт,
 * и затирать уже сохранённое имя заглушкой в таком случае нельзя.
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
        const vkUserId = request.vk.vkUserId;

        // В update попадают только присланные поля — то, чего клиент не знает,
        // остаётся как было.
        const update: {
          firstName?: string;
          lastName?: string;
          photoUrl?: string | null;
          city?: string | null;
          phone?: string | null;
        } = {};
        if (body.firstName !== undefined) {
          update.firstName = body.firstName;
        }
        if (body.lastName !== undefined) {
          update.lastName = body.lastName;
        }
        if (body.photoUrl !== undefined) {
          update.photoUrl = body.photoUrl ?? null;
        }
        if (body.city !== undefined) {
          update.city = body.city ?? null;
        }
        if (body.phone !== undefined) {
          update.phone = body.phone;
        }

        const user = await prisma.user.upsert({
          where: { vkUserId },
          create: {
            vkUserId,
            firstName: body.firstName ?? 'Пользователь',
            lastName: body.lastName ?? '',
            photoUrl: body.photoUrl ?? null,
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
