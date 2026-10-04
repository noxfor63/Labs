import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import {
  ERROR_CODE,
  REQUEST_STATUS,
  TRIP_STATUS,
  createTripRequestSchema,
  createTripSchema,
  patchTripSchema,
  tripListQuerySchema,
  type TripDetail,
  type TripListResponse,
  type TripRequestDto,
  type TripSummary,
} from '@vk-rideshare/shared';

import { decodeCursor, encodeCursor } from '../lib/cursor.js';
import { conflict, forbidden, notFound, validationFailed } from '../lib/errors.js';
import { getParticipants } from '../lib/participants.js';
import { requireUserId } from '../lib/principal.js';
import { toTripDetail, toTripRequest, toTripSummary, toUserPublic } from '../lib/serializers.js';
import { parseWith } from '../lib/validate.js';
import type { RouteDeps } from './types.js';

const idParamSchema = z.object({ id: z.string().min(1) });

/** Календарный день в UTC: [date 00:00, date+1 00:00). */
function dayRange(date: string): { gte: Date; lt: Date } {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { gte: start, lt: end };
}

export const tripRoutes = ({ prisma, writeRateLimit }: RouteDeps): FastifyPluginAsync => {
  const writeConfig = { rateLimit: writeRateLimit };

  return async (fastify) => {
    /* ─────────────── лента поездок ─────────────── */

    fastify.get('/trips', async (request): Promise<TripListResponse> => {
      const query = parseWith(tripListQuerySchema, request.query ?? {});
      const now = new Date();

      const filters: Prisma.TripWhereInput[] = [
        { status: TRIP_STATUS.ACTIVE },
        { departAt: { gt: now } },
      ];

      if (query.from !== undefined) {
        filters.push({ fromCity: query.from });
      }
      if (query.to !== undefined) {
        filters.push({ toCity: query.to });
      }
      if (query.date !== undefined) {
        const range = dayRange(query.date);
        filters.push({ departAt: range });
      }
      if (query.role !== undefined) {
        filters.push({ role: query.role });
      }
      if (query.priceMax !== undefined) {
        // NULL <= x в SQL не истина, поэтому поездки без цены сюда не попадут —
        // это осознанно: фильтр по бюджету не должен возвращать «цена не указана».
        filters.push({ priceRub: { lte: query.priceMax } });
      }
      if (query.seatsMin !== undefined) {
        filters.push({ seatsLeft: { gte: query.seatsMin } });
      }

      if (query.cursor !== undefined) {
        const cursor = decodeCursor(query.cursor);
        if (cursor === null) {
          throw validationFailed('cursor: некорректный курсор');
        }
        filters.push({
          OR: [
            { departAt: { gt: cursor.departAt } },
            { departAt: cursor.departAt, id: { gt: cursor.id } },
          ],
        });
      }

      const rows = await prisma.trip.findMany({
        where: { AND: filters },
        orderBy: [{ departAt: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
        include: { author: true },
      });

      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page.at(-1);

      return {
        items: page.map((trip) => toTripSummary(trip, now)),
        nextCursor:
          hasMore && last !== undefined
            ? encodeCursor({ departAt: last.departAt, id: last.id })
            : null,
      };
    });

    /* ─────────────── создание ─────────────── */

    fastify.post(
      '/trips',
      { config: writeConfig },
      async (request, reply): Promise<TripSummary> => {
        const input = parseWith(createTripSchema, request.body ?? {});
        const authorId = await requireUserId(prisma, request.principal);

        const trip = await prisma.trip.create({
          data: {
            authorId,
            role: input.role,
            fromCity: input.fromCity,
            fromPoint: input.fromPoint,
            toCity: input.toCity,
            toPoint: input.toPoint,
            departAt: new Date(input.departAt),
            seatsTotal: input.seatsTotal,
            seatsLeft: input.seatsTotal,
            priceRub: input.priceRub,
            carModel: input.carModel,
            comment: input.comment,
          },
          include: { author: true },
        });

        reply.code(201);
        return toTripSummary(trip);
      },
    );

    /* ─────────────── детали ─────────────── */

    fastify.get('/trips/:id', async (request): Promise<TripDetail> => {
      const { id } = parseWith(idParamSchema, request.params);
      const viewerId = await requireUserId(prisma, request.principal);

      const trip = await prisma.trip.findUnique({
        where: { id },
        include: {
          author: true,
          requests: { include: { user: true }, orderBy: { createdAt: 'asc' } },
        },
      });
      if (trip === null) {
        throw notFound('Поездка не найдена');
      }

      let canReview = false;
      if (trip.status === TRIP_STATUS.COMPLETED) {
        const accepted = trip.requests.filter(
          (item) => item.status === REQUEST_STATUS.ACCEPTED,
        );
        const participantIds = [trip.authorId, ...accepted.map((item) => item.userId)];
        if (participantIds.includes(viewerId)) {
          const already = await prisma.review.findMany({
            where: { tripId: trip.id, authorId: viewerId },
            select: { targetId: true },
          });
          const reviewed = new Set(already.map((item) => item.targetId.toString()));
          canReview = participantIds.some(
            (vkId) => vkId !== viewerId && !reviewed.has(vkId.toString()),
          );
        }
      }

      return toTripDetail({
        trip,
        requests: trip.requests,
        viewerId,
        canReview,
      });
    });

    /* ─────────────── завершение / отмена ─────────────── */

    fastify.patch(
      '/trips/:id',
      { config: writeConfig },
      async (request): Promise<TripSummary> => {
        const { id } = parseWith(idParamSchema, request.params);
        const input = parseWith(patchTripSchema, request.body ?? {});

        const viewerId = await requireUserId(prisma, request.principal);
        const existing = await prisma.trip.findUnique({ where: { id } });
        if (existing === null) {
          throw notFound('Поездка не найдена');
        }
        if (existing.authorId !== viewerId) {
          throw forbidden('Менять статус поездки может только её автор');
        }
        if (existing.status !== TRIP_STATUS.ACTIVE) {
          throw conflict(
            ERROR_CODE.TRIP_NOT_ACTIVE,
            'Поездка уже завершена или отменена',
          );
        }

        const trip = await prisma.trip.update({
          where: { id },
          data: { status: input.status },
          include: { author: true },
        });
        return toTripSummary(trip);
      },
    );

    /* ─────────────── отклик ─────────────── */

    fastify.post(
      '/trips/:id/requests',
      { config: writeConfig },
      async (request, reply): Promise<TripRequestDto> => {
        const { id } = parseWith(idParamSchema, request.params);
        const input = parseWith(createTripRequestSchema, request.body ?? {});
        const userId = await requireUserId(prisma, request.principal);

        const trip = await prisma.trip.findUnique({ where: { id } });
        if (trip === null) {
          throw notFound('Поездка не найдена');
        }
        if (trip.authorId === userId) {
          throw conflict(ERROR_CODE.OWN_TRIP, 'Нельзя откликнуться на собственную поездку');
        }
        if (trip.status !== TRIP_STATUS.ACTIVE) {
          throw conflict(ERROR_CODE.TRIP_NOT_ACTIVE, 'Поездка уже завершена или отменена');
        }
        if (trip.departAt.getTime() <= Date.now()) {
          throw conflict(ERROR_CODE.TRIP_IN_PAST, 'Поездка уже состоялась');
        }
        if (trip.seatsLeft <= 0) {
          throw conflict(ERROR_CODE.NO_SEATS_LEFT, 'Свободных мест не осталось');
        }

        const duplicate = await prisma.tripRequest.findUnique({
          where: { tripId_userId: { tripId: id, userId } },
        });
        if (duplicate !== null) {
          throw conflict(ERROR_CODE.ALREADY_REQUESTED, 'Вы уже откликнулись на эту поездку');
        }

        // Уникальный индекс (tripId, userId) — последняя защита от гонки
        // между проверкой выше и вставкой.
        let created;
        try {
          created = await prisma.tripRequest.create({
            data: { tripId: id, userId, message: input.message },
            include: { user: true },
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw conflict(ERROR_CODE.ALREADY_REQUESTED, 'Вы уже откликнулись на эту поездку');
          }
          throw error;
        }

        reply.code(201);
        return toTripRequest(created);
      },
    );

    /* ─────────────── кандидаты на отзыв ─────────────── */

    fastify.get('/trips/:id/reviewable', async (request) => {
      const { id } = parseWith(idParamSchema, request.params);
      const viewerId = await requireUserId(prisma, request.principal);

      const trip = await prisma.trip.findUnique({ where: { id }, include: { author: true } });
      if (trip === null) {
        throw notFound('Поездка не найдена');
      }
      if (trip.status !== TRIP_STATUS.COMPLETED) {
        throw conflict(
          ERROR_CODE.TRIP_NOT_COMPLETED,
          'Отзыв можно оставить только по завершённой поездке',
        );
      }

      const info = await getParticipants(prisma, id);
      if (info === null || !info.participantIds.includes(viewerId)) {
        throw forbidden('Вы не были участником этой поездки');
      }

      const others = info.participantIds.filter((participantId) => participantId !== viewerId);
      const [users, already] = await Promise.all([
        prisma.user.findMany({ where: { id: { in: others } } }),
        prisma.review.findMany({
          where: { tripId: id, authorId: viewerId },
          select: { targetId: true },
        }),
      ]);

      return {
        trip: toTripSummary(trip),
        // Тот же сериализатор, что и везде: раньше здесь был руками
        // собранный объект, и он разъехался бы с UserPublic при первом же
        // новом поле — что и случилось, когда появились площадки.
        participants: users.map(toUserPublic),
        alreadyReviewedUserIds: already.map((item) => item.targetId),
      };
    });
  };
};

/** P2002 — нарушение уникального индекса Prisma. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
