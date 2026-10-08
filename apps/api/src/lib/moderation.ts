/**
 * Разбор жалоб: кто имеет на него право и что именно разбирают.
 *
 * Лежит отдельно от маршрутов, потому что у разбора две двери — экран в
 * приложении и команда на сервере. Если бы каждая считала по-своему,
 * они разошлись бы на первой же правке: в списке одно, в приложении
 * другое. Здесь общая середина, и обе двери зовут её.
 */
import type { PrismaClient, User } from '@prisma/client';

import { REPORT_TARGET, type ReportTarget } from '@vk-rideshare/shared';

import type { AppEnv } from '../env.js';
import { recalculateRating } from './participants.js';
import type { Principal } from './principal.js';

/** Имеет ли этот человек право разбирать жалобы. */
export function isModerator(principal: Principal, env: AppEnv): boolean {
  return env.moderators.some(
    (moderator) =>
      moderator.platform === principal.platform &&
      moderator.platformUserId === principal.platformUserId,
  );
}

export type TargetInfo = {
  /** Автор того, на что пожаловались. null — объекта уже нет. */
  owner: User | null;
  /** Сам контент, готовый к показу: несколько строк текста. */
  body: string;
};

/**
 * Время — в UTC и с явной пометкой.
 *
 * Разбирающий сравнивает написанное с тем, что видел пожаловавшийся, а
 * тот видел местное время. Без пометки разница в пять часов выглядит как
 * «не та поездка».
 */
const when = (date: Date): string =>
  `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

const lines = (values: (string | null)[]): string =>
  values.filter((value) => value !== null).join('\n');

/**
 * Что именно обжалуют — текстом.
 *
 * Жалобу нельзя разобрать по идентификатору: смотрят всегда на сам
 * текст. Поэтому и экран, и команда показывают содержимое рядом с
 * жалобой, а не ссылку на него.
 */
export async function describeTarget(
  prisma: PrismaClient,
  target: ReportTarget,
  targetId: string,
): Promise<TargetInfo> {
  if (target === REPORT_TARGET.TRIP) {
    const trip = await prisma.trip.findUnique({
      where: { id: targetId },
      include: { author: true },
    });
    if (trip === null) {
      return { owner: null, body: 'Объявление уже удалено' };
    }
    return {
      owner: trip.author,
      body: lines([
        `${trip.fromCity} → ${trip.toCity}, ${when(trip.departAt)}, ${trip.priceRub} ₽`,
        trip.fromPoint === null ? null : `Откуда: ${trip.fromPoint}`,
        trip.toPoint === null ? null : `Куда: ${trip.toPoint}`,
        trip.carModel === null ? null : `Машина: ${trip.carModel}`,
        trip.comment === null ? null : `Комментарий: ${trip.comment}`,
      ]),
    };
  }

  if (target === REPORT_TARGET.REVIEW) {
    const review = await prisma.review.findUnique({
      where: { id: targetId },
      include: { author: true, target: true },
    });
    if (review === null) {
      return { owner: null, body: 'Отзыв уже удалён' };
    }
    return {
      owner: review.author,
      body: lines([
        `Оценка ${review.rating} о ${review.target.firstName} ${review.target.lastName}`.trim(),
        review.text === null ? 'Без текста' : review.text,
      ]),
    };
  }

  const user = await prisma.user.findUnique({ where: { id: targetId } });
  if (user === null) {
    return { owner: null, body: 'Профиль удалён' };
  }
  return {
    owner: user,
    body: lines([
      `Имя: ${`${user.firstName} ${user.lastName}`.trim()}`,
      user.city === null ? null : `Город: ${user.city}`,
      user.phone === null ? null : `Телефон: ${user.phone}`,
      user.photoUrl === null ? null : `Фото: ${user.photoUrl}`,
    ]),
  };
}

/**
 * Удаляет контент, на который пожаловались.
 *
 * Возвращает false, если удалять нечего: у профиля нет «контента»
 * отдельно от человека, и такая жалоба закрывается блокировкой.
 */
export async function removeContent(
  prisma: PrismaClient,
  target: ReportTarget,
  targetId: string,
): Promise<boolean> {
  if (target === REPORT_TARGET.TRIP) {
    const trip = await prisma.trip.findUnique({ where: { id: targetId } });
    if (trip !== null) {
      await prisma.trip.delete({ where: { id: targetId } });
    }
    return true;
  }

  if (target === REPORT_TARGET.REVIEW) {
    const review = await prisma.review.findUnique({ where: { id: targetId } });
    if (review !== null) {
      // Рейтинг адресата пересчитывается той же транзакцией: удалённый
      // отзыв не должен продолжать влиять на среднюю оценку.
      await prisma.$transaction(async (tx) => {
        await tx.review.delete({ where: { id: review.id } });
        await recalculateRating(tx, review.targetId);
      });
    }
    return true;
  }

  return false;
}

/** Закрыть или вернуть доступ. */
export async function setBlocked(
  prisma: PrismaClient,
  userId: string,
  blocked: boolean,
): Promise<User> {
  return prisma.user.update({
    where: { id: userId },
    data: { blockedAt: blocked ? new Date() : null },
  });
}
