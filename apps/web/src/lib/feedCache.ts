import { tripSummarySchema, type TripSummary } from '@vk-rideshare/shared';
import { z } from 'zod';

/**
 * Снимок ленты на устройстве — на случай, когда до сервера не достучаться.
 *
 * Зачем это вообще нужно. В Оренбургской области мобильный интернет
 * периодически ограничивают, и в такие часы работают только сервисы из
 * белого списка Минцифры: ВКонтакте там есть, нашего домена нет и не будет —
 * перечень составляется для крупных платформ, подать заявку некуда.
 * Приложение в этот момент открывается, а каждый запрос упирается в
 * «нет связи».
 *
 * При этом сервис заканчивается телефонным звонком, а голосовая связь
 * при отключении интернета работает. Значит, сохранённого списка с
 * номерами достаточно, чтобы человек всё равно доехал. Ради этого кэш и
 * существует — не ради скорости.
 *
 * Хранится только лента **без фильтров**: предсказуемость важнее полноты.
 * Иначе снимок зависел бы от того, какой фильтр был включён последним, и
 * человек в отключение получал бы три поездки вместо двадцати, не
 * понимая почему.
 */

const KEY = 'po-puti:feed-v1';

/** Сколько карточек держим. Двадцать — ровно одна страница ленты. */
const MAX_ITEMS = 20;

const cachedFeedSchema = z.object({
  savedAt: z.string(),
  items: z.array(tripSummarySchema),
});

export type CachedFeed = z.infer<typeof cachedFeedSchema>;

/**
 * Разбор строгий, схемой контракта.
 *
 * Снимок переживает обновления приложения, а формат поездки меняется:
 * мы уже добавляли и телефон, и @username. Снимок, собранный прошлой
 * версией, лучше выбросить целиком, чем показать карточку с дырами.
 */
export function readFeed(): CachedFeed | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // Приватный режим или запрет на хранилище — живём без кэша.
    return null;
  }
  if (raw === null) {
    return null;
  }

  try {
    const parsed = cachedFeedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveFeed(items: readonly TripSummary[], savedAt: Date = new Date()): void {
  const snapshot: CachedFeed = {
    savedAt: savedAt.toISOString(),
    items: items.slice(0, MAX_ITEMS),
  };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // Переполнилось хранилище или оно запрещено — не повод падать.
  }
}

/** Поездка из снимка по идентификатору. Нужна экрану без связи. */
export function findCachedTrip(tripId: string): TripSummary | null {
  return readFeed()?.items.find((trip) => trip.id === tripId) ?? null;
}
