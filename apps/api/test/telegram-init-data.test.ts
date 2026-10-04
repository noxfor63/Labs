/**
 * Проверка подписи initData Telegram.
 *
 * Готового тест-вектора Telegram не публикует, поэтому строка здесь
 * собирается и подписывается тем же кодом, что её проверяет. Такая
 * проверка доказывает внутреннюю согласованность, но не соответствие
 * настоящему Telegram — последнее подтверждается только живым запуском
 * из клиента, и это отдельный шаг приёмки.
 *
 * Чтобы «согласованность» не выродилась в проверку самой себя, ниже
 * стоят мутационные случаи: каждый ломает ровно одну деталь алгоритма и
 * ждёт отказа. Если убрать из кода исключение `signature` или перепутать
 * местами ключ и сообщение в HMAC, эти тесты покраснеют.
 */
import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  buildDataCheckString,
  deriveSecretKey,
  signInitData,
  TelegramInitDataError,
  verifyInitData,
} from '../src/lib/telegram-init-data.js';

const BOT_TOKEN = '7000000000:AAFakeTokenForTestsOnly_не_настоящий';

const USER = {
  id: 777_000_111,
  first_name: 'Рустам',
  last_name: 'Тележный',
  username: 'rustam',
  photo_url: 'https://t.me/i/userpic/320/abc.jpg',
  language_code: 'ru',
};

/** Собирает initData так, как его прислал бы клиент Telegram. */
function makeInitData(
  overrides: Record<string, string> = {},
  options: { authDate?: number; omitHash?: boolean } = {},
): string {
  const params = new URLSearchParams({
    auth_date: String(options.authDate ?? Math.floor(Date.now() / 1000)),
    chat_instance: '-1234567890',
    chat_type: 'sender',
    query_id: 'AAEtest',
    user: JSON.stringify(USER),
    ...overrides,
  });
  if (options.omitHash !== true) {
    params.set('hash', signInitData(params, BOT_TOKEN));
  }
  return params.toString();
}

describe('verifyInitData', () => {
  it('принимает корректно подписанный initData и разбирает пользователя', () => {
    const verified = verifyInitData(makeInitData(), BOT_TOKEN);

    expect(verified.user.id).toBe(777_000_111n);
    expect(verified.user.firstName).toBe('Рустам');
    expect(verified.user.lastName).toBe('Тележный');
    expect(verified.user.username).toBe('rustam');
    expect(verified.user.photoUrl).toBe('https://t.me/i/userpic/320/abc.jpg');
  });

  it('поле signature в подпись не входит', () => {
    // Telegram добавляет signature для сторонней проверки по Ed25519.
    // Подпись считается без него, поэтому дописанное поле ничего не ломает.
    const signed = makeInitData();
    const withSignature = `${signed}&signature=abcdef0123456789`;

    expect(() => verifyInitData(withSignature, BOT_TOKEN)).not.toThrow();
  });

  it('подделанное имя подпись не проходит', () => {
    const params = new URLSearchParams(makeInitData());
    params.set('user', JSON.stringify({ ...USER, first_name: 'Чужой' }));

    expect(() => verifyInitData(params.toString(), BOT_TOKEN)).toThrow(TelegramInitDataError);
  });

  it('чужой токен бота подпись не проходит', () => {
    expect(() => verifyInitData(makeInitData(), '7000000000:ДругойТокен')).toThrow(
      /подпись/i,
    );
  });

  it('устаревший initData отклоняется', () => {
    const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60;

    expect(() => verifyInitData(makeInitData({}, { authDate: twoDaysAgo }), BOT_TOKEN)).toThrow(
      /устарел/i,
    );
  });

  it('свежий initData на границе суток принимается', () => {
    const almostDay = Math.floor(Date.now() / 1000) - (24 * 60 * 60 - 60);

    expect(() => verifyInitData(makeInitData({}, { authDate: almostDay }), BOT_TOKEN)).not.toThrow();
  });

  it('без подписи — отказ', () => {
    expect(() => verifyInitData(makeInitData({}, { omitHash: true }), BOT_TOKEN)).toThrow(
      /нет подписи/i,
    );
  });

  it('без токена бота — отказ, а не пропуск', () => {
    expect(() => verifyInitData(makeInitData(), '')).toThrow(/Токен бота/i);
  });

  it('пустой initData — отказ', () => {
    expect(() => verifyInitData('', BOT_TOKEN)).toThrow(/отсутствует/i);
  });

  it('user не-JSON — отказ', () => {
    const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: 'не json',
    });
    params.set('hash', signInitData(params, BOT_TOKEN));

    expect(() => verifyInitData(params.toString(), BOT_TOKEN)).toThrow(/JSON/i);
  });

  it('фамилии может не быть — это нормально для Telegram', () => {
    const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 42, first_name: 'Ким' }),
    });
    params.set('hash', signInitData(params, BOT_TOKEN));

    const verified = verifyInitData(params.toString(), BOT_TOKEN);
    expect(verified.user.lastName).toBe('');
    expect(verified.user.username).toBeNull();
  });
});

describe('детали алгоритма', () => {
  it('строка для подписи — декодированные значения через перевод строки, по алфавиту', () => {
    const params = new URLSearchParams({
      b: 'второй',
      a: 'первый',
      user: '{"id":1}',
      hash: 'игнорируется',
      signature: 'тоже игнорируется',
    });

    expect(buildDataCheckString(params)).toBe('a=первый\nb=второй\nuser={"id":1}');
  });

  it('ключ HMAC — это HMAC("WebAppData", токен), а не сам токен', () => {
    const correct = deriveSecretKey(BOT_TOKEN);
    const swapped = createHmac('sha256', BOT_TOKEN).update('WebAppData').digest();

    // Если перепутать ключ и сообщение местами, результат другой —
    // и подпись не сойдётся ни у одного пользователя.
    expect(correct.equals(swapped)).toBe(false);
  });
});
