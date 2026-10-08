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

/**
 * Origin хостинга VK Mini Apps для конкретного приложения.
 *
 * Зачем шаблон вместо точного адреса: VK Hosting выдаёт новый поддомен на
 * каждую боевую выкатку — `prod-app<ID>-a1b2c3d4e5f6…`, потом
 * `prod-app<ID>-0a1b2c3d4e5f…`. С фиксированным списком после каждой
 * выкатки пришлось бы править .env на сервере и перезапускать службу, и
 * однажды это забылось бы, а приложение молча перестало бы работать.
 *
 * Шаблон привязан к вашему VK_APP_ID, поэтому чужие мини-приложения под
 * него не подходят: у них другой id в имени хоста.
 *
 * Якоря ^ и $ здесь не украшение. Без них подошёл бы и
 * `https://prod-app<ID>-abc.pages-ac.vk-apps.ru.злойдомен.рф`, и
 * `http://…` без шифрования.
 *
 * Если ВКонтакте начнёт отдавать хостинг на другом домене, шаблон его не
 * покроет — тогда адрес добавляется в CORS_ORIGIN руками, как раньше.
 */
export function buildVkHostingOrigin(appId: number | undefined): RegExp | null {
  if (appId === undefined) {
    return null;
  }
  return new RegExp(
    `^https://(?:prod|stage|dev)-app${appId}-[0-9a-f]{6,32}\\.pages(?:-ac)?\\.vk-apps\\.ru$`,
  );
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z
      .string({ error: 'DATABASE_URL обязателен — строка подключения к Postgres' })
      .min(1, 'DATABASE_URL обязателен — строка подключения к Postgres'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    // Оба адреса dev-сервера Vite: localhost и 127.0.0.1 — это разные
    // origin для браузера, и открыв приложение по «не тому» из них,
    // разработчик упирался бы в CORS на ровном месте.
    CORS_ORIGIN: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
    VK_APP_ID: z.coerce.number().int().positive().optional(),
    VK_APP_SECRET: z.string().default(''),
    VK_MOCK_LAUNCH_PARAMS: z.string().default(''),
    /**
     * Токен бота Telegram. Он же ключ проверки подписи initData, поэтому
     * без него площадка просто выключена: запросы с заголовком Telegram
     * получают 401, приложение ВКонтакте работает как работало.
     */
    TELEGRAM_BOT_TOKEN: z.string().default(''),
    /**
     * Временная диагностика авторизации Telegram: любое непустое значение
     * добавляет к ответу 401 безопасную выжимку о том, где разошлось.
     * Секретов в ней нет, но и в обычной работе она не нужна — выключайте
     * после разбора.
     */
    AUTH_DEBUG: z.string().default(''),
    /**
     * Кому в приложении виден разбор жалоб.
     *
     * Перечисляются идентификаторы площадок через запятую: `VK:123`,
     * `TG:456` либо просто `123` — это ВКонтакте. Именно идентификаторы
     * площадок, а не внутренние id: внутренний появляется только после
     * первого запуска, а права нужны ещё до него, и в `.env` его
     * неоткуда взять.
     *
     * Пусто — экран жалоб не виден никому, и это верное значение по
     * умолчанию: права, выданные по забывчивости, никто не отзывает.
     */
    MODERATOR_IDS: z.string().default(''),
  })
  .transform((raw) => {
    const isProduction = raw.NODE_ENV === 'production';
    return {
      ...raw,
      isProduction,
      corsOrigins: raw.CORS_ORIGIN.split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ''),
      /** Шаблон адресов хостинга VK для этого приложения; null — VK_APP_ID не задан. */
      vkHostingOrigin: buildVkHostingOrigin(raw.VK_APP_ID),
      /**
       * Моковые launch-параметры доступны только вне продакшена.
       * Это и есть выключатель, который проверяет тест: в production
       * значение всегда пустое, чем бы ни было забито окружение.
       */
      mockLaunchParams: isProduction ? '' : raw.VK_MOCK_LAUNCH_PARAMS,
      /** Включена ли площадка Telegram. */
      telegramEnabled: raw.TELEGRAM_BOT_TOKEN !== '',
      /** Кому доступен разбор жалоб. Пустой список — никому. */
      moderators: parseModerators(raw.MODERATOR_IDS),
    };
  })
  .refine((value) => !value.isProduction || value.VK_APP_SECRET.length > 0, {
    message: 'VK_APP_SECRET обязателен при NODE_ENV=production',
    path: ['VK_APP_SECRET'],
  });

export type ModeratorRef = {
  platform: 'VK' | 'TG';
  platformUserId: bigint;
};

/**
 * `VK:123,TG:456,789` → список идентификаторов площадок.
 *
 * Непонятная запись молча пропускается, а не роняет сервер: ошибка в
 * этой переменной не должна мешать приложению работать — она всего лишь
 * не даст кому-то доступ к разбору жалоб. Обратное поведение означало
 * бы, что опечатка в необязательной настройке кладёт сервис целиком.
 */
function parseModerators(raw: string): ModeratorRef[] {
  const result: ModeratorRef[] = [];
  for (const piece of raw.split(',')) {
    const entry = piece.trim();
    if (entry === '') {
      continue;
    }
    const match = /^(?:(VK|TG):)?(\d{1,19})$/i.exec(entry);
    if (match === null) {
      continue;
    }
    result.push({
      platform: (match[1] ?? 'VK').toUpperCase() === 'TG' ? 'TG' : 'VK',
      platformUserId: BigInt(match[2]!),
    });
  }
  return result;
}

export type AppEnv = z.infer<typeof envSchema>;

/**
 * Пустая строка в .env — это «не задано», а не «задано пустым».
 *
 * Иначе скопированный .env.example, где заполнили только DATABASE_URL и
 * VK_APP_SECRET, валится с четырьмя ошибками подряд вместо того, чтобы
 * взять значения по умолчанию.
 */
function dropEmpty(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== '') {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(dropEmpty(source));
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(корень)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Некорректная конфигурация окружения — ${details}`);
  }
  return parsed.data;
}

export const env: AppEnv = parseEnv();
