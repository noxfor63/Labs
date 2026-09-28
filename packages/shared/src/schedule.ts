/**
 * Расписание выездов.
 *
 * Время отправления задаётся не произвольно, а слотами по полчаса: 00:00,
 * 00:30, 01:00 и так далее. Так объявления сравнимы между собой, а
 * попутчикам не приходится гадать, что значит «выезжаю около девяти».
 */

/** Шаг сетки выездов в минутах. */
export const DEPART_STEP_MINUTES = 30;

const MINUTES_IN_DAY = 24 * 60;

/** Все слоты суток в виде `HH:MM` — 48 значений от 00:00 до 23:30. */
export const DEPART_TIME_SLOTS: readonly string[] = Array.from(
  { length: MINUTES_IN_DAY / DEPART_STEP_MINUTES },
  (_, index) => {
    const minutesFromMidnight = index * DEPART_STEP_MINUTES;
    const hours = Math.floor(minutesFromMidnight / 60);
    const minutes = minutesFromMidnight % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  },
);

/**
 * Попадает ли момент в сетку получасов.
 *
 * Проверяется по UTC: именно это значение хранится в БД и приходит в API.
 * Часовые пояса России смещены на целое число часов, поэтому местные
 * :00 и :30 остаются :00 и :30 и в UTC.
 */
export function isAllowedDepartTime(date: Date): boolean {
  return (
    Number.isFinite(date.getTime()) &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0 &&
    date.getUTCMinutes() % DEPART_STEP_MINUTES === 0
  );
}

/** Ближайший слот не раньше указанного момента — подсказка по умолчанию в форме. */
export function nextDepartSlot(from: Date): Date {
  const result = new Date(from.getTime());
  result.setSeconds(0, 0);
  const remainder = result.getMinutes() % DEPART_STEP_MINUTES;
  const addMinutes = remainder === 0 ? 0 : DEPART_STEP_MINUTES - remainder;
  result.setMinutes(result.getMinutes() + addMinutes);
  return result;
}
