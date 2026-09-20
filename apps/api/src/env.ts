/**
 * Конфигурация бэкенда.
 *
 * Защищённый ключ приложения (VK_APP_SECRET) читается ТОЛЬКО здесь и только
 * из окружения. Он не попадает ни в ответы API, ни в логи (см. redact в
 * apps/api/src/app.ts), ни тем более на фронтенд.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

/** Ищем .env вверх по дереву: работает и из src (tsx), и из dist (node), и из тестов. */
function loadDotEnv(): void {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return;
    }
    dir = parent;
  }
}

loadDotEnv();

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL обязателен'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    VK_APP_ID: z.coerce.number().int().positive().optional(),
    VK_APP_SECRET: z.string().default(''),
    VK_MOCK_LAUNCH_PARAMS: z.string().default(''),
  })
  .transform((raw) => {
    const isProduction = raw.NODE_ENV === 'production';
    return {
      ...raw,
      isProduction,
      corsOrigins: raw.CORS_ORIGIN.split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ''),
      /**
       * Моковые launch-параметры доступны только вне продакшена.
       * Это и есть выключатель, который проверяет тест: в production
       * значение всегда пустое, чем бы ни было забито окружение.
       */
      mockLaunchParams: isProduction ? '' : raw.VK_MOCK_LAUNCH_PARAMS,
    };
  })
  .refine((value) => !value.isProduction || value.VK_APP_SECRET.length > 0, {
    message: 'VK_APP_SECRET обязателен при NODE_ENV=production',
    path: ['VK_APP_SECRET'],
  });

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(корень)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Некорректная конфигурация окружения — ${details}`);
  }
  return parsed.data;
}

export const env: AppEnv = parseEnv();
