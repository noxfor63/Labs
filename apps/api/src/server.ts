import process from 'node:process';

import { buildApp } from './app.js';
import { prisma } from './db.js';
import { env } from './env.js';
import { startExpirySweeper } from './expiry-job.js';

const app = await buildApp();

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
} catch (error) {
  app.log.error({ err: error }, 'Не удалось запустить сервер');
  process.exit(1);
}

const stopSweeper = startExpirySweeper(prisma, app.log);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void (async () => {
      stopSweeper();
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    })();
  });
}
