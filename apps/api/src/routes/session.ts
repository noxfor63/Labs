import type { User } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import {
  ERROR_CODE,
  phoneInputSchema,
  type SessionResponse,
  type SessionState,
} from '@vk-rideshare/shared';

import { ApiError } from '../lib/errors.js';
import { isModerator } from '../lib/moderation.js';
import { blockedError, principalWhere } from '../lib/principal.js';
import { parseWith } from '../lib/validate.js';
import { toUserPublic } from '../lib/serializers.js';
import type { RouteDeps } from './types.js';

/**
 * Профиль, который фронтенд получил у своей площадки.
 * Бэкенд ему доверяет ровно настолько, насколько доверяет подписи запуска:
 * идентификатор берётся из подписанных параметров, а не из тела.
 *
 * Все поля необязательны: вне фрейма площадки профиль не отдаётся, и
 * затирать уже сохранённое имя заглушкой в таком случае нельзя.
 */
const sessionBodySchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  photoUrl: z.string().trim().max(500).nullish(),
  city: z.string().trim().max(100).nullish(),
  /**
   * Номер для связи. Приводится к +7XXXXXXXXXX здесь же: доверять
   * нормализации на клиенте нельзя — запрос можно отправить и мимо него.
   */
  phone: phoneInputSchema.optional(),
  /**
   * Согласие с политикой конфиденциальности.
   *
   * Только `true`: «я согласился» — событие, а «я не согласился» событием
   * не является и присылать его незачем. Отозвать согласие этим полем
   * нельзя, для этого есть удаление данных по обращению.
   */
  privacyAccepted: z.literal(true).optional(),
});

/** Дата согласия в ответе — ISO-строкой, как и все остальные даты контракта. */
function privacyAcceptedIso(user: Pick<User, 'privacyAcceptedAt'>): string | null {
  return user.privacyAcceptedAt === null ? null : user.privacyAcceptedAt.toISOString();
}

export const sessionRoutes = ({ prisma, env, writeRateLimit }: RouteDeps): FastifyPluginAsync => {
  return async (fastify) => {
    /**
     * Состояние сессии, ничего не создавая.
     *
     * Нужно, чтобы узнать, принимал ли человек политику, до того как о нём
     * будет записана хоть одна строка. Отсюда и раздельность: читающий
     * GET можно звать всегда, пишущий POST — только после согласия.
     */
    fastify.get('/session', async (request): Promise<SessionState> => {
      const user = await prisma.user.findUnique({
        where: principalWhere(request.principal),
      });
      if (user === null) {
        return { user: null, privacyAcceptedAt: null, isModerator: false };
      }
      /*
       * Закрытый доступ сообщается уже здесь, на первом запросе.
       *
       * Иначе заблокированный, у которого ещё нет согласия с политикой,
       * сначала прошёл бы экран согласия и только потом упёрся бы в отказ
       * на записи — то есть отдал бы свои данные ради сообщения о том,
       * что сервис ему закрыт.
       */
      if (user.blockedAt !== null) {
        throw blockedError();
      }
      return {
        user: toUserPublic(user),
        privacyAcceptedAt: privacyAcceptedIso(user),
        isModerator: isModerator(request.principal, env),
      };
    });

    fastify.post(
      '/session',
      { config: { rateLimit: writeRateLimit } },
      async (request): Promise<SessionResponse> => {
        const body = parseWith(sessionBodySchema, request.body ?? {});
        const principal = request.principal;

        const existing = await prisma.user.findUnique({ where: principalWhere(principal) });

        // Закрытый доступ — раньше всего: иначе заблокированный продолжал бы
        // обновлять свой профиль, и единственное, чего он лишился бы, — это
        // поездок.
        if (existing !== null && existing.blockedAt !== null) {
          throw blockedError();
        }

        /*
         * Главная проверка этого маршрута, и она стоит до любой записи.
         *
         * Правила площадок требуют согласия с политикой до обработки
         * персональных данных, а не после. Поэтому без согласия здесь не
         * заводится даже строка пользователя: нет согласия — нет данных.
         * Проверка на сервере, а не только на экране, потому что запрос
         * можно отправить и мимо интерфейса.
         */
        const acceptedAt =
          existing?.privacyAcceptedAt ?? (body.privacyAccepted === true ? new Date() : null);
        if (acceptedAt === null) {
          throw new ApiError(
            403,
            ERROR_CODE.PRIVACY_NOT_ACCEPTED,
            'Нужно принять политику конфиденциальности',
          );
        }

        /*
         * Подписанный профиль площадки важнее присланного телом: Telegram
         * кладёт имя и фото прямо в initData, и подделать их нельзя, а
         * тело запроса — можно. У ВКонтакте подписанного профиля нет,
         * поэтому там всё остаётся как было.
         */
        const signed = principal.profile;

        // В update попадают только присланные поля — то, чего клиент не знает,
        // остаётся как было.
        const update: {
          firstName?: string;
          lastName?: string;
          photoUrl?: string | null;
          city?: string | null;
          phone?: string | null;
          privacyAcceptedAt?: Date;
        } = {};
        if (signed !== undefined) {
          update.firstName = signed.firstName;
          update.lastName = signed.lastName;
          update.photoUrl = signed.photoUrl;
        } else {
          if (body.firstName !== undefined) {
            update.firstName = body.firstName;
          }
          if (body.lastName !== undefined) {
            update.lastName = body.lastName;
          }
          if (body.photoUrl !== undefined) {
            update.photoUrl = body.photoUrl ?? null;
          }
        }
        if (body.city !== undefined) {
          update.city = body.city ?? null;
        }
        if (body.phone !== undefined) {
          update.phone = body.phone;
        }
        // Дата согласия проставляется один раз и больше не трогается:
        // повторное «принимаю» не должно переписывать момент, который уже
        // зафиксирован, иначе доказать его задним числом станет нечем.
        if (existing?.privacyAcceptedAt === undefined || existing.privacyAcceptedAt === null) {
          update.privacyAcceptedAt = acceptedAt;
        }

        /**
         * Единственное место, где пользователь заводится. Ключ поиска и
         * колонка при создании — одна и та же, своя для каждой площадки,
         * поэтому и то и другое собирается из principal.
         */
        const user = await prisma.user.upsert({
          where: principalWhere(principal),
          create: {
            ...principalWhere(principal),
            firstName: signed?.firstName ?? body.firstName ?? 'Пользователь',
            lastName: signed?.lastName ?? body.lastName ?? '',
            photoUrl: signed?.photoUrl ?? body.photoUrl ?? null,
            city: body.city ?? null,
            phone: body.phone ?? null,
            privacyAcceptedAt: acceptedAt,
          },
          update,
        });

        return {
          user: toUserPublic(user),
          privacyAcceptedAt: privacyAcceptedIso(user),
          isModerator: isModerator(principal, env),
        };
      },
    );
  };
};
