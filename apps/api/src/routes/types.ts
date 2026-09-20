import type { PrismaClient } from '@prisma/client';

import type { AppEnv } from '../env.js';

export type RateLimitConfig = {
  max: number;
  timeWindow: string;
};

export type RouteDeps = {
  prisma: PrismaClient;
  env: AppEnv;
  /** Лимит на пишущие маршруты; в тестах поднимается, чтобы не мешать. */
  writeRateLimit: RateLimitConfig;
};
