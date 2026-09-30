/**
 * Сид-данные для локальной разработки.
 *
 * Детерминирован: один и тот же PRNG-сид даёт одну и ту же базу, поэтому
 * тесты фильтров и скриншоты воспроизводимы. Перед наполнением таблицы
 * очищаются, так что сид можно гонять сколько угодно раз.
 */
import { type Prisma, type PrismaClient } from '@prisma/client';

import {
  AKBULAK,
  CITIES,
  LIMITS,
  ORENBURG,
  ROUTES,
  SOL_ILETSK,
  isAllowedDepartTime,
} from '@vk-rideshare/shared';

import { createPrismaClient } from '../src/db.js';

/* ─────────────────── детерминированный генератор ─────────────────── */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(20260920);
const pick = <T>(items: readonly T[]): T => {
  const item = items[Math.floor(rnd() * items.length)];
  if (item === undefined) {
    throw new Error('pick() получил пустой массив');
  }
  return item;
};
const int = (min: number, max: number): number => min + Math.floor(rnd() * (max - min + 1));
const chance = (probability: number): boolean => rnd() < probability;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/* ─────────────────── исходные данные ─────────────────── */

const PEOPLE = [
  { vkUserId: 1_000_001n, firstName: 'Анна', lastName: 'Ковалёва', city: ORENBURG },
  { vkUserId: 1_000_002n, firstName: 'Дмитрий', lastName: 'Соколов', city: SOL_ILETSK },
  { vkUserId: 1_000_003n, firstName: 'Мария', lastName: 'Егорова', city: AKBULAK },
  { vkUserId: 1_000_004n, firstName: 'Игорь', lastName: 'Верещагин', city: ORENBURG },
  { vkUserId: 1_000_005n, firstName: 'Ольга', lastName: 'Панкратова', city: SOL_ILETSK },
  { vkUserId: 1_000_006n, firstName: 'Тимур', lastName: 'Гаязов', city: AKBULAK },
  { vkUserId: 1_000_007n, firstName: 'Светлана', lastName: 'Юрченко', city: ORENBURG },
  { vkUserId: 1_000_008n, firstName: 'Никита', lastName: 'Бортников', city: SOL_ILETSK },
  { vkUserId: 1_000_009n, firstName: 'Алина', lastName: 'Мещерякова', city: AKBULAK },
  { vkUserId: 1_000_010n, firstName: 'Павел', lastName: 'Стрельцов', city: ORENBURG },
] as const;

/**
 * Цена зависит от направления: Оренбург — Соль-Илецк около 70 км,
 * Акбулак — Соль-Илецк около 90, Оренбург — Акбулак около 130.
 * Коридор целиком укладывается в LIMITS.PRICE_MIN..PRICE_MAX.
 */
const PRICE_BY_ROUTE: ReadonlyArray<{ cities: readonly [string, string]; min: number; max: number }> = [
  { cities: [ORENBURG, SOL_ILETSK], min: 500, max: 600 },
  { cities: [AKBULAK, SOL_ILETSK], min: 550, max: 700 },
  { cities: [ORENBURG, AKBULAK], min: 700, max: 850 },
];

/** Цена кратна 50 рублям — так её и называют в объявлениях. */
function priceFor(from: string, to: string): number {
  const band = PRICE_BY_ROUTE.find(
    ({ cities }) =>
      (cities[0] === from && cities[1] === to) || (cities[0] === to && cities[1] === from),
  );
  if (band === undefined) {
    throw new Error(`Нет коридора цен для ${from} → ${to}`);
  }
  const steps = (band.max - band.min) / 50;
  return band.min + int(0, steps) * 50;
}

const PICKUP_POINTS = [
  'автовокзал',
  'ж/д вокзал',
  'у центрального рынка',
  'заправка на выезде из города',
  'остановка у школы',
  'площадь Победы',
];

const CARS = [
  'Lada Vesta',
  'Kia Rio',
  'Hyundai Solaris',
  'Skoda Octavia',
  'Toyota Camry',
  'Renault Logan',
  'Volkswagen Polo',
];

const DRIVER_COMMENTS = [
  'Еду спокойно, без спешки. Курить в салоне нельзя.',
  'Багажник свободен, влезет два чемодана.',
  'Выезд строго по времени, опоздавших ждать не смогу.',
  'Можно с небольшим питомцем в переноске.',
  'Кондиционер работает, музыка по вкусу пассажиров.',
  'Довезу до любой точки в городе, по пути высажу.',
];

const PASSENGER_COMMENTS = [
  'Еду налегке, только рюкзак.',
  'Оплачу бензин пополам.',
  'Гибок по времени в пределах пары часов.',
  'Нужен трансфер до вокзала, встречу у подъезда.',
];

const REQUEST_MESSAGES = [
  'Здравствуйте! Есть место? Еду один.',
  'Добрый день, готова подстроиться по времени.',
  'Возьмёте с небольшой сумкой?',
  'Привет! Можно выйти чуть раньше конечной?',
  'Подтвердите, пожалуйста, время выезда.',
];

const REVIEW_TEXTS = [
  'Всё чётко: выехали вовремя, доехали без нервов.',
  'Приятный попутчик, дорога пролетела незаметно.',
  'Спасибо, помог(ла) с багажом. Рекомендую.',
  'Немного опоздали на старте, в остальном хорошо.',
  'Аккуратное вождение, комфортно.',
];

const KNOWN_CITY_NAMES = new Set(CITIES.map((city) => city.name));

/* ─────────────────── наполнение ─────────────────── */

async function main(prisma: PrismaClient): Promise<void> {
  for (const route of ROUTES) {
    if (!KNOWN_CITY_NAMES.has(route.from) || !KNOWN_CITY_NAMES.has(route.to)) {
      throw new Error(`Маршрут ${route.from} → ${route.to} ссылается на город вне справочника`);
    }
  }

  // Порядок важен: сначала зависимые таблицы.
  await prisma.review.deleteMany();
  await prisma.tripRequest.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.user.deleteMany();

  await prisma.user.createMany({
    data: PEOPLE.map((person, index) => ({
      vkUserId: person.vkUserId,
      firstName: person.firstName,
      lastName: person.lastName,
      city: person.city,
      photoUrl: null,
      // Номера из диапазона 999, который не выдаётся операторами, — по ним
      // никуда не дозвониться, даже если сид случайно уедет не туда.
      // Каждому третьему номер не задан: кнопка «Позвонить» должна
      // проверяться и в состоянии «номера нет».
      phone: index % 3 === 2 ? null : `+79990000${String(index).padStart(3, '0')}`,
      ratingAvg: 0,
      ratingCount: 0,
    })),
  });

  const now = Date.now();
  const tripRows: Prisma.TripCreateManyInput[] = [];

  /**
   * Время выезда — строго по сетке получасов, как требует контракт.
   * Считаем от полуночи UTC, чтобы сид не зависел от часового пояса машины.
   */
  const midnightUtc = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate(),
  );
  const slot = (dayOffset: number, slotIndex: number): Date =>
    new Date(midnightUtc + dayOffset * DAY + slotIndex * 30 * 60 * 1000);

  // 26 активных будущих поездок + 8 завершённых + 2 отменённые = 36.
  let activeCount = 0;
  for (let index = 0; activeCount < 26; index += 1) {
    const route = ROUTES[index % ROUTES.length]!;
    const author = PEOPLE[index % PEOPLE.length]!;
    const isDriver = chance(0.7);
    const seatsTotal = isDriver ? int(1, 4) : int(1, 2);

    // День от завтра до +20, слот — от 05:00 до 21:30 по UTC.
    const departAt = slot(1 + (index % 20), int(10, 43));
    if (departAt.getTime() <= now) {
      continue;
    }

    activeCount += 1;
    tripRows.push({
      id: `seed-active-${activeCount}`,
      authorVkId: author.vkUserId,
      role: isDriver ? 'DRIVER' : 'PASSENGER',
      fromCity: route.from,
      toCity: route.to,
      fromPoint: chance(0.7) ? pick(PICKUP_POINTS) : null,
      toPoint: chance(0.5) ? pick(PICKUP_POINTS) : null,
      departAt,
      seatsTotal,
      seatsLeft: seatsTotal,
      priceRub: priceFor(route.from, route.to),
      carModel: isDriver ? pick(CARS) : null,
      comment: chance(0.8) ? pick(isDriver ? DRIVER_COMMENTS : PASSENGER_COMMENTS) : null,
      status: 'ACTIVE',
    });
  }

  for (let index = 0; index < 8; index += 1) {
    const route = ROUTES[(index * 3) % ROUTES.length]!;
    const author = PEOPLE[(index * 2) % PEOPLE.length]!;
    const seatsTotal = int(2, 4);
    tripRows.push({
      id: `seed-completed-${index + 1}`,
      authorVkId: author.vkUserId,
      role: 'DRIVER',
      fromCity: route.from,
      toCity: route.to,
      fromPoint: pick(PICKUP_POINTS),
      toPoint: null,
      departAt: slot(-(index + 2) * 3, int(12, 40)),
      seatsTotal,
      seatsLeft: seatsTotal,
      priceRub: priceFor(route.from, route.to),
      carModel: pick(CARS),
      comment: pick(DRIVER_COMMENTS),
      status: 'COMPLETED',
    });
  }

  for (let index = 0; index < 2; index += 1) {
    const route = ROUTES[(index * 7 + 1) % ROUTES.length]!;
    const author = PEOPLE[(index * 5 + 3) % PEOPLE.length]!;
    const seatsTotal = int(1, 3);
    tripRows.push({
      id: `seed-cancelled-${index + 1}`,
      authorVkId: author.vkUserId,
      role: 'DRIVER',
      fromCity: route.from,
      toCity: route.to,
      fromPoint: null,
      toPoint: null,
      departAt: slot(index + 3, int(14, 38)),
      seatsTotal,
      seatsLeft: seatsTotal,
      priceRub: priceFor(route.from, route.to),
      carModel: pick(CARS),
      comment: null,
      status: 'CANCELLED',
    });
  }

  // Сид не имеет права породить данные, которые не прошли бы валидацию API.
  for (const trip of tripRows) {
    if (!isAllowedDepartTime(trip.departAt as Date)) {
      throw new Error(`Поездка ${trip.id} выезжает вне сетки получасов: ${String(trip.departAt)}`);
    }
    const price = trip.priceRub as number;
    if (price < LIMITS.PRICE_MIN || price > LIMITS.PRICE_MAX) {
      throw new Error(`Поездка ${trip.id} с ценой ${price} ₽ вне коридора`);
    }
  }

  await prisma.trip.createMany({ data: tripRows });

  /* ─── отклики ─── */

  const requestRows: Prisma.TripRequestCreateManyInput[] = [];
  const acceptedSeats = new Map<string, number>();
  /** tripId → участники (автор + принятые), нужно для отзывов. */
  const participants = new Map<string, bigint[]>();

  for (const trip of tripRows) {
    const candidates = PEOPLE.filter((person) => person.vkUserId !== trip.authorVkId);
    const wanted = trip.status === 'COMPLETED' ? int(2, 3) : int(0, 3);
    const chosen: bigint[] = [];
    for (let i = 0; i < wanted; i += 1) {
      const candidate = pick(candidates).vkUserId;
      if (!chosen.includes(candidate)) {
        chosen.push(candidate);
      }
    }

    const accepted: bigint[] = [];
    for (const userVkId of chosen) {
      const seatsUsed = acceptedSeats.get(trip.id!) ?? 0;
      const seatsFree = trip.seatsTotal - seatsUsed;

      let status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';
      if (trip.status === 'COMPLETED') {
        status = seatsFree > 0 ? 'ACCEPTED' : 'DECLINED';
      } else if (trip.status === 'CANCELLED') {
        status = 'CANCELLED';
      } else if (seatsFree > 0 && chance(0.45)) {
        status = 'ACCEPTED';
      } else if (chance(0.25)) {
        status = 'DECLINED';
      } else {
        status = 'PENDING';
      }

      if (status === 'ACCEPTED') {
        acceptedSeats.set(trip.id!, seatsUsed + 1);
        accepted.push(userVkId);
      }

      requestRows.push({
        tripId: trip.id!,
        userVkId,
        status,
        message: chance(0.75) ? pick(REQUEST_MESSAGES) : null,
        createdAt: new Date(now - int(1, 72) * HOUR),
      });
    }

    participants.set(trip.id!, [trip.authorVkId as bigint, ...accepted]);
  }

  await prisma.tripRequest.createMany({ data: requestRows });

  // seatsLeft приводим в соответствие с принятыми откликами.
  for (const [tripId, used] of acceptedSeats) {
    await prisma.trip.update({
      where: { id: tripId },
      data: { seatsLeft: { decrement: used } },
    });
  }

  /* ─── отзывы ─── */

  const reviewRows: Prisma.ReviewCreateManyInput[] = [];
  const ratingTotals = new Map<string, { sum: number; count: number }>();

  for (const trip of tripRows) {
    if (trip.status !== 'COMPLETED') {
      continue;
    }
    const people = participants.get(trip.id!) ?? [];
    for (const authorVkId of people) {
      for (const targetVkId of people) {
        if (authorVkId === targetVkId || !chance(0.65)) {
          continue;
        }
        const rating = chance(0.75) ? 5 : int(3, 4);
        reviewRows.push({
          tripId: trip.id!,
          authorVkId,
          targetVkId,
          rating,
          text: chance(0.8) ? pick(REVIEW_TEXTS) : null,
          createdAt: new Date(now - int(1, 20) * DAY),
        });
        const key = targetVkId.toString();
        const totals = ratingTotals.get(key) ?? { sum: 0, count: 0 };
        ratingTotals.set(key, { sum: totals.sum + rating, count: totals.count + 1 });
      }
    }
  }

  await prisma.review.createMany({ data: reviewRows });

  for (const [vkUserId, totals] of ratingTotals) {
    await prisma.user.update({
      where: { vkUserId: BigInt(vkUserId) },
      data: {
        ratingCount: totals.count,
        ratingAvg: Math.round((totals.sum / totals.count) * 100) / 100,
      },
    });
  }

  /* ─── отчёт ─── */

  const [users, trips, active, completed, cancelled, requests, pending, acceptedCount, reviews] =
    await Promise.all([
      prisma.user.count(),
      prisma.trip.count(),
      prisma.trip.count({ where: { status: 'ACTIVE' } }),
      prisma.trip.count({ where: { status: 'COMPLETED' } }),
      prisma.trip.count({ where: { status: 'CANCELLED' } }),
      prisma.tripRequest.count(),
      prisma.tripRequest.count({ where: { status: 'PENDING' } }),
      prisma.tripRequest.count({ where: { status: 'ACCEPTED' } }),
      prisma.review.count(),
    ]);

  const routes = await prisma.trip.findMany({
    distinct: ['fromCity', 'toCity'],
    select: { fromCity: true, toCity: true },
  });
  const priceRange = await prisma.trip.aggregate({
    _min: { priceRub: true },
    _max: { priceRub: true },
  });

  console.log('');
  console.log('  Сид выполнен');
  console.log('  ─────────────────────────────────────────');
  console.log(`  Пользователей:        ${users}`);
  console.log(`  Поездок:              ${trips}  (ACTIVE ${active} / COMPLETED ${completed} / CANCELLED ${cancelled})`);
  console.log(`  Уникальных маршрутов: ${routes.length}`);
  console.log(
    `  Цены:                 ${priceRange._min.priceRub} – ${priceRange._max.priceRub} ₽`,
  );
  console.log(`  Откликов:             ${requests}  (PENDING ${pending} / ACCEPTED ${acceptedCount})`);
  console.log(`  Отзывов:              ${reviews}`);
  console.log('');

  const sample = await prisma.trip.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { departAt: 'asc' },
    take: 5,
    include: { author: true },
  });
  console.log('  Ближайшие активные поездки:');
  for (const trip of sample) {
    console.log(
      `   • ${trip.fromCity} → ${trip.toCity}, ${trip.departAt.toISOString()}, ` +
        `${trip.role === 'DRIVER' ? 'водитель' : 'пассажир'} ${trip.author.firstName} ${trip.author.lastName}, ` +
        `мест ${trip.seatsLeft}/${trip.seatsTotal}, ${trip.priceRub} ₽`,
    );
  }
  console.log('');
}

const prisma = createPrismaClient();
main(prisma)
  .catch((error: unknown) => {
    console.error('Сид упал:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
