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
  // Внутренний идентификатор, а не идентификатор площадки: профиль один,
  // с какой бы площадки человек ни пришёл.
  userId: z.string().min(1, 'Некорректный идентификатор пользователя'),
});

export const userRoutes = ({ prisma }: RouteDeps): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.get('/users/:userId', async (request): Promise<UserProfileResponse> => {
      const params = parseWith(paramsSchema, request.params);
      const userId = params.userId;

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user === null) {
        throw notFound('Пользователь не найден');
      }

      // Завершённая поездка засчитывается и автору, и принятому пассажиру.
      const [asAuthor, asParticipant, reviews] = await Promise.all([
        prisma.trip.count({ where: { authorId: userId, status: TRIP_STATUS.COMPLETED } }),
        prisma.tripRequest.count({
          where: {
            userId,
            status: REQUEST_STATUS.ACCEPTED,
            trip: { status: TRIP_STATUS.COMPLETED },
          },
        }),
        prisma.review.findMany({
          where: { targetId: userId },
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
