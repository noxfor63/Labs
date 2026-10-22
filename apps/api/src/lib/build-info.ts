/**
 * Что сейчас запущено: версия приложения и коммит.
 *
 * Нужно двоим. Человеку — чтобы после выкатки одной командой убедиться,
 * что сервер действительно перезапустился на новом коде, а не крутит
 * старый: такое уже ловили, когда «после выкатки ничего не поменялось».
 * Агенту канала — чтобы писать посты только о том, что уже выкачено.
 * Коммит в репозитории ещё не изменение для людей; изменение — то, что
 * работает на сервере.
 *
 * Коммит берётся из APP_COMMIT, если его задали при сборке, иначе —
 * у git в каталоге приложения: на сервере код и так лежит клоном
 * репозитория. Не вышло ни так, ни так — null, и это честный ответ
 * «неизвестно», а не ошибка запуска.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type BuildInfo = {
  version: string;
  commit: string | null;
};

/** Каталог apps/api: из src/ при разработке и из dist/ в бою — на уровень выше. */
const apiRoot = fileURLToPath(new URL('../..', import.meta.url));

function readVersion(): string {
  try {
    const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === 'string' ? version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function readCommit(override: string): string | null {
  const fromEnv = override.trim();
  if (/^[0-9a-f]{7,40}$/i.test(fromEnv)) {
    return fromEnv.toLowerCase();
  }
  try {
    const output = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: apiRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    }).trim();
    return /^[0-9a-f]{40}$/.test(output) ? output : null;
  } catch {
    return null;
  }
}

let cached: BuildInfo | null = null;

/** Считается один раз: ни версия, ни коммит за время работы процесса не меняются. */
export function getBuildInfo(commitOverride = ''): BuildInfo {
  cached ??= { version: readVersion(), commit: readCommit(commitOverride) };
  return cached;
}
