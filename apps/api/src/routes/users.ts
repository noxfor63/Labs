import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import {
  REQUEST_STATUS,
  TRIP_STATUS,
  type UserProfileResponse,
} from '@vk-rideshare/shared';

import { notFound } from '../lib/errors.js';
import { toReview, toUserPublic } from '../lib/serializers.js';
import { parseWith } from '../lib/validate.js';
import type { RouteDeps } from './types.js';

const paramsSchema = z.object({
  vkUserId: z.string().regex(/^\d{1,19}$/, 'Некорректный идентификатор пользователя'),
});

export const userRoutes = ({ prisma }: RouteDeps): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.get('/users/:vkUserId', async (request): Promise<UserProfileResponse> => {
      const params = parseWith(paramsSchema, request.params);
      const vkUserId = BigInt(params.vkUserId);

      const user = await prisma.user.findUnique({ where: { vkUserId } });
      if (user === null) {
        throw notFound('Пользователь не найден');
      }

      // Завершённая поездка засчитывается и автору, и принятому пассажиру.
      const [asAuthor, asParticipant, reviews] = await Promise.all([
        prisma.trip.count({ where: { authorVkId: vkUserId, status: TRIP_STATUS.COMPLETED } }),
        prisma.tripRequest.count({
          where: {
            userVkId: vkUserId,
            status: REQUEST_STATUS.ACCEPTED,
            trip: { status: TRIP_STATUS.COMPLETED },
          },
        }),
        prisma.review.findMany({
          where: { targetVkId: vkUserId },
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { author: true, target: true },
        }),
      ]);

      return {
        user: toUserPublic(user),
        completedTripsCount: asAuthor + asParticipant,
        reviews: reviews.map(toReview),
      };
    });
  };
};
