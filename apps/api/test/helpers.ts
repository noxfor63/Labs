import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import {
  ORENBURG,
  SOL_ILETSK,
  TRIP_ROLE,
  TRIP_STATUS,
  nextDepartSlot,
  type TripRole,
  type TripStatus,
} from '@vk-rideshare/shared';

import { buildApp } from '../src/app.js';
import { createPrismaClient } from '../src/db.js';
import { parseEnv, type AppEnv } from '../src/env.js';
import { signLaunchParams } from '../src/lib/launch-params.js';
import { signInitData } from '../src/lib/telegram-init-data.js';
import type { RateLimitConfig } from '../src/routes/types.js';
import { TEST_DATABASE_URL } from './global-setup.js';

export const TEST_SECRET = 'test-secret-not-a-real-vk-key';
export const TEST_APP_ID = '51234567';
export const TEST_BOT_TOKEN = '7000000000:AAFakeTokenForTestsOnly';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function makeEnv(overrides: Record<string, string> = {}): AppEnv {
  return parseEnv({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    API_PORT: '3000',
    API_HOST: '127.0.0.1',
    CORS_ORIGIN: 'http://localhost:5173',
    VK_APP_ID: TEST_APP_ID,
    VK_APP_SECRET: TEST_SECRET,
    VK_MOCK_LAUNCH_PARAMS: '',
    TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
    ...overrides,
  });
}

export type TestContext = {
  app: FastifyInstance;
  prisma: PrismaClient;
  env: AppEnv;
  close: () => Promise<void>;
};

export async function createTestApp(
  options: { env?: AppEnv; rateLimit?: RateLimitConfig } = {},
): Promise<TestContext> {
  const env = options.env ?? makeEnv();
  const prisma = createPrismaClient(TEST_DATABASE_URL);
  const app = await buildApp({
    env,
    prisma,
    logger: false,
    ...(options.rateLimit === undefined ? {} : { rateLimit: options.rateLimit }),
  });
  await app.ready();

  return {
    app,
    prisma,
    env,
    close: async () => {
      await app.close();
      await prisma.$disconnect();
    },
  };
}

/* ───────────────────── заголовок Telegram ───────────────────── */

export type TelegramUserFixture = {
  id: number | bigint;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
};

/** initData, подписанный тестовым токеном бота, — как его прислал бы клиент. */
export function telegramInitData(
  user: TelegramUserFixture,
  options: { authDate?: number; botToken?: string } = {},
): string {
  const params = new URLSearchParams({
    auth_date: String(options.authDate ?? Math.floor(Date.now() / 1000)),
    query_id: 'AAEtest',
    user: JSON.stringify({ first_name: 'Тест', last_name: 'Телеграмов', ...user }),
  });
  params.set('hash', signInitData(params, options.botToken ?? TEST_BOT_TOKEN));
  return params.toString();
}

export function telegramHeaders(
  user: TelegramUserFixture,
  options: { authDate?: number; botToken?: string } = {},
): Record<string, string> {
  return { 'x-telegram-init-data': telegramInitData(user, options) };
}

/* ───────────────────── launch-параметры ───────────────────── */

export type LaunchParamsOptions = {
  /** Unix-секунды; по умолчанию — сейчас. */
  ts?: number;
  secret?: string;
  appId?: string;
};

/** Собирает корректно подписанную строку запуска. */
export function launchParams(
  vkUserId: bigint | number | string,
  options: LaunchParamsOptions = {},
): string {
  const params = new URLSearchParams({
    vk_app_id: options.appId ?? TEST_APP_ID,
    vk_is_app_user: '1',
    vk_language: 'ru',
    vk_platform: 'desktop_web',
    vk_ts: String(options.ts ?? Math.floor(Date.now() / 1000)),
    vk_user_id: String(vkUserId),
  });
  params.set('sign', signLaunchParams(params, options.secret ?? TEST_SECRET));
  return params.toString();
}

export const authHeaders = (
  vkUserId: bigint | number | string,
  options?: LaunchParamsOptions,
): Record<string, string> => ({
  'x-launch-params': launchParams(vkUserId, options),
});

/* ───────────────────── фикстуры ───────────────────── */

let nextOffset = 0;

/** Диапазон id, не пересекающийся ни с сидом, ни с другими тестовыми файлами. */
export function allocateVkIds(count: number, base: number): bigint[] {
  const start = base + nextOffset;
  nextOffset += count;
  return Array.from({ length: count }, (_, index) => BigInt(start + index));
}

/**
 * Заводит пользователя по идентификатору ВКонтакте и возвращает его
 * **внутренний** id — именно он теперь стоит во внешних ключах. Сам
 * vkUserId остаётся нужен для заголовка запуска, поэтому вызывающий
 * держит оба: один для авторизации, другой для связей.
 */
export async function createUser(
  prisma: PrismaClient,
  vkUserId: bigint,
  overrides: { firstName?: string; lastName?: string } = {},
): Promise<string> {
  const user = await prisma.user.upsert({
    where: { vkUserId },
    create: {
      vkUserId,
      firstName: overrides.firstName ?? `Тест${vkUserId}`,
      lastName: overrides.lastName ?? 'Тестов',
    },
    update: {},
    select: { id: true },
  });
  return user.id;
}

/**
 * Пачка пользователей и обратное соответствие «идентификатор ВКонтакте →
 * внутренний id».
 *
 * Нужно потому, что в тестах эти два идентификатора нужны одновременно и
 * для разного: по первому собирается заголовок запуска, по второму стоят
 * внешние ключи. Без такого соответствия каждый тест заводил бы себе по
 * переменной на каждого участника.
 */
export type UserIds = {
  /** Внутренний id по идентификатору ВКонтакте. */
  id: (vkUserId: bigint) => string;
  /** Все внутренние id — для подчистки за тестом. */
  all: string[];
};

export async function createUsers(
  prisma: PrismaClient,
  vkUserIds: readonly bigint[],
): Promise<UserIds> {
  const map = new Map<bigint, string>();
  for (const vkUserId of vkUserIds) {
    map.set(vkUserId, await createUser(prisma, vkUserId));
  }
  return {
    id: (vkUserId) => {
      const internal = map.get(vkUserId);
      if (internal === undefined) {
        throw new Error(`Пользователь ${vkUserId} в этом тесте не заводился`);
      }
      return internal;
    },
    all: [...map.values()],
  };
}

export type TripFixture = {
  authorId: string;
  seatsTotal?: number;
  seatsLeft?: number;
  status?: TripStatus;
  role?: TripRole;
  fromCity?: string;
  toCity?: string;
  departAt?: Date;
  priceRub?: number;
};

export async function createTrip(
  prisma: PrismaClient,
  fixture: TripFixture,
): Promise<string> {
  const seatsTotal = fixture.seatsTotal ?? 3;
  const trip = await prisma.trip.create({
    data: {
      authorId: fixture.authorId,
      role: fixture.role ?? TRIP_ROLE.DRIVER,
      fromCity: fixture.fromCity ?? ORENBURG,
      toCity: fixture.toCity ?? SOL_ILETSK,
      // Время всегда по сетке получасов — как того требует контракт.
      departAt: fixture.departAt ?? nextDepartSlot(new Date(Date.now() + 3 * DAY)),
      seatsTotal,
      seatsLeft: fixture.seatsLeft ?? seatsTotal,
      priceRub: fixture.priceRub ?? 600,
      status: fixture.status ?? TRIP_STATUS.ACTIVE,
    },
  });
  return trip.id;
}

export { DAY, HOUR };
