/**
 * Кнопки связи и режимы звонка.
 *
 * Тест появился после отказа модерации: «крашится при нажатии на кнопку
 * „Позвонить“». Во фрейме браузерной версии ВКонтакте переход на tel:
 * запрещён политикой страницы vk.com, и браузер подменял приложение
 * страницей ошибки. Главное, что здесь проверяется: ссылка tel: без
 * нового окна остаётся только там, где приложение — верхний документ
 * телефона.
 */
import type { UserPublic } from '@vk-rideshare/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContactButtons } from '../src/components/ContactButtons.js';
import { SnackbarProvider } from '../src/lib/SnackbarContext.js';
import { copyText, getCallMode } from '../src/platform/phone-call.js';

vi.mock('../src/platform/phone-call.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCallMode: vi.fn(),
  copyText: vi.fn(),
}));

const user = (overrides: Partial<UserPublic> = {}): UserPublic => ({
  id: 'u-1',
  vkUserId: '1000003',
  tgUserId: null,
  tgUsername: null,
  firstName: 'Игорь',
  lastName: 'Верещагин',
  photoUrl: null,
  city: 'Александровка',
  phone: '+79990000003',
  ratingAvg: 4.8,
  ratingCount: 4,
  ...overrides,
});

const renderButtons = (overrides: Partial<UserPublic> = {}): void => {
  render(
    <SnackbarProvider>
      <ContactButtons user={user(overrides)} />
    </SnackbarProvider>,
  );
};

/** Все ссылки tel: на экране — их и проверяем на «звонок в этом же окне». */
const telLinks = (): HTMLAnchorElement[] =>
  Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="tel:"]'));

afterEach(() => {
  vi.mocked(getCallMode).mockReset();
  vi.mocked(copyText).mockReset();
});

describe('кнопка звонка', () => {
  it('на телефоне, когда приложение — верхний документ, звонит обычной ссылкой', () => {
    vi.mocked(getCallMode).mockReturnValue('dial');
    renderButtons();

    const call = screen.getByText('Позвонить').closest('a');
    expect(call?.getAttribute('href')).toBe('tel:+79990000003');
    expect(call?.getAttribute('target')).toBeNull();
  });

  it('во фрейме на телефоне открывает звонок в новом окне, а не в самом фрейме', () => {
    vi.mocked(getCallMode).mockReturnValue('dial-new-window');
    renderButtons();

    const call = screen.getByText('Позвонить').closest('a');
    expect(call?.getAttribute('href')).toBe('tel:+79990000003');
    expect(call?.getAttribute('target')).toBe('_blank');
  });

  it('на компьютере не уводит фрейм на tel:, а копирует номер', async () => {
    vi.mocked(getCallMode).mockReturnValue('copy');
    vi.mocked(copyText).mockResolvedValue(true);
    renderButtons();

    // Ровно то, что уронило приложение на модерации: ссылки tel: нет вовсе.
    expect(telLinks()).toHaveLength(0);
    expect(screen.queryByText('Позвонить')).toBeNull();

    fireEvent.click(screen.getByText('Скопировать номер'));

    expect(copyText).toHaveBeenCalledWith('+79990000003');
    expect(await screen.findByText('Номер +7 999 000-00-03 скопирован')).toBeTruthy();
  });

  it('не скопировалось — говорит, где взять номер', async () => {
    vi.mocked(getCallMode).mockReturnValue('copy');
    vi.mocked(copyText).mockResolvedValue(false);
    renderButtons();

    fireEvent.click(screen.getByText('Скопировать номер'));

    expect(await screen.findByText(/номер написан под кнопкой/)).toBeTruthy();
    // И он действительно там написан.
    expect(screen.getByText('+7 999 000-00-03')).toBeTruthy();
  });

  it('без номера кнопки звонка нет ни в каком режиме', () => {
    vi.mocked(getCallMode).mockReturnValue('copy');
    renderButtons({ phone: null });

    expect(screen.queryByText('Скопировать номер')).toBeNull();
    expect(screen.queryByText('Позвонить')).toBeNull();
    // Профиль ВКонтакте при этом остаётся.
    expect(screen.getByText('Профиль')).toBeTruthy();
  });
});

describe('ссылки наружу', () => {
  it('профиль ВКонтакте открывается в новом окне в любом режиме', () => {
    for (const mode of ['dial', 'dial-new-window', 'copy'] as const) {
      vi.mocked(getCallMode).mockReturnValue(mode);
      const { unmount } = render(
        <SnackbarProvider>
          <ContactButtons user={user()} />
        </SnackbarProvider>,
      );
      const profile = screen.getByText('Профиль').closest('a');
      expect(profile?.getAttribute('target')).toBe('_blank');
      unmount();
    }
  });
});
