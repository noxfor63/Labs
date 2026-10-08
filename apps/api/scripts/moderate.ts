/**
 * Разбор жалоб на пользовательский контент.
 *
 * Админки у сервиса нет и пока не нужно: жалоб единицы, а разбирает их
 * один человек — тот же, кто его запустил. Нужен не интерфейс, а
 * возможность за минуту увидеть, на что пожаловались, прочитать сам
 * текст и что-то с ним сделать. Это и есть содержание постмодерации:
 * без такого инструмента «мы проверяем жалобы» нечем подтвердить.
 *
 *   npm run moderate -w @vk-rideshare/api                 — что нового
 *   npm run moderate -w @vk-rideshare/api -- --all        — вместе с разобранным
 *   npm run moderate -w @vk-rideshare/api -- --show <id>  — одна жалоба целиком
 *   npm run moderate -w @vk-rideshare/api -- --remove <id>  — удалить контент
 *   npm run moderate -w @vk-rideshare/api -- --dismiss <id> — нарушения нет
 *   npm run moderate -w @vk-rideshare/api -- --block <userId>
 *   npm run moderate -w @vk-rideshare/api -- --unblock <userId>
 *
 * Идентификатор жалобы можно набирать не целиком: подходит любой
 * однозначный кусок, и в списке для этого напечатан короткий хвост.
 * Именно хвост, а не начало: cuid начинается со времени создания, и у
 * жалоб одной минуты первые символы совпадают.
 */
import process from 'node:process';

import { REPORT_REASON_LABEL, REPORT_TARGET } from '@vk-rideshare/shared';

import { prisma } from '../src/db.js';
import { recalculateRating } from '../src/lib/participants.js';

type Flag =
  | { kind: 'list'; all: boolean }
  | { kind: 'show'; id: string }
  | { kind: 'remove'; id: string }
  | { kind: 'dismiss'; id: string }
  | { kind: 'block'; id: string }
  | { kind: 'unblock'; id: string };

function parseArgs(argv: string[]): Flag {
  const withValue = ['show', 'remove', 'dismiss', 'block', 'unblock'] as const;
  for (const name of withValue) {
    const index = argv.indexOf(`--${name}`);
    if (index !== -1) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`--${name} требует идентификатор`);
      }
      return { kind: name, id: value };
    }
  }
  return { kind: 'list', all: argv.includes('--all') };
}

const fullName = (user: { firstName: string; lastName: string }): string =>
  `${user.firstName} ${user.lastName}`.trim();

const when = (date: Date): string => date.toISOString().slice(0, 16).replace('T', ' ');

/** Короткий хвост идентификатора — то, что печатается в списке и набирается руками. */
const shortId = (id: string): string => id.slice(-6);

/** Жалоба по куску идентификатора: подходит и хвост из списка, и полный cuid. */
async function findReport(fragment: string) {
  const matches = await prisma.report.findMany({
    where: { id: { contains: fragment } },
    take: 2,
  });
  if (matches.length === 0) {
    throw new Error(`Жалоба ${fragment} не найдена`);
  }
  if (matches.length > 1) {
    throw new Error(`Под ${fragment} подходит несколько жалоб — возьмите идентификатор целиком`);
  }
  return matches[0]!;
}

/** Текст, на который пожаловались, и его автор. */
async function describeTarget(
  target: string,
  targetId: string,
): Promise<{ owner: string; ownerId: string | null; body: string }> {
  if (target === REPORT_TARGET.TRIP) {
    const trip = await prisma.trip.findUnique({
      where: { id: targetId },
      include: { author: true },
    });
    if (trip === null) {
      return { owner: '—', ownerId: null, body: 'объявление уже удалено' };
    }
    return {
      owner: fullName(trip.author),
      ownerId: trip.authorId,
      body: [
        `${trip.fromCity} → ${trip.toCity}, ${when(trip.departAt)}, ${trip.priceRub} ₽`,
        trip.fromPoint === null ? null : `откуда: ${trip.fromPoint}`,
        trip.toPoint === null ? null : `куда: ${trip.toPoint}`,
        trip.carModel === null ? null : `машина: ${trip.carModel}`,
        trip.comment === null ? null : `комментарий: ${trip.comment}`,
      ]
        .filter((line) => line !== null)
        .join('\n    '),
    };
  }

  if (target === REPORT_TARGET.REVIEW) {
    const review = await prisma.review.findUnique({
      where: { id: targetId },
      include: { author: true, target: true },
    });
    if (review === null) {
      return { owner: '—', ownerId: null, body: 'отзыв уже удалён' };
    }
    return {
      owner: fullName(review.author),
      ownerId: review.authorId,
      body: `оценка ${review.rating} о ${fullName(review.target)}: ${review.text ?? 'без текста'}`,
    };
  }

  const user = await prisma.user.findUnique({ where: { id: targetId } });
  if (user === null) {
    return { owner: '—', ownerId: null, body: 'профиль удалён' };
  }
  return {
    owner: fullName(user),
    ownerId: user.id,
    body: [
      `имя: ${fullName(user)}`,
      user.city === null ? null : `город: ${user.city}`,
      user.phone === null ? null : `телефон: ${user.phone}`,
      user.photoUrl === null ? null : `фото: ${user.photoUrl}`,
      user.blockedAt === null ? null : `доступ закрыт ${when(user.blockedAt)}`,
    ]
      .filter((line) => line !== null)
      .join('\n    '),
  };
}

async function list(all: boolean): Promise<void> {
  const reports = await prisma.report.findMany({
    where: all ? {} : { status: 'NEW' },
    orderBy: { createdAt: 'desc' },
    include: { reporter: true },
    take: 50,
  });

  if (reports.length === 0) {
    console.log(all ? 'Жалоб нет.' : 'Новых жалоб нет.');
    return;
  }

  for (const report of reports) {
    const about = await describeTarget(report.target, report.targetId);
    console.log('');
    console.log(
      `${shortId(report.id)}  ${when(report.createdAt)}  ${report.status}  (${report.id})`,
    );
    console.log(`  ${report.target} ${report.targetId} — ${about.owner}`);
    console.log(`  причина: ${REPORT_REASON_LABEL[report.reason]}`);
    if (report.comment !== null) {
      console.log(`  пояснение: ${report.comment}`);
    }
    console.log(`  пожаловался: ${fullName(report.reporter)} (${report.reporterId})`);
    console.log(`    ${about.body}`);
  }

  console.log('');
  console.log(`Всего: ${reports.length}. Что дальше: --show, --remove, --dismiss, --block.`);
}

async function show(prefix: string): Promise<void> {
  const report = await findReport(prefix);
  const about = await describeTarget(report.target, report.targetId);
  console.log(JSON.stringify({ report, content: about }, null, 2));
}

/**
 * Удалить то, на что пожаловались, и закрыть жалобу.
 *
 * Для профиля удаления нет: у профиля нечего удалять, кроме человека
 * целиком. Такой случай закрывается блокировкой — `--block`.
 */
async function remove(prefix: string): Promise<void> {
  const report = await findReport(prefix);

  if (report.target === REPORT_TARGET.TRIP) {
    await prisma.trip.delete({ where: { id: report.targetId } }).catch(() => {
      console.log('Объявления уже нет — отмечаю жалобу разобранной.');
    });
  } else if (report.target === REPORT_TARGET.REVIEW) {
    const review = await prisma.review.findUnique({ where: { id: report.targetId } });
    if (review !== null) {
      // Рейтинг адресата пересчитывается тут же: удалённый отзыв не должен
      // продолжать влиять на среднюю оценку.
      await prisma.$transaction(async (tx) => {
        await tx.review.delete({ where: { id: review.id } });
        await recalculateRating(tx, review.targetId);
      });
    }
  } else {
    console.log('У профиля удалять нечего. Если нарушение в профиле — закройте доступ:');
    console.log(`  npm run moderate -w @vk-rideshare/api -- --block ${report.targetId}`);
    return;
  }

  await prisma.report.update({ where: { id: report.id }, data: { status: 'REVIEWED' } });
  console.log(`Контент удалён, жалоба ${shortId(report.id)} закрыта.`);
}

async function dismiss(prefix: string): Promise<void> {
  const report = await findReport(prefix);
  await prisma.report.update({ where: { id: report.id }, data: { status: 'DISMISSED' } });
  console.log(`Жалоба ${shortId(report.id)} закрыта: нарушения нет.`);
}

async function setBlocked(userId: string, blocked: boolean): Promise<void> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { blockedAt: blocked ? new Date() : null },
  });
  console.log(
    blocked
      ? `Доступ закрыт: ${fullName(user)} (${user.id}).`
      : `Доступ открыт: ${fullName(user)} (${user.id}).`,
  );
}

try {
  const flag = parseArgs(process.argv.slice(2));
  switch (flag.kind) {
    case 'list':
      await list(flag.all);
      break;
    case 'show':
      await show(flag.id);
      break;
    case 'remove':
      await remove(flag.id);
      break;
    case 'dismiss':
      await dismiss(flag.id);
      break;
    case 'block':
      await setBlocked(flag.id, true);
      break;
    case 'unblock':
      await setBlocked(flag.id, false);
      break;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
