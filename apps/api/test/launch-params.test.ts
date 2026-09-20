import { describe, expect, it } from 'vitest';

import {
  LaunchParamsError,
  buildSignBase,
  resignMockLaunchParams,
  signLaunchParams,
  verifyLaunchParams,
} from '../src/lib/launch-params.js';
import { TEST_SECRET, launchParams } from './helpers.js';

describe('подпись launch-параметров', () => {
  it('в базу подписи попадают только vk_*, отсортированные по ключу', () => {
    const params = new URLSearchParams(
      'sign=zzz&vk_user_id=42&other=ignored&vk_app_id=7&vk_ts=100',
    );
    expect(buildSignBase(params)).toBe('vk_app_id=7&vk_ts=100&vk_user_id=42');
  });

  it('подпись кодируется в base64url без паддинга', () => {
    const sign = signLaunchParams(new URLSearchParams('vk_user_id=1'), TEST_SECRET);
    expect(sign).not.toContain('=');
    expect(sign).not.toContain('+');
    expect(sign).not.toContain('/');
    expect(sign).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('корректная строка проходит проверку', () => {
    const verified = verifyLaunchParams(launchParams(777), TEST_SECRET);
    expect(verified.vkUserId).toBe(777n);
    expect(verified.vkAppId).toBe(51_234_567);
    expect(verified.vkParams['vk_user_id']).toBe('777');
    // Параметры без префикса vk_ в результат не попадают.
    expect(Object.keys(verified.vkParams).every((key) => key.startsWith('vk_'))).toBe(true);
  });

  it('чужой ключ подписи не проходит', () => {
    const query = launchParams(777, { secret: 'другой-ключ' });
    expect(() => verifyLaunchParams(query, TEST_SECRET)).toThrow(LaunchParamsError);
  });

  it('подмена любого vk_-параметра ломает подпись', () => {
    const query = launchParams(777);
    const tampered = query.replace('vk_user_id=777', 'vk_user_id=778');
    expect(() => verifyLaunchParams(tampered, TEST_SECRET)).toThrow(/подпись/i);
  });

  it('пустой защищённый ключ — всегда отказ', () => {
    expect(() => verifyLaunchParams(launchParams(1), '')).toThrow(/ключ/i);
  });

  it('строка без sign отклоняется', () => {
    expect(() => verifyLaunchParams('vk_user_id=1&vk_ts=1', TEST_SECRET)).toThrow(/подпис/i);
  });

  it('vk_ts старше суток отклоняется', () => {
    const now = Date.now();
    const stale = Math.floor(now / 1000) - 24 * 60 * 60 - 60;
    expect(() => verifyLaunchParams(launchParams(1, { ts: stale }), TEST_SECRET, { now })).toThrow(
      /устарел/i,
    );
  });

  it('vk_ts возрастом 23 часа ещё принимается', () => {
    const now = Date.now();
    const fresh = Math.floor(now / 1000) - 23 * 60 * 60;
    expect(verifyLaunchParams(launchParams(1, { ts: fresh }), TEST_SECRET, { now }).vkUserId).toBe(
      1n,
    );
  });

  it('пересобранная моковая строка проходит штатную проверку', () => {
    const mock = 'vk_user_id=1000001&vk_app_id=51234567&vk_platform=desktop_web';
    const resigned = resignMockLaunchParams(mock, TEST_SECRET);
    expect(verifyLaunchParams(resigned, TEST_SECRET).vkUserId).toBe(1_000_001n);
  });
});
