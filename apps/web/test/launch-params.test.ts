import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getLaunchParams } from '../src/api/launch-params.js';

const QUERY =
  'vk_user_id=1000001&vk_app_id=51234567&vk_platform=desktop_web&sign=abcdef';

function setLocation(search: string, hash = ''): void {
  window.history.replaceState({}, '', `/${search}${hash}`);
}

describe('чтение launch-параметров', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    setLocation('');
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('берёт исходную строку из query как есть', () => {
    setLocation(`?${QUERY}`);
    expect(getLaunchParams()).toBe(QUERY);
  });

  it('находит параметры после решётки — хеш-роутер их туда уносит', () => {
    setLocation('', `#/trip/abc?${QUERY}`);
    expect(getLaunchParams()).toBe(QUERY);
  });

  it('запоминает строку и отдаёт её после ухода параметров из адреса', () => {
    setLocation(`?${QUERY}`);
    expect(getLaunchParams()).toBe(QUERY);

    setLocation('', '#/my');
    expect(getLaunchParams()).toBe(QUERY);
  });

  it('без параметров и без кэша возвращает пустую строку', () => {
    expect(getLaunchParams()).toBe('');
  });

  it('строку не пересобирает: порядок ключей сохраняется', () => {
    // Пересборка через URLSearchParams изменила бы порядок и сломала подпись.
    const unusual = 'vk_user_id=1&vk_ts=2&vk_app_id=3&sign=xyz';
    setLocation(`?${unusual}`);
    expect(getLaunchParams()).toBe(unusual);
  });
});
