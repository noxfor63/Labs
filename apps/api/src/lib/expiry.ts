/**
 * Закрытие поездок, время которых прошло.
 *
 * Зачем это нужно. Поездка живёт в статусе ACTIVE, пока автор вручную не
 * переведёт её в COMPLETED или CANCELLED. Если он этого не сделал —
 * а он почти никогда этого не делает, — объявление остаётся «активным»
 * навсегда, отклики висят в PENDING, а отзыв по поездке оставить нельзя:
 * отзывы разрешены только по COMPLETED. Уборка закрывает всё три дыры.
 *
 * Чего здесь намеренно НЕТ — удаления строк. Вместе с поездкой каскадом
 * ушли бы отклики и отзывы, а по отзывам считается рейтинг участников.
 * История дешевле места в базе.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

import { REQUEST_STATUS, TRIP_EXPIRY_GRACE_MINUTES, TRIP_STATUS } from '@vk-rideshare/shared';

/** Сколько поездок обрабатывать за один проход. Ограничивает размер транзакции. */
export const SWEEP_BATCH_SIZE = 500;

export type SweepOptions = {
  /** Точка отсчёта. Параметр существует ради тестов. */
  now?: Date;
  /** Сколько минут после выезда поездка ещё считается живой. */
  graceMinutes?: number;
  /** Максимум поездок за проход. */
  batchSize?: number;
};

export type SweepResult = {
  /** Поездки, у которых был хотя бы один принятый пассажир. */
  completed: number;
  /** Поездки, на которые так никто и не поехал. */
  cancelled: number;
  /** Отклики, оставшиеся без ответа до самого выезда. */
  cancelledRequests: number;
};

/**
 * Один проход уборки.
 *
 * Возвращает, сколько чего закрыл, — это и логируется, и проверяется тестом.
 * Вызывать безопасно сколько угодно раз: повторный проход по уже закрытым
 * поездкам ничего не находит, потому что фильтр требует статус ACTIVE.
 */
export async function sweepExpiredTrips(
  prisma: PrismaClient,
  options: SweepOptions = {},
): Promise<SweepResult> {
  const now = options.now ?? new Date();
  const graceMinutes = options.graceMinutes ?? TRIP_EXPIRY_GRACE_MINUTES;
  const batchSize = options.batchSize ?? SWEEP_BATCH_SIZE;

  const cutoff = new Date(now.getTime() - graceMinutes * 60 * 1000);

  const expired = await prisma.trip.findMany({
    where: { status: TRIP_STATUS.ACTIVE, departAt: { lte: cutoff } },
    select: { id: true },
    orderBy: { departAt: 'asc' },
    take: batchSize,
  });

  if (expired.length === 0) {
    return { completed: 0, cancelled: 0, cancelledRequests: 0 };
  }

  const ids = expired.map((trip) => trip.id);

  // Поездка «состоялась», если в ней был хотя бы один принятый пассажир.
  // Только такие имеет смысл переводить в COMPLETED: именно этот статус
  // открывает участникам возможность оставить отзыв друг о друге.
  const withPassengers = await prisma.tripRequest.findMany({
    where: { tripId: { in: ids }, status: REQUEST_STATUS.ACCEPTED },
    select: { tripId: true },
    distinct: ['tripId'],
  });
  const completedIds = withPassengers.map((request) => request.tripId);
  const completedSet = new Set(completedIds);
  const cancelledIds = ids.filter((id) => !completedSet.has(id));

  return prisma.$transaction(async (tx) => {
    // Отклики, до которых автор так и не добрался. Не DECLINED: автор их
    // не отклонял, просто вышло время. Врать о причине в истории не стоит.
    const cancelledRequests = await tx.tripRequest.updateMany({
      where: { tripId: { in: ids }, status: REQUEST_STATUS.PENDING },
      data: { status: REQUEST_STATUS.CANCELLED },
    });

    // Статус в условии повторно: между выборкой и этим UPDATE автор мог
    // закрыть поездку сам, и перетирать его решение нельзя.
    const completed = await updateTrips(tx, completedIds, TRIP_STATUS.COMPLETED);
    const cancelled = await updateTrips(tx, cancelledIds, TRIP_STATUS.CANCELLED);

    return {
      completed,
      cancelled,
      cancelledRequests: cancelledRequests.count,
    };
  });
}

async function updateTrips(
  tx: Prisma.TransactionClient,
  ids: string[],
  status: typeof TRIP_STATUS.COMPLETED | typeof TRIP_STATUS.CANCELLED,
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  const result = await tx.trip.updateMany({
    where: { id: { in: ids }, status: TRIP_STATUS.ACTIVE },
    data: { status },
  });
  return result.count;
}
