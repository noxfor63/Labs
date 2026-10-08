/**
 * Жалобы на пользовательский контент.
 *
 * Контент публикуется сразу: объявление нужно найти сегодня, а не после
 * проверки. Из этого следует постмодерация, а у постмодерации должен
 * быть вход — иначе «проверяем постфактум» означает «не проверяем».
 * Этот маршрут и есть вход.
 *
 * Жалоба не удаляет и не скрывает контент сама. Автоматическое скрытие
 * по счётчику выглядит заманчиво и ломается первым: на маршруте из трёх
 * городов двух-трёх согласованных нажатий хватит, чтобы убрать чужое
 * объявление. Поэтому решение принимает человек, а задача сервера —
 * записать жалобу и сказать о ней вслух в лог.
 */
import type { FastifyPluginAsync } from 'fastify';

import {
  ERROR_CODE,
  REPORT_TARGET,
  createReportSchema,
  type ReportDto,
  type ReportTarget,
} from '@vk-rideshare/shared';

import { conflict, notFound } from '../lib/errors.js';
import { requireUserId } from '../lib/principal.js';
import { parseWith } from '../lib/validate.js';
import { isUniqueViolation } from './trips.js';
import type { RouteDeps } from './types.js';

export const reportRoutes = ({ prisma, writeRateLimit }: RouteDeps): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.post(
      '/reports',
      { config: { rateLimit: writeRateLimit } },
      async (request, reply): Promise<ReportDto> => {
        const input = parseWith(createReportSchema, request.body ?? {});
        const reporterId = await requireUserId(prisma, request.principal);

        /*
         * Кто автор того, на что жалуются. Нужно для двух вещей: убедиться,
         * что объект вообще есть, и не дать пожаловаться на себя. Второе —
         * не из вежливости: своя жалоба на свой контент занимала бы место
         * настоящей (уникальность по «кто, на что») и сбивала бы разбор.
         */
        const ownerId = await findOwnerId(prisma, input.target, input.targetId);
        if (ownerId === null) {
          throw notFound('То, на что вы жалуетесь, уже удалено или не существует');
        }
        if (ownerId === reporterId) {
          throw conflict(ERROR_CODE.SELF_REPORT, 'Это ваш собственный контент');
        }

        let created;
        try {
          created = await prisma.report.create({
            data: {
              reporterId,
              target: input.target,
              targetId: input.targetId,
              reason: input.reason,
              comment: input.comment,
            },
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw conflict(
              ERROR_CODE.ALREADY_REPORTED,
              'Вы уже жаловались на это — жалоба в работе',
            );
          }
          throw error;
        }

        /*
         * Строка в логе — это оповещение: админки нет, и без неё жалоба
         * лежала бы в базе до того, как кто-нибудь догадается туда
         * посмотреть. Уровень warn выбран затем, чтобы она находилась
         * фильтром по уровню, а не чтением всего журнала.
         *
         * Текста пояснения здесь нет сознательно. Это произвольный ввод
         * человека, и его место — база, откуда его читают разбирая
         * жалобу, а не журнал сервера, который попадает в чужие глаза
         * проще и живёт дольше.
         */
        request.log.warn(
          {
            event: 'ugc_report',
            reportId: created.id,
            target: created.target,
            targetId: created.targetId,
            reason: created.reason,
            hasComment: created.comment !== null,
            ownerId,
            reporterId,
          },
          'Жалоба на пользовательский контент',
        );

        reply.code(201);
        return {
          id: created.id,
          target: created.target,
          targetId: created.targetId,
          reason: created.reason,
          comment: created.comment,
          status: created.status,
          createdAt: created.createdAt.toISOString(),
        };
      },
    );
  };
};

/**
 * Автор объекта жалобы либо null, если объекта нет.
 *
 * Для профиля автор — он сам: пожаловаться на имя, фотографию или номер
 * можно только тому, кто их указал.
 */
async function findOwnerId(
  prisma: RouteDeps['prisma'],
  target: ReportTarget,
  targetId: string,
): Promise<string | null> {
  switch (target) {
    case REPORT_TARGET.TRIP: {
      const trip = await prisma.trip.findUnique({
        where: { id: targetId },
        select: { authorId: true },
      });
      return trip?.authorId ?? null;
    }
    case REPORT_TARGET.REVIEW: {
      const review = await prisma.review.findUnique({
        where: { id: targetId },
        select: { authorId: true },
      });
      return review?.authorId ?? null;
    }
    case REPORT_TARGET.USER: {
      const user = await prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true },
      });
      return user?.id ?? null;
    }
  }
}
