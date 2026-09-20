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

export const formatDate = (iso: string): string => DATE_FORMAT.format(new Date(iso));
export const formatDateTime = (iso: string): string => DATE_TIME_FORMAT.format(new Date(iso));
export const formatTime = (iso: string): string => TIME_FORMAT.format(new Date(iso));

export function formatPrice(priceRub: number | null): string {
  return priceRub === null ? 'Цена не указана' : `${priceRub.toLocaleString('ru-RU')} ₽`;
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
