import type { Prisma } from '@prisma/client';

import { REQUEST_STATUS } from '@vk-rideshare/shared';

/**
 * Участники поездки — автор и все, чей отклик принят.
 * Именно этот список решает, кто кому может оставить отзыв.
 */
export async function getParticipants(
  tx: Prisma.TransactionClient,
  tripId: string,
): Promise<{ authorId: string; participantIds: string[] } | null> {
  const trip = await tx.trip.findUnique({
    where: { id: tripId },
    select: { authorId: true },
  });
  if (trip === null) {
    return null;
  }

  const accepted = await tx.tripRequest.findMany({
    where: { tripId, status: REQUEST_STATUS.ACCEPTED },
    select: { userId: true },
  });

  return {
    authorId: trip.authorId,
    participantIds: [trip.authorId, ...accepted.map((request) => request.userId)],
  };
}

/** Пересчитывает рейтинг адресата по всем его отзывам. Вызывать внутри транзакции. */
export async function recalculateRating(
  tx: Prisma.TransactionClient,
  targetId: string,
): Promise<void> {
  const aggregate = await tx.review.aggregate({
    where: { targetId },
    _avg: { rating: true },
    _count: { _all: true },
  });

  const count = aggregate._count?._all ?? 0;
  const average = aggregate._avg?.rating ?? 0;

  await tx.user.update({
    where: { id: targetId },
    data: {
      ratingCount: count,
      ratingAvg: Math.round(average * 100) / 100,
    },
  });
}
