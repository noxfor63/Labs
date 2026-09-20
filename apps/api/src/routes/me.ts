import type { FastifyPluginAsync } from 'fastify';

import {
  myRequestsQuerySchema,
  myTripsQuerySchema,
  type MyRequestDto,
  type TripSummary,
} from '@vk-rideshare/shared';

import { toMyRequest, toTripSummary } from '../lib/serializers.js';
import { parseWith } from '../lib/validate.js';
import type { RouteDeps } from './types.js';

export const meRoutes = ({ prisma }: RouteDeps): FastifyPluginAsync => {
  return async (fastify) => {
    /** Мои объявления — то, что я создал сам. */
    fastify.get('/me/trips', async (request): Promise<{ items: TripSummary[] }> => {
      const query = parseWith(myTripsQuerySchema, request.query ?? {});
      const trips = await prisma.trip.findMany({
        where: {
          authorVkId: request.vk.vkUserId,
          ...(query.status === undefined ? {} : { status: query.status }),
        },
        orderBy: [{ departAt: 'desc' }],
        include: { author: true },
      });
      return { items: trips.map(toTripSummary) };
    });

    /** Мои отклики — то, куда я попросился. */
    fastify.get('/me/requests', async (request): Promise<{ items: MyRequestDto[] }> => {
      const query = parseWith(myRequestsQuerySchema, request.query ?? {});
      const requests = await prisma.tripRequest.findMany({
        where: {
          userVkId: request.vk.vkUserId,
          ...(query.status === undefined ? {} : { status: query.status }),
        },
        orderBy: [{ createdAt: 'desc' }],
        include: { user: true, trip: { include: { author: true } } },
      });
      return { items: requests.map(toMyRequest) };
    });
  };
};
