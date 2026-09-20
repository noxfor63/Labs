/**
 * Проверка подписи launch-параметров ВКонтакте.
 *
 * ВКонтакте отдаёт мини-приложению query-строку с параметрами `vk_*` и
 * параметром `sign`. Подпись считается так: берутся только ключи с префиксом
 * `vk_`, сортируются по имени, собираются обратно в query-строку, от неё
 * берётся HMAC-SHA256 на защищённом ключе приложения, результат кодируется
 * в base64url без паддинга.
 *
 * Защищённый ключ приходит сюда аргументом и нигде не сохраняется.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { LAUNCH_PARAMS_MAX_AGE_SECONDS } from '@vk-rideshare/shared';

export type VerifiedLaunchParams = {
  vkUserId: bigint;
  vkAppId: number | null;
  /** Только параметры `vk_*`, как их прислал ВКонтакте. */
  vkParams: Record<string, string>;
};

export class LaunchParamsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LaunchParamsError';
  }
}

/** Отбирает `vk_*`, сортирует по ключу и собирает каноническую строку. */
export function buildSignBase(params: URLSearchParams): string {
  const ordered = [...params.entries()]
    .filter(([key]) => key.startsWith('vk_'))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return new URLSearchParams(ordered).toString();
}

/** HMAC-SHA256 → base64url без паддинга. */
export function signLaunchParams(params: URLSearchParams, secret: string): string {
  return createHmac('sha256', secret).update(buildSignBase(params)).digest('base64url');
}

function equalsConstantTime(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  // timingSafeEqual требует одинаковой длины; сравниваем её отдельно,
  // длина подписи — не секрет.
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export type VerifyOptions = {
  /** Текущее время в миллисекундах; параметр ради детерминированных тестов. */
  now?: number;
  maxAgeSeconds?: number;
};

/**
 * Проверяет подпись и свежесть. Любое несовпадение — LaunchParamsError,
 * который вызывающий превращает в 401.
 */
export function verifyLaunchParams(
  rawQuery: string,
  secret: string,
  options: VerifyOptions = {},
): VerifiedLaunchParams {
  if (secret === '') {
    throw new LaunchParamsError('Защищённый ключ приложения не настроен');
  }

  const query = rawQuery.trim().replace(/^\?/, '');
  if (query === '') {
    throw new LaunchParamsError('Launch-параметры отсутствуют');
  }

  const params = new URLSearchParams(query);

  const sign = params.get('sign');
  if (sign === null || sign === '') {
    throw new LaunchParamsError('В launch-параметрах нет подписи');
  }

  const expected = signLaunchParams(params, secret);
  if (!equalsConstantTime(sign, expected)) {
    throw new LaunchParamsError('Подпись launch-параметров не совпала');
  }

  const rawTs = params.get('vk_ts');
  if (rawTs === null) {
    throw new LaunchParamsError('В launch-параметрах нет vk_ts');
  }
  const ts = Number(rawTs);
  if (!Number.isFinite(ts)) {
    throw new LaunchParamsError('Некорректный vk_ts');
  }

  const now = options.now ?? Date.now();
  const maxAge = options.maxAgeSeconds ?? LAUNCH_PARAMS_MAX_AGE_SECONDS;
  const ageSeconds = now / 1000 - ts;
  if (ageSeconds > maxAge) {
    throw new LaunchParamsError('Launch-параметры устарели');
  }

  const rawUserId = params.get('vk_user_id');
  if (rawUserId === null || !/^\d{1,19}$/.test(rawUserId)) {
    throw new LaunchParamsError('Некорректный vk_user_id');
  }

  const vkParams: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (key.startsWith('vk_')) {
      vkParams[key] = value;
    }
  }

  const rawAppId = params.get('vk_app_id');

  return {
    vkUserId: BigInt(rawUserId),
    vkAppId: rawAppId !== null && /^\d+$/.test(rawAppId) ? Number(rawAppId) : null,
    vkParams,
  };
}

/**
 * Пересобирает моковую строку для локальной разработки: проставляет свежий
 * `vk_ts` и подписывает её локальным ключом.
 *
 * Вызывать это МОЖНО только вне продакшена — гарантируют два независимых
 * предохранителя: env обнуляет VK_MOCK_LAUNCH_PARAMS при NODE_ENV=production,
 * и хук авторизации не заходит в эту ветку, если env.isProduction.
 */
export function resignMockLaunchParams(
  rawQuery: string,
  secret: string,
  now: number = Date.now(),
): string {
  const params = new URLSearchParams(rawQuery.trim().replace(/^\?/, ''));
  params.delete('sign');
  params.set('vk_ts', String(Math.floor(now / 1000)));
  params.set('sign', signLaunchParams(params, secret));
  return params.toString();
}
