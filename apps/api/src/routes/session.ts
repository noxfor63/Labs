import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { SessionResponse } from '@vk-rideshare/shared';

import { parseWith } from '../lib/validate.js';
import { toUserPublic } from '../lib/serializers.js';
import type { RouteDeps } from './types.js';

/**
 * Профиль, который фронтенд получил через VKWebAppGetUserInfo.
 * Бэкенд ему доверяет ровно настолько, насколько доверяет подписи запуска:
 * vkUserId берётся из подписанных launch-параметров, а не из тела.
 */
const sessionBodySchema = z.object({
  firstName: z.string().trim().min(1).max(100).default('Пользователь'),
  lastName: z.string().trim().max(100).default(''),
  photoUrl: z.string().trim().max(500).nullish(),
  city: z.string().trim().max(100).nullish(),
});

export const sessionRoutes = ({ prisma, writeRateLimit }: RouteDeps): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.post(
      '/session',
      { config: { rateLimit: writeRateLimit } },
      async (request): Promise<SessionResponse> => {
        const body = parseWith(sessionBodySchema, request.body ?? {});
        const vkUserId = request.vk.vkUserId;

        const profile = {
          firstName: body.firstName,
          lastName: body.lastName,
          photoUrl: body.photoUrl ?? null,
          city: body.city ?? null,
        };

        const user = await prisma.user.upsert({
          where: { vkUserId },
          create: { vkUserId, ...profile },
          update: profile,
        });

        return { user: toUserPublic(user) };
      },
    );
  };
};
