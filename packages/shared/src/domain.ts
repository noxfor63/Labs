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

/** Заголовок, которым фронтенд передаёт исходную query-строку запуска. */
export const LAUNCH_PARAMS_HEADER = 'x-launch-params';

/** Launch-параметры старше суток считаются протухшими. */
export const LAUNCH_PARAMS_MAX_AGE_SECONDS = 24 * 60 * 60;

export const LIMITS = {
  SEATS_MIN: 1,
  SEATS_MAX: 8,
  /** Цена за место на этих маршрутах: коридор задан продуктом, а не рынком. */
  PRICE_MIN: 500,
  PRICE_MAX: 850,
  RATING_MIN: 1,
  RATING_MAX: 5,
  POINT_MAX: 120,
  CAR_MODEL_MAX: 80,
  COMMENT_MAX: 1_000,
  REQUEST_MESSAGE_MAX: 500,
  REVIEW_TEXT_MAX: 1_000,
  PAGE_SIZE_DEFAULT: 20,
  PAGE_SIZE_MAX: 50,
} as const;

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
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];
