import type { FastifyPluginAsync } from 'fastify';

import {
  ERROR_CODE,
  TRIP_STATUS,
  createReviewSchema,
  type ReviewDto,
} from '@vk-rideshare/shared';

import { ApiError, conflict, notFound } from '../lib/errors.js';
import { getParticipants, recalculateRating } from '../lib/participants.js';
import { toReview } from '../lib/serializers.js';
import { parseWith } from '../lib/validate.js';
import { isUniqueViolation } from './trips.js';
import type { RouteDeps } from './types.js';

export const reviewRoutes = ({ prisma, writeRateLimit }: RouteDeps): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.post(
      '/reviews',
      { config: { rateLimit: writeRateLimit } },
      async (request, reply): Promise<ReviewDto> => {
        const input = parseWith(createReviewSchema, request.body ?? {});
        const authorVkId = request.vk.vkUserId;
        const targetVkId = BigInt(input.targetVkId);

        if (authorVkId === targetVkId) {
          throw conflict(ERROR_CODE.SELF_REVIEW, 'Нельзя оставить отзыв самому себе');
        }

        const review = await prisma.$transaction(async (tx) => {
          const trip = await tx.trip.findUnique({ where: { id: input.tripId } });
          if (trip === null) {
            throw notFound('Поездка не найдена');
          }
          if (trip.status !== TRIP_STATUS.COMPLETED) {
            throw conflict(
              ERROR_CODE.TRIP_NOT_COMPLETED,
              'Отзыв можно оставить только по завершённой поездке',
            );
          }

          const info = await getParticipants(tx, input.tripId);
          if (info === null || !info.participantVkIds.includes(authorVkId)) {
            throw new ApiError(
              403,
              ERROR_CODE.NOT_A_PARTICIPANT,
              'Вы не были участником этой поездки',
            );
          }
          if (!info.participantVkIds.includes(targetVkId)) {
            throw new ApiError(
              403,
              ERROR_CODE.NOT_A_PARTICIPANT,
              'Адресат отзыва не был участником этой поездки',
            );
          }

          let created;
          try {
            created = await tx.review.create({
              data: {
                tripId: input.tripId,
                authorVkId,
                targetVkId,
                rating: input.rating,
                text: input.text,
              },
              include: { author: true, target: true },
            });
          } catch (error) {
            if (isUniqueViolation(error)) {
              throw conflict(
                ERROR_CODE.ALREADY_REVIEWED,
                'Вы уже оставили отзыв этому участнику по этой поездке',
              );
            }
            throw error;
          }

          // Рейтинг пересчитывается той же транзакцией: иначе отзыв и
          // средняя оценка могут разойтись при падении между запросами.
          await recalculateRating(tx, targetVkId);

          return toReview(created);
        });

        reply.code(201);
        return review;
      },
    );
  };
};
