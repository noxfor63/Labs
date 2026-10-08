/**
 * Хеш из рекламной ссылки не должен гасить приложение.
 *
 * Это не умозрительный случай: ссылки с метками источника — обычный
 * способ понять, откуда пришли люди, и такая метка попадает ровно туда,
 * где у нас живут маршруты. В браузере это выглядит как белый экран, то
 * есть хуже, чем просто непосчитанный переход.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { stripLaunchHash } from '../src/platform/launch-hash.js';

const setHash = (hash: string): void => {
  window.history.replaceState(null, '', `/${hash}`);
};

describe('очистка хеша при запуске', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('метка источника отбрасывается', () => {
    setHash('#ref=vk_chat');

    stripLaunchHash();

    expect(window.location.hash).toBe('#/');
  });

  it('параметр запуска Telegram без initData тоже', () => {
    setHash('#tgWebAppStartParam=tg_channel');

    stripLaunchHash();

    expect(window.location.hash).toBe('#/');
  });

  it('настоящий маршрут остаётся нетронутым', () => {
    setHash('#/my/trip/abc123');

    stripLaunchHash();

    expect(window.location.hash).toBe('#/my/trip/abc123');
  });

  it('пустой хеш не трогаем: иначе в адресе появился бы лишний #/', () => {
    stripLaunchHash();

    expect(window.location.hash).toBe('');
  });

  it('query-параметры запуска ВКонтакте сохраняются', () => {
    window.history.replaceState(null, '', '/?vk_user_id=1&sign=abc#promo');

    stripLaunchHash();

    expect(window.location.search).toBe('?vk_user_id=1&sign=abc');
    expect(window.location.hash).toBe('#/');
  });
});
