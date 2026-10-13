/**
 * Выгрузка объявлений по направлениям, которых больше нет в справочнике.
 *
 * Нужна ровно один раз — перед миграцией 20261013100000_hub_routes,
 * которая закрывает такие объявления. Закрытие само по себе честное: по
 * исчезнувшему направлению никто не поедет. Нечестно другое — закрыть
 * молча. Автор объявления ни в чём не виноват, он ждёт звонков, и
 * сказать ему, что планы поменялись, можно только по телефону из этой
 * выгрузки.
 *
 *   npm run export:removed-routes -w @vk-rideshare/api > removed-routes.csv
 *   npm run export:removed-routes -w @vk-rideshare/api -- --cancelled
 *
 * По умолчанию выгружаются активные объявления вне справочника — те, что
 * миграция и закроет. С флагом --cancelled выгружается то, что она уже
 * закрыла (по отметке cancelReason): на случай, если выгрузку забыли
 * сделать заранее.
 *
 * Правило берётся из справочника, а не повторяется здесь списком пар:
 * иначе выгрузка и валидация разойдутся. В самой миграции список пар
 * всё-таки записан прямо в SQL — и это не дублирование, а свойство
 * миграций: применённая миграция не меняется вместе с кодом.
 *
 * CSV, а не JSON: это таблица для человека, её открывают в Excel и
 * обзванивают сверху вниз. Разделитель — точка с запятой: русский Excel
 * понимает запятую как десятичный знак и кладёт всю строку в одну
 * ячейку.
 *
 * В файле есть телефоны. Это персональные данные: обзвонили — удалите.
 */
import process from 'node:process';

import { TRIP_STATUS, isKnownRoute } from '@vk-rideshare/shared';

import { prisma } from '../src/db.js';

/** Отметка, которой миграция помечает закрытые ею объявления. */
const ROUTE_REMOVED = 'ROUTE_REMOVED';

const COLUMNS = [
  'id',
  'статус',
  'откуда',
  'место сбора',
  'куда',
  'место высадки',
  'выезд',
  'роль',
  'мест всего',
  'мест свободно',
  'цена',
  'автор',
  'телефон',
  'vkUserId',
  'tgUsername',
  'создано',
] as const;

/**
 * Поле для CSV: кавычки удваиваются, значение всегда в кавычках.
 *
 * Всегда — чтобы не решать каждый раз, попадётся ли внутри разделитель
 * или перевод строки: в комментарии к поездке попадётся и то и другое.
 */
function cell(value: string | number | bigint | null): string {
  if (value === null) {
    return '""';
  }
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function main(): Promise<void> {
  const cancelledOnly = process.argv.includes('--cancelled');

  const trips = await prisma.trip.findMany({
    where: cancelledOnly
      ? { status: TRIP_STATUS.CANCELLED, cancelReason: ROUTE_REMOVED }
      : { status: TRIP_STATUS.ACTIVE },
    include: { author: true },
    orderBy: { departAt: 'asc' },
  });

  // Активных объявлений в базе сколько угодно; нас интересуют только те,
  // чья пара городов больше не существует.
  const removed = cancelledOnly
    ? trips
    : trips.filter((trip) => !isKnownRoute(trip.fromCity, trip.toCity));

  process.stdout.write(`${COLUMNS.map((name) => cell(name)).join(';')}\n`);
  for (const trip of removed) {
    const row = [
      trip.id,
      trip.status,
      trip.fromCity,
      trip.fromPoint,
      trip.toCity,
      trip.toPoint,
      trip.departAt.toISOString(),
      trip.role,
      trip.seatsTotal,
      trip.seatsLeft,
      trip.priceRub,
      `${trip.author.firstName} ${trip.author.lastName}`.trim(),
      trip.author.phone,
      trip.author.vkUserId,
      trip.author.tgUsername,
      trip.createdAt.toISOString(),
    ];
    process.stdout.write(`${row.map((value) => cell(value)).join(';')}\n`);
  }

  // Итог — в stderr: stdout уходит в файл и должен остаться чистым CSV.
  process.stderr.write(
    removed.length === 0
      ? '\n  Объявлений по исчезнувшим направлениям нет — миграции нечего закрывать.\n\n'
      : `\n  Строк: ${removed.length}. В файле есть телефоны — обзвонили, удалите.\n\n`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
