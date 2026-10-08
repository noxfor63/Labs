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
 *   npm run moderate -w @vk-rideshare/api -- --who <имя>    — чей это id
 *
 * Идентификатор жалобы можно набирать не целиком: подходит любой
 * однозначный кусок, и в списке для этого напечатан короткий хвост.
 * Именно хвост, а не начало: cuid начинается со времени создания, и у
 * жалоб одной минуты первые символы совпадают.
 */
import process from 'node:process';

import { REPORT_REASON_LABEL } from '@vk-rideshare/shared';

import { prisma } from '../src/db.js';
import { describeTarget, removeContent, setBlocked } from '../src/lib/moderation.js';

/*
 * `npm run moderate | head` закрывает канал на середине вывода, и Node
 * отвечает на это стектрейсом EPIPE. Для команды, которую читают глазами
 * и обрезают head'ом, это шум, а не ошибка.
 */
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') {
    process.exit(0);
  }
  throw error;
});

type Flag =
  | { kind: 'list'; all: boolean }
  | { kind: 'show'; id: string }
  | { kind: 'remove'; id: string }
  | { kind: 'dismiss'; id: string }
  | { kind: 'block'; id: string }
  | { kind: 'unblock'; id: string }
  | { kind: 'who'; id: string };

function parseArgs(argv: string[]): Flag {
  const withValue = ['show', 'remove', 'dismiss', 'block', 'unblock', 'who'] as const;
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
    const about = await describeTarget(prisma, report.target, report.targetId);
    console.log('');
    console.log(
      `${shortId(report.id)}  ${when(report.createdAt)}  ${report.status}  (${report.id})`,
    );
    console.log(
      `  ${report.target} ${report.targetId} — ${about.owner === null ? '—' : fullName(about.owner)}` +
        (about.owner?.blockedAt == null ? '' : ' (доступ закрыт)'),
    );
    console.log(`  причина: ${REPORT_REASON_LABEL[report.reason]}`);
    if (report.comment !== null) {
      console.log(`  пояснение: ${report.comment}`);
    }
    console.log(`  пожаловался: ${fullName(report.reporter)} (${report.reporterId})`);
    for (const line of about.body.split('\n')) {
      console.log(`    ${line}`);
    }
  }

  console.log('');
  console.log(`Всего: ${reports.length}. Что дальше: --show, --remove, --dismiss, --block.`);
}

async function show(prefix: string): Promise<void> {
  const report = await findReport(prefix);
  const about = await describeTarget(prisma, report.target, report.targetId);
  console.log(
    JSON.stringify(
      { report, owner: about.owner, content: about.body.split('\n') },
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    ),
  );
}

/**
 * Удалить то, на что пожаловались, и закрыть жалобу.
 *
 * Для профиля удаления нет: у профиля нечего удалять, кроме человека
 * целиком. Такой случай закрывается блокировкой — `--block`.
 */
async function remove(prefix: string): Promise<void> {
  const report = await findReport(prefix);

  if (!(await removeContent(prisma, report.target, report.targetId))) {
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

/**
 * Кто есть кто: внутренний id для `--block` и идентификатор площадки для
 * MODERATOR_IDS.
 *
 * Нужно ровно для настройки экрана жалоб: свой идентификатор ВКонтакте
 * владелец иначе ищет в адресе профиля, а чужой — никак.
 */
async function who(query: string): Promise<void> {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { firstName: { contains: query, mode: 'insensitive' } },
        { lastName: { contains: query, mode: 'insensitive' } },
        { id: { contains: query } },
      ],
    },
    take: 20,
    orderBy: { createdAt: 'asc' },
  });

  if (users.length === 0) {
    console.log(`Никого похожего на «${query}» не нашлось.`);
    return;
  }

  for (const user of users) {
    const platform =
      user.vkUserId !== null
        ? `VK:${user.vkUserId}`
        : user.tgUserId !== null
          ? `TG:${user.tgUserId}`
          : '—';
    console.log(
      `${fullName(user)}  id: ${user.id}  для MODERATOR_IDS: ${platform}` +
        (user.blockedAt === null ? '' : '  (доступ закрыт)'),
    );
  }
}

async function block(userId: string, blocked: boolean): Promise<void> {
  const user = await setBlocked(prisma, userId, blocked);
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
      await block(flag.id, true);
      break;
    case 'unblock':
      await block(flag.id, false);
      break;
    case 'who':
      await who(flag.id);
      break;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
