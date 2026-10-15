/**
 * Выбор режима звонка и копирование номера.
 *
 * Режим — чистая функция от двух признаков, поэтому проверяется таблицей.
 * Копирование — цепочка из трёх способов, и каждый следующий должен
 * срабатывать, когда предыдущий закрыт: во фрейме vk.com закрытым может
 * оказаться любой.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getLaunchParams } from '../src/api/launch-params.js';
import { chooseCallMode, copyText, detectCallEnvironment } from '../src/platform/phone-call.js';

vi.mock('../src/api/launch-params.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getLaunchParams: vi.fn(() => ''),
}));

describe('режим кнопки звонка', () => {
  it.each([
    { mobile: true, framed: false, expected: 'dial' },
    { mobile: true, framed: true, expected: 'dial-new-window' },
    { mobile: false, framed: true, expected: 'copy' },
    { mobile: false, framed: false, expected: 'copy' },
  ] as const)('телефон=$mobile, фрейм=$framed → $expected', ({ mobile, framed, expected }) => {
    expect(chooseCallMode({ mobile, framed })).toBe(expected);
  });

  it('во фрейме никогда не выбирает звонок в том же окне', () => {
    // Именно этот случай уронил приложение на модерации.
    for (const mobile of [true, false]) {
      expect(chooseCallMode({ mobile, framed: true })).not.toBe('dial');
    }
  });
});

describe('телефон или компьютер', () => {
  afterEach(() => {
    vi.mocked(getLaunchParams).mockReturnValue('');
  });

  it.each([
    ['vk_platform=desktop_web&vk_user_id=1', false],
    ['vk_platform=mobile_web&vk_user_id=1', true],
    ['vk_platform=mobile_android&vk_user_id=1', true],
    ['vk_platform=mobile_iphone_messenger&vk_user_id=1', true],
  ])('ВКонтакте сам говорит, где запущено: %s → телефон=%s', (params, mobile) => {
    vi.mocked(getLaunchParams).mockReturnValue(params);
    expect(detectCallEnvironment().mobile).toBe(mobile);
  });

  it('без подсказки ВКонтакте решает по браузеру', () => {
    // jsdom представляется настольным браузером.
    expect(detectCallEnvironment().mobile).toBe(false);
  });

  it('в тестах приложение не во фрейме', () => {
    expect(detectCallEnvironment().framed).toBe(false);
  });
});

describe('копирование номера', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  afterEach(() => {
    if (originalClipboard === undefined) {
      delete (navigator as { clipboard?: unknown }).clipboard;
    } else {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    }
    vi.restoreAllMocks();
  });

  const stubClipboard = (writeText: (text: string) => Promise<void>): void => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  };

  it('берёт Clipboard API, если он доступен', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    await expect(copyText('+79990000003')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('+79990000003');
  });

  it('Clipboard API закрыт политикой фрейма — копирует через выделение', async () => {
    stubClipboard(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec;

    await expect(copyText('+79990000003')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    // Временное поле убрано за собой.
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('все способы закрыты — честно возвращает false', async () => {
    stubClipboard(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
    document.execCommand = vi.fn().mockReturnValue(false);

    // Мост ВКонтакте вне клиента ВКонтакте не вызывается вовсе.
    await expect(copyText('+79990000003')).resolves.toBe(false);
  });
});
