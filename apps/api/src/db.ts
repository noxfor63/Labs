import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { env } from './env.js';

/**
 * В Prisma 7 строка подключения передаётся драйвер-адаптером,
 * а не через datasource в схеме.
 */
export function createPrismaClient(connectionString: string = env.DATABASE_URL): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

export const prisma: PrismaClient = createPrismaClient();
