/**
 * Проверка подписи initData Telegram Mini Apps.
 *
 * Алгоритм отличается от ВКонтакте, и отличия существенные:
 *
 *  1. Ключ HMAC — не токен бота, а HMAC-SHA256("WebAppData", токен_бота).
 *     Токен здесь выступает сообщением, а не ключом; перепутать легко,
 *     и подпись тогда не сойдётся ни разу.
 *  2. Строка для подписи собирается из **декодированных** значений,
 *     склеенных как `ключ=значение` через перевод строки. Повторно
 *     кодировать ничего нельзя — в отличие от ВКонтакте, где
 *     каноническая строка собирается обратно в query.
 *  3. Из подписи исключаются и `hash`, и `signature`. Второе поле
 *     Telegram добавил позже для сторонней проверки по Ed25519; если его
 *     не исключить, подпись перестанет сходиться у всех пользователей
 *     сразу, причём без всякого предупреждения.
 *  4. Результат — hex, а не base64url.
 *
 * Значение поля `user` берётся из строки как есть и разбирается только
 * после проверки. Пересобирать его JSON.stringify нельзя: порядок полей
 * и экранирование слэшей в URL фотографии отличаются от присланных, и
 * подпись ломается на пользователях с аватаркой.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** initData старше суток считаем протухшим — как и launch-параметры ВКонтакте. */
export const TELEGRAM_INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;

export class TelegramInitDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelegramInitDataError';
  }
}

export type TelegramUser = {
  id: bigint;
  firstName: string;
  lastName: string;
  username: string | null;
  photoUrl: string | null;
  languageCode: string | null;
};

export type VerifiedInitData = {
  user: TelegramUser;
  authDate: number;
};

/** Ключ подписи: токен бота здесь — сообщение, а не ключ. */
export function deriveSecretKey(botToken: string): Buffer {
  return createHmac('sha256', 'WebAppData').update(botToken).digest();
}

/**
 * Строка, которую подписывает Telegram: пары `ключ=значение` с
 * декодированными значениями, отсортированные по ключу, через `\n`.
 */
export function buildDataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([key]) => key !== 'hash' && key !== 'signature')
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export function signInitData(params: URLSearchParams, botToken: string): string {
  return createHmac('sha256', deriveSecretKey(botToken))
    .update(buildDataCheckString(params))
    .digest('hex');
}

function equalsConstantTime(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/** Разбор поля `user`: это JSON, и он может не прийти вовсе. */
function parseUser(raw: string | null): TelegramUser {
  if (raw === null || raw === '') {
    throw new TelegramInitDataError('В initData нет поля user');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TelegramInitDataError('Поле user не разобралось как JSON');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new TelegramInitDataError('Поле user не является объектом');
  }

  const source = parsed as Record<string, unknown>;
  const id = source['id'];
  if (typeof id !== 'number' && typeof id !== 'string') {
    throw new TelegramInitDataError('В user нет идентификатора');
  }
  const idText = String(id);
  if (!/^\d{1,19}$/.test(idText)) {
    throw new TelegramInitDataError('Некорректный идентификатор Telegram');
  }

  const text = (key: string): string | null => {
    const value = source[key];
    return typeof value === 'string' && value !== '' ? value : null;
  };

  return {
    id: BigInt(idText),
    // Фамилии в Telegram может не быть вовсе — в отличие от ВКонтакте.
    firstName: text('first_name') ?? 'Пользователь',
    lastName: text('last_name') ?? '',
    username: text('username'),
    photoUrl: text('photo_url'),
    languageCode: text('language_code'),
  };
}

/**
 * Безопасная выжимка о том, почему подпись не сошлась.
 *
 * Временная диагностика: сообщение «подпись не совпала» одинаково для
 * десятка разных причин, и отличить их по нему нельзя. Здесь нет ни
 * самого initData, ни токена — только имена полей, длины и начала хэшей,
 * по которым видно, разошлась подпись или сломался разбор.
 */
export function describeInitData(rawInitData: string, botToken: string): string {
  const raw = rawInitData.trim().replace(/^\?/, '');
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()].sort();
  const given = params.get('hash') ?? '';
  const computed = botToken === '' ? '' : signInitData(params, botToken);
  const authDate = Number(params.get('auth_date') ?? 'NaN');
  const ageSeconds = Number.isFinite(authDate)
    ? Math.round(Date.now() / 1000 - authDate)
    : null;

  return [
    `длина=${raw.length}`,
    `поля=[${keys.join(',')}]`,
    `hash: дано=${given.slice(0, 10)} длина=${given.length}`,
    `hash: ждём=${computed.slice(0, 10)} длина=${computed.length}`,
    `возраст=${ageSeconds === null ? '?' : `${ageSeconds}с`}`,
    `токен: длина=${botToken.length} бот=${botToken.split(':')[0] ?? '?'}`,
  ].join(' | ');
}

export type VerifyInitDataOptions = {
  /** Текущее время в миллисекундах; параметр ради детерминированных тестов. */
  now?: number;
  maxAgeSeconds?: number;
};

export function verifyInitData(
  rawInitData: string,
  botToken: string,
  options: VerifyInitDataOptions = {},
): VerifiedInitData {
  if (botToken === '') {
    throw new TelegramInitDataError('Токен бота не настроен');
  }

  const raw = rawInitData.trim().replace(/^\?/, '');
  if (raw === '') {
    throw new TelegramInitDataError('initData отсутствует');
  }

  const params = new URLSearchParams(raw);

  const hash = params.get('hash');
  if (hash === null || hash === '') {
    throw new TelegramInitDataError('В initData нет подписи');
  }

  if (!equalsConstantTime(hash, signInitData(params, botToken))) {
    throw new TelegramInitDataError('Подпись initData не совпала');
  }

  const rawAuthDate = params.get('auth_date');
  if (rawAuthDate === null) {
    throw new TelegramInitDataError('В initData нет auth_date');
  }
  const authDate = Number(rawAuthDate);
  if (!Number.isFinite(authDate)) {
    throw new TelegramInitDataError('Некорректный auth_date');
  }

  const now = options.now ?? Date.now();
  const maxAge = options.maxAgeSeconds ?? TELEGRAM_INIT_DATA_MAX_AGE_SECONDS;
  if (now / 1000 - authDate > maxAge) {
    throw new TelegramInitDataError('initData устарел');
  }

  return { user: parseUser(params.get('user')), authDate };
}
