/**
 * Кто сделал запрос — в терминах, не зависящих от площадки.
 *
 * Проверка подписи даёт идентификатор на площадке (ВКонтакте, Telegram),
 * а не пользователя приложения: одному человеку может принадлежать и то,
 * и другое. Сопоставление с внутренним пользователем — отдельный шаг,
 * вынесенный сюда.
 *
 * Хук авторизации намеренно в базу не ходит: лента поездок — самый частый
 * запрос, и ей личность не нужна вовсе. Маршруты, которым пользователь
 * нужен, спрашивают его сами.
 */
import type { PrismaClient } from '@prisma/client';

import { ERROR_CODE } from '@vk-rideshare/shared';

import { ApiError, unauthorized } from './errors.js';

export const PLATFORM = {
  VK: 'VK',
  TG: 'TG',
} as const;
export type Platform = (typeof PLATFORM)[keyof typeof PLATFORM];

export type Principal = {
  platform: Platform;
  /** Идентификатор на площадке: vk_user_id либо telegram id. */
  platformUserId: bigint;
  /**
   * Профиль, пришедший **подписанным** вместе с идентификатором.
   * Есть только у Telegram: он кладёт имя и фото прямо в initData. У
   * ВКонтакте их в launch-параметрах нет, и фронтенд присылает их телом.
   */
  profile?: {
    firstName: string;
    lastName: string;
    photoUrl: string | null;
  };
};

/** Колонка, в которой лежит идентификатор этой площадки. */
export function platformIdColumn(platform: Platform): 'vkUserId' | 'tgUserId' {
  return platform === PLATFORM.VK ? 'vkUserId' : 'tgUserId';
}

/** Условие поиска пользователя по площадке. Вынесено, чтобы не повторять его в каждом запросе. */
export function principalWhere(principal: Principal): { vkUserId: bigint } | { tgUserId: bigint } {
  return principal.platform === PLATFORM.VK
    ? { vkUserId: principal.platformUserId }
    : { tgUserId: principal.platformUserId };
}

/**
 * То же, но для маршрутов, где без пользователя делать нечего.
 *
 * Пользователь заводится на POST /api/session, который фронтенд зовёт
 * первым. Если его нет — значит запрос пришёл в обход этого порядка, и
 * это именно 401, а не 404: подпись верна, но сессии ещё не было.
 */
export async function requireUserId(
  prisma: PrismaClient,
  principal: Principal,
): Promise<string> {
  const user = await prisma.user.findUnique({
    where: principalWhere(principal),
    select: { id: true, blockedAt: true },
  });
  if (user === null) {
    throw unauthorized('Сессия не инициализирована: сначала POST /api/session');
  }
  /*
   * Закрытый доступ проверяется здесь, а не в каждом маршруте: через эту
   * функцию проходит всё, что вообще требует личности, — и запись, и
   * чтение своих списков. Забыть проверку в новом маршруте так нельзя.
   */
  if (user.blockedAt !== null) {
    throw blockedError();
  }
  return user.id;
}

/** Один текст на все маршруты: человек должен понимать, что произошло. */
export function blockedError(): ApiError {
  return new ApiError(
    403,
    ERROR_CODE.ACCESS_BLOCKED,
    'Доступ к сервису закрыт за нарушение правил',
  );
}
