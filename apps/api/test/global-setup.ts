/**
 * Разовая подготовка тестовой БД: отдельная база, сброшенная схема
 * и настоящий сид — фильтры проверяются на тех же данных, что видит
 * разработчик локально.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://postgres:postgres@127.0.0.1:5432/vk_rideshare_test?schema=public';

export default function setup(): void {
  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL };
  const run = (args: string[]): void => {
    execFileSync('npx', args, { cwd: apiRoot, env, stdio: 'inherit' });
  };

  // Без --force-reset: схему синхронизирует обычный push, а данные
  // всё равно полностью перезаписывает сид (он начинается с deleteMany).
  run(['prisma', 'db', 'push']);
  run(['tsx', 'prisma/seed.ts']);
}
