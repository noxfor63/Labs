/**
 * Периодический запуск уборки просроченных поездок.
 *
 * Живёт отдельно от buildApp намеренно: приложение собирается и в тестах,
 * и фоновый таймер там только мешал бы. Сама логика уборки — в
 * lib/expiry.ts, и она проверяется тестом напрямую, без таймеров.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';

import { sweepExpiredTrips } from './lib/expiry.js';

/** Как часто проверять. Поездки закрываются с запасом в часы, минута туда-сюда роли не играет. */
export const SWEEP_INTERVAL_MINUTES = 15;

/**
 * Запускает уборку сразу и далее по таймеру.
 * Возвращает функцию остановки — её зовёт обработчик сигнала завершения.
 */
export function startExpirySweeper(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  intervalMinutes: number = SWEEP_INTERVAL_MINUTES,
): () => void {
  let running = false;

  const runOnce = async (): Promise<void> => {
    // Проход может затянуться на большой выборке; накладывать второй
    // поверх первого незачем — они боролись бы за одни и те же строки.
    if (running) {
      return;
    }
    running = true;
    try {
      const result = await sweepExpiredTrips(prisma);
      if (result.completed + result.cancelled + result.cancelledRequests > 0) {
        log.info({ ...result }, 'Закрыты просроченные поездки');
      }
    } catch (error) {
      // Упавшая уборка не должна ронять сервер: следующий проход через интервал.
      log.error({ err: error }, 'Уборка просроченных поездок не удалась');
    } finally {
      running = false;
    }
  };

  void runOnce();

  const timer = setInterval(() => {
    void runOnce();
  }, intervalMinutes * 60 * 1000);

  // Таймер не должен удерживать процесс при завершении.
  timer.unref();

  return () => {
    clearInterval(timer);
  };
}
