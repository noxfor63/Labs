/**
 * Генератор моковых launch-параметров для локальной разработки.
 *
 * Подписывает строку тем же защищённым ключом, что лежит в .env бэкенда,
 * поэтому приложение открывается вне ВКонтакте без единой поблажки в
 * проверке подписи.
 *
 *   npm run gen:launch-params -w @vk-rideshare/api -- --user 1000001
 *
 * Результат можно:
 *   • положить в VK_MOCK_LAUNCH_PARAMS в .env — тогда фронтенд работает
 *     просто по http://localhost:5173/;
 *   • или дописать к адресу в браузере, чтобы открыть приложение от имени
 *     другого пользователя.
 */
import process from 'node:process';

import { env } from '../src/env.js';
import { signLaunchParams } from '../src/lib/launch-params.js';

function readArg(name: string, fallback: string): string {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index !== -1) {
    const value = process.argv[index + 1];
    if (value !== undefined && !value.startsWith('--')) {
      return value;
    }
  }
  const inline = process.argv.find((item) => item.startsWith(`${flag}=`));
  return inline === undefined ? fallback : inline.slice(flag.length + 1);
}

const vkUserId = readArg('user', '1000001');
if (!/^\d{1,19}$/.test(vkUserId)) {
  console.error('--user должен быть целым числом');
  process.exit(1);
}

if (env.VK_APP_SECRET === '') {
  console.error('VK_APP_SECRET не задан в .env — подписывать нечем');
  process.exit(1);
}

const params = new URLSearchParams({
  vk_access_token_settings: '',
  vk_app_id: String(env.VK_APP_ID ?? 0),
  vk_are_notifications_enabled: '0',
  vk_is_app_user: '1',
  vk_is_favorite: '0',
  vk_language: 'ru',
  vk_platform: 'desktop_web',
  vk_ref: 'other',
  vk_ts: String(Math.floor(Date.now() / 1000)),
  vk_user_id: vkUserId,
});
params.set('sign', signLaunchParams(params, env.VK_APP_SECRET));

console.log('');
console.log(`Launch-параметры для vk_user_id=${vkUserId}:`);
console.log('');
console.log(params.toString());
console.log('');
console.log('Строка подписана локальным VK_APP_SECRET и живёт 24 часа.');
console.log('');
