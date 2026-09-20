/**
 * Сид-данные для локальной разработки.
 *
 * Детерминирован: один и тот же PRNG-сид даёт одну и ту же базу, поэтому
 * тесты фильтров и скриншоты воспроизводимы. Перед наполнением таблицы
 * очищаются, так что сид можно гонять сколько угодно раз.
 */
import { type Prisma, type PrismaClient } from '@prisma/client';

import { CITIES } from '@vk-rideshare/shared';

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
  { vkUserId: 1_000_001n, firstName: 'Анна', lastName: 'Ковалёва', city: 'Москва' },
  { vkUserId: 1_000_002n, firstName: 'Дмитрий', lastName: 'Соколов', city: 'Санкт-Петербург' },
  { vkUserId: 1_000_003n, firstName: 'Мария', lastName: 'Егорова', city: 'Казань' },
  { vkUserId: 1_000_004n, firstName: 'Игорь', lastName: 'Верещагин', city: 'Нижний Новгород' },
  { vkUserId: 1_000_005n, firstName: 'Ольга', lastName: 'Панкратова', city: 'Екатеринбург' },
  { vkUserId: 1_000_006n, firstName: 'Тимур', lastName: 'Гаязов', city: 'Уфа' },
  { vkUserId: 1_000_007n, firstName: 'Светлана', lastName: 'Юрченко', city: 'Краснодар' },
  { vkUserId: 1_000_008n, firstName: 'Никита', lastName: 'Бортников', city: 'Новосибирск' },
  { vkUserId: 1_000_009n, firstName: 'Алина', lastName: 'Мещерякова', city: 'Воронеж' },
  { vkUserId: 1_000_010n, firstName: 'Павел', lastName: 'Стрельцов', city: 'Самара' },
] as const;

/** Правдоподобные междугородние направления из справочника городов. */
const ROUTES: ReadonlyArray<readonly [string, string]> = [
  ['Москва', 'Санкт-Петербург'],
  ['Санкт-Петербург', 'Москва'],
  ['Москва', 'Нижний Новгород'],
  ['Москва', 'Воронеж'],
  ['Москва', 'Тула'],
  ['Москва', 'Ярославль'],
  ['Казань', 'Набережные Челны'],
  ['Казань', 'Самара'],
  ['Екатеринбург', 'Челябинск'],
  ['Екатеринбург', 'Пермь'],
  ['Новосибирск', 'Томск'],
  ['Новосибирск', 'Барнаул'],
  ['Краснодар', 'Сочи'],
  ['Краснодар', 'Ростов-на-Дону'],
  ['Уфа', 'Челябинск'],
  ['Самара', 'Тольятти'],
  ['Воронеж', 'Липецк'],
  ['Ростов-на-Дону', 'Таганрог'],
  ['Пермь', 'Ижевск'],
  ['Саратов', 'Волгоград'],
];

const PICKUP_POINTS = [
  'метро, у первого вагона',
  'автовокзал',
  'ж/д вокзал',
  'заправка на выезде',
  'ТЦ у кольца',
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
  for (const [from, to] of ROUTES) {
    if (!KNOWN_CITY_NAMES.has(from) || !KNOWN_CITY_NAMES.has(to)) {
      throw new Error(`Маршрут ${from} → ${to} ссылается на город вне справочника`);
    }
  }

  // Порядок важен: сначала зависимые таблицы.
  await prisma.review.deleteMany();
  await prisma.tripRequest.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.user.deleteMany();

  await prisma.user.createMany({
    data: PEOPLE.map((person) => ({
      vkUserId: person.vkUserId,
      firstName: person.firstName,
      lastName: person.lastName,
      city: person.city,
      photoUrl: null,
      ratingAvg: 0,
      ratingCount: 0,
    })),
  });

  const now = Date.now();
  const tripRows: Prisma.TripCreateManyInput[] = [];

  // 26 активных будущих поездок + 8 завершённых + 2 отменённые = 36.
  for (let index = 0; index < 26; index += 1) {
    const route = ROUTES[index % ROUTES.length]!;
    const author = PEOPLE[index % PEOPLE.length]!;
    const isDriver = chance(0.7);
    const seatsTotal = isDriver ? int(1, 4) : int(1, 2);
    tripRows.push({
      id: `seed-active-${index + 1}`,
      authorVkId: author.vkUserId,
      role: isDriver ? 'DRIVER' : 'PASSENGER',
      fromCity: route[0],
      toCity: route[1],
      fromPoint: chance(0.7) ? pick(PICKUP_POINTS) : null,
      toPoint: chance(0.5) ? pick(PICKUP_POINTS) : null,
      // Разброс: от +6 часов до +20 суток, разное время суток.
      departAt: new Date(now + 6 * HOUR + index * 17 * HOUR + int(0, 6) * HOUR),
      seatsTotal,
      seatsLeft: seatsTotal,
      priceRub: chance(0.85) ? int(3, 26) * 100 : null,
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
      fromCity: route[0],
      toCity: route[1],
      fromPoint: pick(PICKUP_POINTS),
      toPoint: null,
      departAt: new Date(now - (index + 2) * 3 * DAY),
      seatsTotal,
      seatsLeft: seatsTotal,
      priceRub: int(4, 20) * 100,
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
      fromCity: route[0],
      toCity: route[1],
      fromPoint: null,
      toPoint: null,
      departAt: new Date(now + (index + 3) * DAY),
      seatsTotal,
      seatsLeft: seatsTotal,
      priceRub: int(5, 15) * 100,
      carModel: pick(CARS),
      comment: null,
      status: 'CANCELLED',
    });
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

  console.log('');
  console.log('  Сид выполнен');
  console.log('  ─────────────────────────────────────────');
  console.log(`  Пользователей:        ${users}`);
  console.log(`  Поездок:              ${trips}  (ACTIVE ${active} / COMPLETED ${completed} / CANCELLED ${cancelled})`);
  console.log(`  Уникальных маршрутов: ${routes.length}`);
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
    const price = trip.priceRub === null ? 'цена не указана' : `${trip.priceRub} ₽`;
    console.log(
      `   • ${trip.fromCity} → ${trip.toCity}, ${trip.departAt.toISOString()}, ` +
        `${trip.role === 'DRIVER' ? 'водитель' : 'пассажир'} ${trip.author.firstName} ${trip.author.lastName}, ` +
        `мест ${trip.seatsLeft}/${trip.seatsTotal}, ${price}`,
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
