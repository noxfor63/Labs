/**
 * Нагрузочный тест ленты поездок.
 *
 * Бьёт по GET /api/trips — это самый частый и самый тяжёлый запрос в
 * приложении. Ничего не пишет: ни поездок, ни пользователей, ни откликов.
 * Запускать можно по живому продакшену.
 *
 * Каждый виртуальный пользователь получает свой vk_user_id и свою подпись,
 * собранную тем же способом, что и настоящая: HMAC-SHA256 по отсортированным
 * vk_*-параметрам, base64url без паддинга (см. apps/api/src/lib/launch-params.ts).
 *
 * Запуск:
 *   API_URL=https://ваш-домен VK_APP_ID=123 VK_APP_SECRET=xxx \
 *     node scripts/loadtest.mjs --users 50 --seconds 30
 *
 * Лучше запускать не с самого сервера: тест сам ест память и процессор и
 * исказит результат на маленькой машине.
 *
 * Важно про интерпретацию: виртуальный пользователь не думает между
 * запросами — отправляет следующий сразу, как получил ответ. Поэтому
 * --users 50 здесь на порядок злее, чем 50 живых людей, которые жмут
 * что-то раз в 20-30 секунд. Это стресс-тест, а не симуляция.
 */
import { createHmac } from 'node:crypto';
import process from 'node:process';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : Number(process.argv[index + 1]);
}

const API_URL = (process.env.API_URL ?? '').replace(/\/+$/, '');
const VK_APP_ID = process.env.VK_APP_ID ?? '';
const VK_APP_SECRET = process.env.VK_APP_SECRET ?? '';
const USERS = arg('users', 50);
const SECONDS = arg('seconds', 30);

if (API_URL === '' || VK_APP_ID === '' || VK_APP_SECRET === '') {
  console.error('Нужны переменные API_URL, VK_APP_ID и VK_APP_SECRET.');
  process.exit(1);
}

/** Подписывает launch-параметры так же, как это делает ВКонтакте. */
function buildLaunchParams(vkUserId) {
  const params = new URLSearchParams({
    vk_app_id: VK_APP_ID,
    vk_are_notifications_enabled: '0',
    vk_is_app_user: '1',
    vk_language: 'ru',
    vk_platform: 'mobile_android',
    vk_ts: String(Math.floor(Date.now() / 1000)),
    vk_user_id: String(vkUserId),
  });
  const base = new URLSearchParams(
    [...params.entries()].filter(([k]) => k.startsWith('vk_')).sort(([a], [b]) => (a < b ? -1 : 1)),
  ).toString();
  params.set('sign', createHmac('sha256', VK_APP_SECRET).update(base).digest('base64url'));
  return params.toString();
}

const latencies = [];
const statuses = new Map();
let inFlight = 0;
let peakInFlight = 0;

async function hit(launchParams) {
  const started = performance.now();
  inFlight += 1;
  peakInFlight = Math.max(peakInFlight, inFlight);
  try {
    const response = await fetch(`${API_URL}/api/trips?limit=20`, {
      headers: { 'X-Launch-Params': launchParams },
    });
    await response.arrayBuffer();
    statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
  } catch (error) {
    const key = error instanceof Error ? error.message : 'network';
    statuses.set(key, (statuses.get(key) ?? 0) + 1);
  } finally {
    inFlight -= 1;
    latencies.push(performance.now() - started);
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

const deadline = Date.now() + SECONDS * 1000;

/** Один виртуальный пользователь: запрос, пауза, запрос — пока не кончится время. */
async function virtualUser(index) {
  // Диапазон заведомо несуществующих id: тест не должен совпасть с живым человеком.
  const launchParams = buildLaunchParams(900_000_000 + index);
  // Стартовый разброс, чтобы все не ударили в одну миллисекунду.
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 1000));
  while (Date.now() < deadline) {
    await hit(launchParams);
  }
}

console.log(`Цель: ${API_URL}`);
console.log(`Пользователей: ${USERS}, длительность: ${SECONDS} с\n`);

const startedAt = performance.now();
await Promise.all(Array.from({ length: USERS }, (_, i) => virtualUser(i)));
const elapsed = (performance.now() - startedAt) / 1000;

const sorted = [...latencies].sort((a, b) => a - b);
const ok = statuses.get(200) ?? 0;

console.log(`Запросов:        ${latencies.length}`);
console.log(`В секунду:       ${(latencies.length / elapsed).toFixed(1)}`);
console.log(`Пик параллельно: ${peakInFlight}`);
console.log('');
console.log(`Задержка p50:    ${percentile(sorted, 50).toFixed(0)} мс`);
console.log(`Задержка p90:    ${percentile(sorted, 90).toFixed(0)} мс`);
console.log(`Задержка p95:    ${percentile(sorted, 95).toFixed(0)} мс`);
console.log(`Задержка p99:    ${percentile(sorted, 99).toFixed(0)} мс`);
console.log(`Максимум:        ${(sorted.at(-1) ?? 0).toFixed(0)} мс`);
console.log('');
console.log('Ответы:');
for (const [status, count] of [...statuses.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${status}: ${count}`);
}

if (ok !== latencies.length) {
  console.log('\nЕсть ответы не 200 — смотрите список выше, цифры задержек по ним ничего не значат.');
  process.exitCode = 1;
}
