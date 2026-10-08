/**
 * Доменные перечисления и числовые границы.
 *
 * Лежат в shared, потому что одни и те же значения нужны и валидации на
 * бэкенде, и подписям полей во фронтенде. Дублировать их в двух местах —
 * самый быстрый способ развести формы и API.
 */

/** Роль **автора** объявления. */
export const TRIP_ROLE = {
  /** Автор за рулём: предлагает места пассажирам. */
  DRIVER: 'DRIVER',
  /** Автор ищет, кто его подвезёт. */
  PASSENGER: 'PASSENGER',
} as const;
export type TripRole = (typeof TRIP_ROLE)[keyof typeof TRIP_ROLE];
export const TRIP_ROLES = [TRIP_ROLE.DRIVER, TRIP_ROLE.PASSENGER] as const;

export const TRIP_STATUS = {
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type TripStatus = (typeof TRIP_STATUS)[keyof typeof TRIP_STATUS];
export const TRIP_STATUSES = [
  TRIP_STATUS.ACTIVE,
  TRIP_STATUS.COMPLETED,
  TRIP_STATUS.CANCELLED,
] as const;

export const REQUEST_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  CANCELLED: 'CANCELLED',
} as const;
export type RequestStatus = (typeof REQUEST_STATUS)[keyof typeof REQUEST_STATUS];
export const REQUEST_STATUSES = [
  REQUEST_STATUS.PENDING,
  REQUEST_STATUS.ACCEPTED,
  REQUEST_STATUS.DECLINED,
  REQUEST_STATUS.CANCELLED,
] as const;

/* ──────────────────────────── жалобы ──────────────────────────── */

/**
 * На что жалуются.
 *
 * Перечисление повторяет то, что человек может написать сам:
 * объявление (точки, машина, комментарий), отзыв и профиль
 * (имя, фото, номер телефона). Сообщение к отклику видит только автор
 * поездки, и жаловаться на него он может как на профиль — отдельного
 * вида для этого нет сознательно, иначе в списке появился бы пункт,
 * непонятный всем остальным.
 */
export const REPORT_TARGET = {
  TRIP: 'TRIP',
  REVIEW: 'REVIEW',
  USER: 'USER',
} as const;
export type ReportTarget = (typeof REPORT_TARGET)[keyof typeof REPORT_TARGET];
export const REPORT_TARGETS = [
  REPORT_TARGET.TRIP,
  REPORT_TARGET.REVIEW,
  REPORT_TARGET.USER,
] as const;

/** Причина жалобы. Набор закрытый: это список в интерфейсе, а не свободный ввод. */
export const REPORT_REASON = {
  /** Реклама, повторы, не относящееся к поездкам. */
  SPAM: 'SPAM',
  /** Оскорбления, вражда, непристойности. */
  OFFENSIVE: 'OFFENSIVE',
  /** Обман: несуществующая поездка, вымогательство, подмена условий. */
  FRAUD: 'FRAUD',
  /** Чужие персональные данные в тексте. */
  PERSONAL_DATA: 'PERSONAL_DATA',
  /** Остальное — обязателен комментарий. */
  OTHER: 'OTHER',
} as const;
export type ReportReason = (typeof REPORT_REASON)[keyof typeof REPORT_REASON];
export const REPORT_REASONS = [
  REPORT_REASON.SPAM,
  REPORT_REASON.OFFENSIVE,
  REPORT_REASON.FRAUD,
  REPORT_REASON.PERSONAL_DATA,
  REPORT_REASON.OTHER,
] as const;

/** Что с жалобой сделала администрация сервиса. */
export const REPORT_STATUS = {
  /** Поступила, ещё не разобрана. */
  NEW: 'NEW',
  /** Разобрана, контент удалён или исправлен. */
  REVIEWED: 'REVIEWED',
  /** Разобрана, нарушения нет. */
  DISMISSED: 'DISMISSED',
} as const;
export type ReportStatus = (typeof REPORT_STATUS)[keyof typeof REPORT_STATUS];
export const REPORT_STATUSES = [
  REPORT_STATUS.NEW,
  REPORT_STATUS.REVIEWED,
  REPORT_STATUS.DISMISSED,
] as const;

/** Подписи причин для интерфейса. Лежат рядом с кодами, чтобы пункт без подписи не появился незаметно. */
export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  SPAM: 'Реклама или спам',
  OFFENSIVE: 'Оскорбления или непристойности',
  FRAUD: 'Обман или мошенничество',
  PERSONAL_DATA: 'Чужие персональные данные',
  OTHER: 'Другое',
};

/** Заголовок, которым фронтенд ВКонтакте передаёт исходную query-строку запуска. */
export const LAUNCH_PARAMS_HEADER = 'x-launch-params';

/** Заголовок, которым фронтенд Telegram передаёт initData как есть. */
export const TELEGRAM_INIT_DATA_HEADER = 'x-telegram-init-data';

/**
 * Постоянный адрес политики конфиденциальности.
 *
 * Лежит здесь, а не в компоненте: ссылка нужна и экрану согласия, и
 * профилю, и карточке приложения в кабинете площадки, и разъехаться эти
 * три места не должны. Страница отдаётся тем же nginx, что и API.
 */
export const PRIVACY_POLICY_URL = 'https://vk-rideshare.duckdns.org/privacy';

/**
 * Адрес для обращений: вопросы по данным и спор о закрытом доступе.
 *
 * Тот же, что в политике конфиденциальности, и лежит рядом с ней не
 * случайно: два разных адреса в двух местах — это один устаревший.
 */
export const SUPPORT_EMAIL = 'noxfor63@gmail.com';

/** Launch-параметры старше суток считаются протухшими. */
export const LAUNCH_PARAMS_MAX_AGE_SECONDS = 24 * 60 * 60;

export const LIMITS = {
  SEATS_MIN: 1,
  /**
   * Шесть мест — предел легкового автомобиля с водителем на этих
   * маршрутах. Значение закрытое: в форме выбор из списка, а не ввод
   * числа, поэтому «7» не должно проходить ни на клиенте, ни на сервере.
   */
  SEATS_MAX: 6,
  /** Цена за место на этих маршрутах: коридор задан продуктом, а не рынком. */
  PRICE_MIN: 500,
  PRICE_MAX: 850,
  RATING_MIN: 1,
  RATING_MAX: 5,
  POINT_MAX: 120,
  /** Длина поля ввода номера: «+7 (999) 123-45-67» со скобками и пробелами. */
  PHONE_MAX: 20,
  CAR_MODEL_MAX: 80,
  COMMENT_MAX: 1_000,
  REQUEST_MESSAGE_MAX: 500,
  REVIEW_TEXT_MAX: 1_000,
  /** Пояснение к жалобе. Короче отзыва: это записка модератору, а не текст для людей. */
  REPORT_COMMENT_MAX: 500,
  PAGE_SIZE_DEFAULT: 20,
  PAGE_SIZE_MAX: 50,
} as const;

/**
 * Допустимые значения «сколько мест» — готовый список для выпадающего
 * списка на клиенте и для проверки в тестах. Считается из LIMITS, чтобы
 * список и границы не разъехались.
 */
export const SEAT_OPTIONS: readonly number[] = Array.from(
  { length: LIMITS.SEATS_MAX - LIMITS.SEATS_MIN + 1 },
  (_, index) => LIMITS.SEATS_MIN + index,
);

/**
 * Через сколько после времени выезда поездка считается прошедшей и
 * закрывается автоматически.
 *
 * Не ноль: выезд в 09:00 не значит, что в 09:01 всё кончилось — люди
 * опаздывают, а отклик, пришедший в последнюю минуту, ещё имеет смысл
 * принять. Три часа — запас на дорогу между этими городами.
 */
export const TRIP_EXPIRY_GRACE_MINUTES = 180;

/**
 * Коды ошибок API. Фронтенд разбирает их, а не текст сообщения,
 * поэтому набор закрытый.
 */
export const ERROR_CODE = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  TRIP_NOT_ACTIVE: 'TRIP_NOT_ACTIVE',
  TRIP_IN_PAST: 'TRIP_IN_PAST',
  OWN_TRIP: 'OWN_TRIP',
  ALREADY_REQUESTED: 'ALREADY_REQUESTED',
  NO_SEATS_LEFT: 'NO_SEATS_LEFT',
  REQUEST_NOT_PENDING: 'REQUEST_NOT_PENDING',
  TRIP_NOT_COMPLETED: 'TRIP_NOT_COMPLETED',
  NOT_A_PARTICIPANT: 'NOT_A_PARTICIPANT',
  ALREADY_REVIEWED: 'ALREADY_REVIEWED',
  SELF_REVIEW: 'SELF_REVIEW',
  /** Жалоба на свой же контент. */
  SELF_REPORT: 'SELF_REPORT',
  /** На этот объект этот человек уже жаловался. */
  ALREADY_REPORTED: 'ALREADY_REPORTED',
  /** Доступ закрыт администрацией за нарушение правил. */
  ACCESS_BLOCKED: 'ACCESS_BLOCKED',
  /** Человек ещё не принял политику конфиденциальности. */
  PRIVACY_NOT_ACCEPTED: 'PRIVACY_NOT_ACCEPTED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];
