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

/*
 * Строка о разборе жалоб при старте.
 *
 * Непонятная запись в MODERATOR_IDS пропускается молча — иначе опечатка
 * в необязательной настройке роняла бы сервис целиком. Но тогда «экран
 * жалоб не появился» ничем не объяснено, и проверить это нужно уметь
 * сразу после перезапуска, не угадывая.
 */
app.log.info(
  { moderators: env.moderators.map((one) => `${one.platform}:${one.platformUserId}`) },
  env.moderators.length === 0
    ? 'Разбор жалоб выключен: MODERATOR_IDS пуст'
    : `Разбор жалоб доступен, записей в MODERATOR_IDS: ${env.moderators.length}`,
);

if (env.moderatorsRejected.length > 0) {
  app.log.warn(
    { rejected: env.moderatorsRejected },
    'В MODERATOR_IDS есть записи, которые не удалось разобрать — они не действуют',
  );
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
