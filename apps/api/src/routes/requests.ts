import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import {
  ERROR_CODE,
  REQUEST_STATUS,
  TRIP_STATUS,
  patchTripRequestSchema,
  type TripRequestDto,
} from '@vk-rideshare/shared';

import { conflict, forbidden, notFound } from '../lib/errors.js';
import { toTripRequest } from '../lib/serializers.js';
import { parseWith } from '../lib/validate.js';
import type { RouteDeps } from './types.js';

const idParamSchema = z.object({ id: z.string().min(1) });

export const requestRoutes = ({ prisma, writeRateLimit }: RouteDeps): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.patch(
      '/requests/:id',
      { config: { rateLimit: writeRateLimit } },
      async (request): Promise<TripRequestDto> => {
        const { id } = parseWith(idParamSchema, request.params);
        const input = parseWith(patchTripRequestSchema, request.body ?? {});
        const viewerVkId = request.vk.vkUserId;

        return prisma.$transaction(async (tx) => {
          const existing = await tx.tripRequest.findUnique({
            where: { id },
            include: { trip: true },
          });
          if (existing === null) {
            throw notFound('Отклик не найден');
          }
          if (existing.trip.authorVkId !== viewerVkId) {
            throw forbidden('Принимать и отклонять отклики может только автор поездки');
          }
          if (existing.status !== REQUEST_STATUS.PENDING) {
            throw conflict(
              ERROR_CODE.REQUEST_NOT_PENDING,
              'Этот отклик уже обработан',
            );
          }
          if (existing.trip.status !== TRIP_STATUS.ACTIVE) {
            throw conflict(ERROR_CODE.TRIP_NOT_ACTIVE, 'Поездка уже завершена или отменена');
          }

          // Сначала «забираем» отклик условным UPDATE: если параллельная
          // транзакция уже перевела его из PENDING, здесь будет count = 0.
          const claimedRequest = await tx.tripRequest.updateMany({
            where: { id, status: REQUEST_STATUS.PENDING },
            data: { status: input.status },
          });
          if (claimedRequest.count === 0) {
            throw conflict(ERROR_CODE.REQUEST_NOT_PENDING, 'Этот отклик уже обработан');
          }

          if (input.status === REQUEST_STATUS.ACCEPTED) {
            // Ключевое место: условие seatsLeft > 0 проверяется той же командой,
            // которая уменьшает счётчик. Параллельная транзакция встанет на
            // блокировке строки, а после её снятия Postgres перепроверит
            // условие на новой версии строки и вернёт count = 0.
            const claimedSeat = await tx.trip.updateMany({
              where: { id: existing.tripId, seatsLeft: { gt: 0 } },
              data: { seatsLeft: { decrement: 1 } },
            });
            if (claimedSeat.count === 0) {
              // Бросаем — вся транзакция, включая перевод отклика, откатывается.
              throw conflict(ERROR_CODE.NO_SEATS_LEFT, 'Свободных мест не осталось');
            }
          }

          const updated = await tx.tripRequest.findUniqueOrThrow({
            where: { id },
            include: { user: true },
          });
          return toTripRequest(updated);
        });
      },
    );
  };
};
