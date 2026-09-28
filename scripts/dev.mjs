/**
 * Запуск бэкенда и фронтенда одной командой.
 *
 * Раньше это была строка `npm run dev -w ... & npm run dev -w ... & wait`
 * в package.json — синтаксис POSIX-оболочек, который на Windows молча
 * ничего не делает. Здесь то же самое сделано средствами Node, поэтому
 * команда одинаково работает в cmd, PowerShell, bash и zsh.
 *
 * Новых зависимостей ради этого не добавлено намеренно.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

const TARGETS = [
  { name: 'api', workspace: '@vk-rideshare/api' },
  { name: 'web', workspace: '@vk-rideshare/web' },
];

const isWindows = process.platform === 'win32';
const children = [];
let shuttingDown = false;

/**
 * На Windows kill() убивает только сам npm, а запущенные им tsx и vite
 * остаются жить и держать порты. taskkill с /T снимает всё дерево.
 */
function terminate(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (isWindows && child.pid !== undefined) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  child.kill(signal);
}

function stopAll(signal = 'SIGTERM') {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    terminate(child, signal);
  }
}

for (const target of TARGETS) {
  // npm на Windows — это npm.cmd, напрямую spawn его не находит.
  const child = spawn('npm', ['run', 'dev', '-w', target.workspace], {
    stdio: 'inherit',
    shell: isWindows,
  });

  children.push(child);

  child.on('error', (error) => {
    console.error(`[${target.name}] не удалось запустить: ${error.message}`);
    process.exitCode = 1;
    stopAll();
  });

  // Если один процесс упал, второй без него бесполезен — гасим оба,
  // чтобы не осталось «половины приложения», которую легко не заметить.
  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }
    console.error(
      `\n[${target.name}] процесс завершился (${signal ?? `код ${code}`}). Останавливаю остальные.`,
    );
    process.exitCode = code ?? 1;
    stopAll();
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopAll(signal);
  });
}
