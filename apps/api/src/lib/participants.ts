import type { Prisma } from '@prisma/client';

import { REQUEST_STATUS } from '@vk-rideshare/shared';

/**
 * Участники поездки — автор и все, чей отклик принят.
 * Именно этот список решает, кто кому может оставить отзыв.
 */
export async function getParticipants(
  tx: Prisma.TransactionClient,
  tripId: string,
): Promise<{ authorVkId: bigint; participantVkIds: bigint[] } | null> {
  const trip = await tx.trip.findUnique({
    where: { id: tripId },
    select: { authorVkId: true },
  });
  if (trip === null) {
    return null;
  }

  const accepted = await tx.tripRequest.findMany({
    where: { tripId, status: REQUEST_STATUS.ACCEPTED },
    select: { userVkId: true },
  });

  return {
    authorVkId: trip.authorVkId,
    participantVkIds: [trip.authorVkId, ...accepted.map((request) => request.userVkId)],
  };
}

/** Пересчитывает рейтинг адресата по всем его отзывам. Вызывать внутри транзакции. */
export async function recalculateRating(
  tx: Prisma.TransactionClient,
  targetVkId: bigint,
): Promise<void> {
  const aggregate = await tx.review.aggregate({
    where: { targetVkId },
    _avg: { rating: true },
    _count: { _all: true },
  });

  const count = aggregate._count._all;
  const average = aggregate._avg.rating ?? 0;

  await tx.user.update({
    where: { vkUserId: targetVkId },
    data: {
      ratingCount: count,
      ratingAvg: Math.round(average * 100) / 100,
    },
  });
}
