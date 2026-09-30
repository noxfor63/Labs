/**
 * Номера телефонов.
 *
 * Хранится всегда одна форма — `+7XXXXXXXXXX`. Иначе один и тот же номер,
 * введённый как `8 (999) 123-45-67` и как `+7 999 1234567`, оказался бы
 * двумя разными строками, и любое сравнение или поиск по номеру врали бы.
 *
 * Поддерживается российская нумерация: приложение работает по трём
 * городам одной области, международные номера здесь неоткуда взяться, а
 * принимать их «на всякий случай» значит пропускать опечатки.
 */

/** Длина национального номера без кода страны. */
const NATIONAL_LENGTH = 10;

/**
 * Приводит введённое к `+7XXXXXXXXXX`.
 * Возвращает null, если это не похоже на российский мобильный.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');

  let national: string;
  if (digits.length === NATIONAL_LENGTH) {
    // 9991234567
    national = digits;
  } else if (digits.length === NATIONAL_LENGTH + 1 && (digits[0] === '7' || digits[0] === '8')) {
    // 79991234567 или 89991234567 — восьмёрка и семёрка здесь равнозначны
    national = digits.slice(1);
  } else {
    return null;
  }

  // Мобильные России начинаются с девятки. Городские номера тут не нужны:
  // на них не позвонишь из приложения в дороге, а опечатку они маскируют.
  if (!national.startsWith('9')) {
    return null;
  }

  return `+7${national}`;
}

/** `+79991234567` → `+7 999 123-45-67`. Для показа, не для хранения. */
export function formatPhone(normalized: string): string {
  const match = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(normalized);
  if (match === null) {
    return normalized;
  }
  const [, code, first, second, third] = match;
  return `+7 ${code} ${first}-${second}-${third}`;
}

/** Ссылка для набора номера. */
export function buildTelUrl(normalized: string): string {
  return `tel:${normalized}`;
}
