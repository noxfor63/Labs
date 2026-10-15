/**
 * Что делает кнопка «Позвонить» — зависит от того, где открыто приложение.
 *
 * Откуда это взялось. Модерация ВКонтакте отклонила приложение: «крашится
 * при нажатии на кнопку „Позвонить“». В мобильных клиентах приложение —
 * верхний документ встроенного браузера, и переход по tel: перехватывает
 * сам клиент: открывается звонилка. В браузерной версии ВКонтакте
 * приложение живёт во фрейме страницы vk.com, а её политика безопасности
 * (CSP, директива frame-src) разрешает фрейму только свои адреса. Переход
 * фрейма на tel: она запрещает, и браузер подменяет всё приложение
 * страницей «Этот контент заблокирован». Для пользователя это и есть падение.
 *
 * Отсюда три режима:
 *
 *  - `dial` — обычная ссылка tel:, как и было. Телефон, приложение —
 *    верхний документ: звонилку откроет клиент.
 *  - `dial-new-window` — телефон, но приложение во фрейме (мобильная
 *    версия сайта, веб-версия Telegram на телефоне). Ссылка открывается в
 *    новом окне: новое окно — не фрейм, запрет родителя на него не
 *    распространяется, а звонилку телефон откроет сам.
 *  - `copy` — компьютер. Позвонить с него всё равно нечем, и самый
 *    полезный результат нажатия — номер в буфере обмена. Кнопка так и
 *    называется, чтобы не обещать звонок, которого не будет.
 *
 * Режим «телефон или компьютер» берётся из vk_platform, если приложение
 * запущено из ВКонтакте: площадка сообщает это сама, и это надёжнее любой
 * догадки. Иначе — по признакам браузера.
 */
import { getLaunchParams } from '../api/launch-params.js';
import { copyTextViaVk } from '../vk/bridge.js';

export type CallMode = 'dial' | 'dial-new-window' | 'copy';

export type CallEnvironment = {
  /** Устройство умеет звонить: телефон, а не компьютер. */
  mobile: boolean;
  /** Приложение открыто во фрейме чужой страницы. */
  framed: boolean;
};

export function chooseCallMode(environment: CallEnvironment): CallMode {
  if (!environment.mobile) {
    return 'copy';
  }
  return environment.framed ? 'dial-new-window' : 'dial';
}

function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Если даже сравнить окна нельзя, мы точно внутри чужой страницы.
    return true;
  }
}

/**
 * Подсказка ВКонтакте: vk_platform вида mobile_android, mobile_web,
 * desktop_web. null — параметра нет или значение незнакомое.
 */
function vkPlatformIsMobile(): boolean | null {
  const value = new URLSearchParams(getLaunchParams()).get('vk_platform');
  if (value === null) {
    return null;
  }
  if (value.startsWith('mobile')) {
    return true;
  }
  if (value.startsWith('desktop')) {
    return false;
  }
  return null;
}

function isMobileDevice(): boolean {
  const fromVk = vkPlatformIsMobile();
  if (fromVk !== null) {
    return fromVk;
  }
  const hints = (navigator as Navigator & { userAgentData?: { mobile?: unknown } })
    .userAgentData;
  if (typeof hints?.mobile === 'boolean') {
    return hints.mobile;
  }
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function detectCallEnvironment(): CallEnvironment {
  return { mobile: isMobileDevice(), framed: isFramed() };
}

let cached: CallMode | null = null;

/** Режим считается один раз: ни устройство, ни фрейм за сеанс не меняются. */
export function getCallMode(): CallMode {
  cached ??= chooseCallMode(detectCallEnvironment());
  return cached;
}

/** Только для тестов: сбросить запомненный режим. */
export function resetCallModeForTests(): void {
  cached = null;
}

/**
 * Скопировать текст в буфер обмена. false — не вышло ни одним способом.
 *
 * Три способа по очереди, потому что во фрейме каждый может оказаться
 * закрыт:
 *
 * 1. Clipboard API. Во фрейме работает, только если родитель выдал
 *    разрешение clipboard-write; без него отказ приходит сразу.
 * 2. Выделение скрытого поля и команда copy. Старый способ, но во фрейме
 *    с жестом пользователя работает почти везде. Идёт вторым, а не
 *    первым, только потому, что объявлен устаревшим.
 * 3. Мост ВКонтакте — копирует сам клиент, в своём окне.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Закрыто политикой родителя — пробуем дальше.
  }

  if (copyWithSelection(text)) {
    return true;
  }

  return copyTextViaVk(text);
}

function copyWithSelection(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  // Вне экрана, но в документе: невидимый элемент выделить нельзя.
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  let copied: boolean;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}
