/**
 * Сборка и проверка строки подключения к Postgres.
 *
 * Пароль в URL обязан быть percent-encoded, иначе спецсимволы ломают
 * разбор адреса, причём по-разному и с непохожими ошибками:
 *   @  — хвост пароля принимается за адрес сервера   → P1001
 *   #  — начинает якорь, строка становится неполной  → P1013
 *   %  — незакрытая escape-последовательность        → P1000, «неверный пароль»
 *   пробел, кириллица — тоже доедут искажёнными      → P1000
 *
 * Скрипт кодирует пароль сам и тут же пробует подключиться, чтобы
 * отличить «пароль неверный» от «строка собрана неправильно».
 *
 *   npm run db:url -w @vk-rideshare/api -- --password "мой пароль"
 */
import process from 'node:process';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

function readArg(name: string, fallback: string): string {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index !== -1) {
    const value = process.argv[index + 1];
    if (value !== undefined && !value.startsWith('--')) {
      return value;
    }
  }
  const inline = process.argv.find((item) => item.startsWith(`${flag}=`));
  return inline === undefined ? fallback : inline.slice(flag.length + 1);
}

const user = readArg('user', 'postgres');
const password = readArg('password', '');
const host = readArg('host', 'localhost');
const port = readArg('port', '5432');
const database = readArg('database', 'vk_rideshare');

if (password === '') {
  console.error('');
  console.error('Укажите пароль, который задавали при установке PostgreSQL:');
  console.error('  npm run db:url -w @vk-rideshare/api -- --password "ваш пароль"');
  console.error('');
  console.error('Необязательные флаги: --user (по умолчанию postgres), --host,');
  console.error('--port, --database.');
  console.error('');
  process.exit(1);
}

const buildUrl = (db: string): string =>
  `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}` +
  `@${host}:${port}/${db}?schema=public`;

const url = buildUrl(database);

/**
 * Проверяемся на служебной базе `postgres`: она есть всегда, а вот
 * рабочей может ещё не быть — её создаст db:push.
 */
async function check(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: buildUrl('postgres') }),
  });

  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('');
    console.log('  Подключение удалось. Впишите эту строку в .env:');
    console.log('');
    console.log(`DATABASE_URL=${url}`);
    console.log('');
    if (encodeURIComponent(password) !== password) {
      console.log('  Пароль содержит спецсимволы — в строке выше они закодированы.');
      console.log('  Так и вставляйте, менять обратно не нужно.');
      console.log('');
    }
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    // Prisma начинает сообщение с пустых строк — берём первую содержательную.
    const message = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .join(' ');
    console.error('');
    console.error('  Подключиться не удалось.');
    console.error('');
    if (/password|authentication|SASL/i.test(message)) {
      console.error(`  Сервер на ${host}:${port} отвечает, но не принял пароль`);
      console.error(`  пользователя «${user}».`);
      console.error('');
      console.error('  Проверьте пароль — тот ли, что задавали при установке.');
      console.error('  Забыли — сбросьте его, как описано в README, раздел');
      console.error('  «Если что-то пошло не так».');
    } else if (/reach|ECONNREFUSED|ENOTFOUND|timeout/i.test(message)) {
      console.error(`  Сервер на ${host}:${port} не отвечает.`);
      console.error('  Проверьте, что PostgreSQL запущен: «Службы» →');
      console.error('  postgresql-x64-16 → «Выполняется».');
    } else {
      console.error(`  ${message}`);
    }
    console.error('');
    // Код возврата 0 намеренно: это диагностика, а не проверка в CI.
    // Ненулевой код заставил бы npm вывалить свой стек поверх подсказки.
  } finally {
    await prisma.$disconnect();
  }
}

void check();
