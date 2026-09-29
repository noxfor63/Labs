const DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
});

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

const TIME_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
});

const DAY_SHORT_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

export const formatDate = (iso: string): string => DATE_FORMAT.format(new Date(iso));
export const formatDateTime = (iso: string): string => DATE_TIME_FORMAT.format(new Date(iso));
export const formatTime = (iso: string): string => TIME_FORMAT.format(new Date(iso));

/** Полночь указанного дня по местному времени — не по UTC. */
function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Разница в календарных днях по местному времени.
 * 0 — сегодня, 1 — завтра, −1 — вчера.
 */
export function daysApart(iso: string, now: Date = new Date()): number {
  const day = 24 * 60 * 60 * 1000;
  return Math.round((startOfLocalDay(new Date(iso)) - startOfLocalDay(now)) / day);
}

/**
 * Короткая подпись дня для карточки: «Сегодня», «Завтра», «сб, 4 окт.».
 *
 * Человек, глядящий на ленту, почти всегда ищет ближайшие сутки —
 * и «Сегодня» он считывает быстрее, чем «4 октября».
 */
export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const diff = daysApart(iso, now);
  if (diff === 0) {
    return 'Сегодня';
  }
  if (diff === 1) {
    return 'Завтра';
  }
  if (diff === -1) {
    return 'Вчера';
  }
  return DAY_SHORT_FORMAT.format(new Date(iso));
}

/** «Сегодня в 09:30», «сб, 4 окт. в 09:30» — для заголовков и деталей. */
export function formatDayAndTime(iso: string, now: Date = new Date()): string {
  return `${formatDayLabel(iso, now)} в ${formatTime(iso)}`;
}

export function formatPrice(priceRub: number): string {
  return `${priceRub.toLocaleString('ru-RU')} ₽`;
}

/** «3 места», «1 место», «5 мест» — без библиотек склонения. */
export function pluralize(count: number, forms: [string, string, string]): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 > 10 && mod100 < 20) {
    return forms[2];
  }
  if (mod10 === 1) {
    return forms[0];
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return forms[1];
  }
  return forms[2];
}

export const formatSeats = (count: number): string =>
  `${count} ${pluralize(count, ['место', 'места', 'мест'])}`;

export const formatReviews = (count: number): string =>
  `${count} ${pluralize(count, ['отзыв', 'отзыва', 'отзывов'])}`;

export const formatTrips = (count: number): string =>
  `${count} ${pluralize(count, ['поездка', 'поездки', 'поездок'])}`;

export const formatRating = (ratingAvg: number, ratingCount: number): string =>
  ratingCount === 0 ? 'Пока без оценок' : ratingAvg.toFixed(1);

export const fullName = (user: { firstName: string; lastName: string }): string =>
  `${user.firstName} ${user.lastName}`.trim();

/** Дата для <input type="date"> — локальный день, а не UTC. */
export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
