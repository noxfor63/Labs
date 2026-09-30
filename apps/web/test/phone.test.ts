/**
 * Нормализация телефонов.
 *
 * Тесты лежат в веб-пакете, потому что vitest настроен здесь, а сама
 * функция общая: ей пользуются и форма, и валидация на бэкенде.
 */
import { buildTelUrl, formatPhone, normalizePhone } from '@vk-rideshare/shared';
import { describe, expect, it } from 'vitest';

describe('normalizePhone', () => {
  it('приводит все привычные записи одного номера к одной строке', () => {
    const forms = [
      '+79991234567',
      '+7 999 123-45-67',
      '+7 (999) 123 45 67',
      '89991234567',
      '8 999 123 45 67',
      '8-999-123-45-67',
      '79991234567',
      '9991234567',
      '  +7 999 123 45 67  ',
    ];
    for (const raw of forms) {
      expect(normalizePhone(raw), raw).toBe('+79991234567');
    }
  });

  it('отвергает то, что не похоже на российский мобильный', () => {
    const bad = [
      '',
      '   ',
      '123',
      '+7 999 123 45 6',      // на цифру короче
      '+7 999 123 45 678',    // на цифру длиннее
      '+7 495 123 45 67',     // городской: не начинается с девятки
      '84951234567',
      '+1 202 555 0143',      // другой код страны
      'позвоните мне',
    ];
    for (const raw of bad) {
      expect(normalizePhone(raw), raw).toBeNull();
    }
  });

  it('повторная нормализация ничего не меняет', () => {
    const once = normalizePhone('8 (999) 123-45-67');
    expect(once).not.toBeNull();
    expect(normalizePhone(once as string)).toBe(once);
  });
});

describe('formatPhone', () => {
  it('разбивает хранимую форму на читаемые группы', () => {
    expect(formatPhone('+79991234567')).toBe('+7 999 123-45-67');
  });

  it('не ломает строку, которая пришла не в хранимой форме', () => {
    expect(formatPhone('что-то другое')).toBe('что-то другое');
  });
});

describe('buildTelUrl', () => {
  it('собирает ссылку для набора', () => {
    expect(buildTelUrl('+79991234567')).toBe('tel:+79991234567');
  });
});
