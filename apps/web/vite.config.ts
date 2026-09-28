import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Читаем корневой .env сами, штатным парсером Node.
 *
 * Отдавать этот файл Vite (через envDir или loadEnv) нельзя: он содержит
 * переменные бэкенда, и Vite вытаскивает оттуда NODE_ENV — причём даже
 * когда loadEnv позвали с фильтром по префиксу VITE_. В результате
 * `NODE_ENV=development` в общем файле давал development-сборку React:
 * 757 кБ вместо 539 кБ, с предупреждениями разработчика — и она уехала бы
 * на хостинг незамеченной.
 *
 * Режим фронтенда задаёт команда сборки, а не переменная бэкенда.
 */
function readRootEnv(): Record<string, string | undefined> {
  const envPath = path.join(repoRoot, '.env');
  if (!existsSync(envPath)) {
    return {};
  }
  return parseEnv(readFileSync(envPath, 'utf8'));
}

export default defineConfig(() => {
  // process.env выигрывает у файла — так адрес API переопределяется в CI.
  const rootEnv = readRootEnv();
  const apiBaseUrl = process.env['VITE_API_BASE_URL'] ?? rootEnv['VITE_API_BASE_URL'] ?? '';

  return {
    plugins: [react()],
    // Хостинг VK Mini Apps раздаёт статику от корня выданного домена.
    base: './',
    define: {
      __API_BASE_URL__: JSON.stringify(apiBaseUrl),
    },
    server: {
      port: 5173,
      host: true,
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
