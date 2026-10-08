/**
 * Разбор жалоб из самого приложения.
 *
 * Вторая дверь к тому же, что делает команда `npm run moderate` на
 * сервере. Она появилась не для удобства: жалоба приходит в базу, а
 * оповестить владельца нечем — у сервера нет исходящего доступа к
 * Telegram, почта не настроена. Единственный канал, который точно
 * работает, — само приложение, и владелец открывает его чаще, чем
 * заходит по SSH.
 *
 * Доступ даёт MODERATOR_IDS, а не колонка в базе: признак в базе кто-то
 * однажды поставит себе сам через ошибку в другом маршруте, а
 * переменную окружения правят руками на сервере.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import {
  MODERATION_ACTION,
  REPORT_STATUS,
  moderationActionSchema,
  moderationListQuerySchema,
  type ModerationListResponse,
  type ModerationReport,
} from '@vk-rideshare/shared';

import { forbidden, notFound, validationFailed } from '../lib/errors.js';
import { describeTarget, isModerator, removeContent, setBlocked } from '../lib/moderation.js';
import { requireUserId, type Principal } from '../lib/principal.js';
import { toUserPublic } from '../lib/serializers.js';
import { parseWith } from '../lib/validate.js';
import type { RouteDeps } from './types.js';

const idParamSchema = z.object({ id: z.string().min(1) });

/** Сколько жалоб показывать за раз. Разбирают их по одной, листать нечего. */
const PAGE_SIZE = 50;

export const moderationRoutes = ({
  prisma,
  env,
  writeRateLimit,
}: RouteDeps): FastifyPluginAsync => {
  return async (fastify) => {
    /** Единственная проверка прав; оба маршрута зовут её первой строкой. */
    const requireModerator = (principal: Principal): void => {
      if (!isModerator(principal, env)) {
        throw forbidden('Разбор жалоб доступен администрации сервиса');
      }
    };

    fastify.get('/moderation/reports', async (request): Promise<ModerationListResponse> => {
      requireModerator(request.principal);
      // Личность проверяется и здесь: без неё жалобы мог бы читать кто
      // угодно с подписью запуска от имени модератора, но без сессии.
      await requireUserId(prisma, request.principal);

      const query = parseWith(moderationListQuerySchema, request.query ?? {});
      const status = query.status ?? REPORT_STATUS.NEW;

      const [reports, newCount] = await Promise.all([
        prisma.report.findMany({
          where: { status },
          orderBy: { createdAt: 'desc' },
          include: { reporter: true },
          take: PAGE_SIZE,
        }),
        prisma.report.count({ where: { status: REPORT_STATUS.NEW } }),
      ]);

      const infos = await Promise.all(
        reports.map((report) => describeTarget(prisma, report.target, report.targetId)),
      );

      /*
       * У разобранных жалоб контента уже нет, и автора в них приходится
       * искать по сохранённому ownerId. Одним запросом на весь список:
       * иначе разбор десятка жалоб стоил бы десятка обращений в базу
       * ради одной и той же таблицы.
       */
      const missing = reports
        .map((report, index) => (infos[index]!.owner === null ? report.ownerId : null))
        .filter((id): id is string => id !== null);
      const fallback =
        missing.length === 0
          ? []
          : await prisma.user.findMany({ where: { id: { in: missing } } });
      const byId = new Map(fallback.map((user) => [user.id, user]));

      const items: ModerationReport[] = reports.map((report, index) => {
        const about = infos[index]!;
        const owner =
          about.owner ?? (report.ownerId === null ? null : byId.get(report.ownerId) ?? null);
        return {
          id: report.id,
          target: report.target,
          targetId: report.targetId,
          reason: report.reason,
          comment: report.comment,
          status: report.status,
          createdAt: report.createdAt.toISOString(),
          reporter: toUserPublic(report.reporter),
          owner: owner === null ? null : toUserPublic(owner),
          ownerBlocked: owner !== null && owner.blockedAt !== null,
          content: about.body,
        };
      });

      return { items, newCount };
    });

    fastify.post(
      '/moderation/reports/:id',
      { config: { rateLimit: writeRateLimit } },
      async (request): Promise<ModerationReport> => {
        requireModerator(request.principal);
        await requireUserId(prisma, request.principal);

        const { id } = parseWith(idParamSchema, request.params);
        const { action } = parseWith(moderationActionSchema, request.body ?? {});

        const report = await prisma.report.findUnique({
          where: { id },
          include: { reporter: true },
        });
        if (report === null) {
          throw notFound('Жалоба не найдена');
        }

        const before = await describeTarget(prisma, report.target, report.targetId);

        if (action === MODERATION_ACTION.REMOVE || action === MODERATION_ACTION.BLOCK) {
          const removed = await removeContent(prisma, report.target, report.targetId);
          if (!removed && action === MODERATION_ACTION.REMOVE) {
            throw validationFailed(
              'У профиля нечего удалять: если нарушение в профиле, закройте доступ',
            );
          }
        }

        /*
         * Автор берётся из жалобы, а не из контента: к моменту «вернуть
         * доступ» контент уже удалён тем же разбором, и по нему автора
         * не найти. Ровно на этом ломался первый вариант.
         */
        const ownerId = before.owner?.id ?? report.ownerId;

        if (action === MODERATION_ACTION.BLOCK || action === MODERATION_ACTION.UNBLOCK) {
          if (ownerId === null || ownerId === undefined) {
            throw validationFailed('Автор этого контента неизвестен');
          }
          await setBlocked(prisma, ownerId, action === MODERATION_ACTION.BLOCK);
        }

        /*
         * «Вернуть доступ» — исправление собственной ошибки, а не разбор:
         * жалоба после него остаётся в том же состоянии, в каком была.
         */
        const status =
          action === MODERATION_ACTION.UNBLOCK
            ? report.status
            : action === MODERATION_ACTION.DISMISS
              ? REPORT_STATUS.DISMISSED
              : REPORT_STATUS.REVIEWED;

        const updated = await prisma.report.update({ where: { id }, data: { status } });

        request.log.warn(
          {
            event: 'ugc_report_resolved',
            reportId: id,
            action,
            target: report.target,
            targetId: report.targetId,
            ownerId: ownerId ?? null,
          },
          'Жалоба разобрана',
        );

        // Состояние пересобирается после действия: контента может уже не
        // быть, а у автора — измениться доступ.
        const after = await describeTarget(prisma, report.target, report.targetId);
        const owner =
          after.owner ??
          (ownerId === null || ownerId === undefined
            ? null
            : await prisma.user.findUnique({ where: { id: ownerId } }));
        return {
          id: updated.id,
          target: updated.target,
          targetId: updated.targetId,
          reason: updated.reason,
          comment: updated.comment,
          status: updated.status,
          createdAt: updated.createdAt.toISOString(),
          reporter: toUserPublic(report.reporter),
          owner: owner === null ? null : toUserPublic(owner),
          ownerBlocked: owner !== null && owner.blockedAt !== null,
          content: after.body,
        };
      },
    );
  };
};
