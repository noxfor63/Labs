/**
 * Контракт API — единый для бэкенда и фронтенда.
 *
 * Бэкенд валидирует этими схемами вход и сериализует ими выход;
 * фронтенд берёт отсюда типы и парсит ответы. Одна схема — один источник
 * правды, иначе формы и API разъезжаются на первом же рефакторинге.
 *
 * vkUserId во всех JSON — строка: BigInt не переживает JSON.stringify,
 * а number теряет точность на больших id.
 */
import { z } from 'zod';

import { isKnownCity, isKnownRoute } from './cities.js';
import { normalizePhone } from './phone.js';
import {
  ERROR_CODE,
  LIMITS,
  REQUEST_STATUSES,
  TRIP_ROLES,
  TRIP_STATUSES,
} from './domain.js';
import { DEPART_STEP_MINUTES, isAllowedDepartTime } from './schedule.js';

/* ──────────────────────────── примитивы ──────────────────────────── */

export const vkUserIdSchema = z
  .string()
  .regex(/^\d{1,19}$/, 'vk_user_id должен быть целым числом');

export const cityNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine(isKnownCity, { message: 'Такого города нет в списке направлений' });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullish()
    .transform((value) => value ?? null);

export const tripRoleSchema = z.enum(TRIP_ROLES);
export const tripStatusSchema = z.enum(TRIP_STATUSES);
export const requestStatusSchema = z.enum(REQUEST_STATUSES);

/* ──────────────────────────── ошибки ──────────────────────────── */

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.enum(Object.values(ERROR_CODE) as [string, ...string[]]),
    message: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/* ──────────────────────────── пользователь ──────────────────────────── */

/**
 * Введённый номер → `+7XXXXXXXXXX`, либо ошибка.
 *
 * Пустая строка — это «номер не указан», а не ошибка: поле необязательное,
 * и очистить его надо уметь.
 */
export const phoneInputSchema = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .transform((value, ctx) => {
    if (value === null) {
      return null;
    }
    const normalized = normalizePhone(value);
    if (normalized === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'Укажите мобильный номер в виде +7 999 123-45-67',
      });
      return z.NEVER;
    }
    return normalized;
  });

export const userPublicSchema = z.object({
  vkUserId: vkUserIdSchema,
  firstName: z.string(),
  lastName: z.string(),
  photoUrl: z.string().nullable(),
  city: z.string().nullable(),
  /** Мобильный для звонка. null — не указан, кнопки «Позвонить» не будет. */
  phone: z.string().nullable(),
  ratingAvg: z.number(),
  ratingCount: z.number().int(),
});
export type UserPublic = z.infer<typeof userPublicSchema>;

export const sessionResponseSchema = z.object({
  user: userPublicSchema,
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/* ──────────────────────────── поездки ──────────────────────────── */

export const tripSummarySchema = z.object({
  id: z.string(),
  role: tripRoleSchema,
  fromCity: z.string(),
  fromPoint: z.string().nullable(),
  toCity: z.string(),
  toPoint: z.string().nullable(),
  departAt: z.string(),
  seatsTotal: z.number().int(),
  seatsLeft: z.number().int(),
  priceRub: z.number().int(),
  carModel: z.string().nullable(),
  comment: z.string().nullable(),
  status: tripStatusSchema,
  /**
   * Время выезда прошло, а поездку так и не закрыли.
   *
   * Считается сервером от текущего времени, а не хранится в базе:
   * вычисляемое состояние не умеет рассинхронизироваться со временем,
   * а хранимое — умеет, если фоновая уборка отстала или не сработала.
   */
  isExpired: z.boolean(),
  createdAt: z.string(),
  author: userPublicSchema,
});
export type TripSummary = z.infer<typeof tripSummarySchema>;

export const tripRequestSchema = z.object({
  id: z.string(),
  tripId: z.string(),
  status: requestStatusSchema,
  message: z.string().nullable(),
  createdAt: z.string(),
  user: userPublicSchema,
});
export type TripRequestDto = z.infer<typeof tripRequestSchema>;

export const tripDetailSchema = tripSummarySchema.extend({
  /** Автор видит все отклики; остальные — пустой массив. */
  requests: z.array(tripRequestSchema),
  /** Свой отклик, если он есть. Автору здесь всегда null. */
  myRequest: tripRequestSchema.nullable(),
  isAuthor: z.boolean(),
  /** Можно ли текущему пользователю оставить отзыв по этой поездке. */
  canReview: z.boolean(),
});
export type TripDetail = z.infer<typeof tripDetailSchema>;

export const tripListResponseSchema = z.object({
  items: z.array(tripSummarySchema),
  /** Курсор следующей страницы; null — страниц больше нет. */
  nextCursor: z.string().nullable(),
});
export type TripListResponse = z.infer<typeof tripListResponseSchema>;

/* ───────────────────────── вход: поиск поездок ───────────────────────── */

export const tripListQuerySchema = z.object({
  from: cityNameSchema.optional(),
  to: cityNameSchema.optional(),
  /** Календарная дата отправления, YYYY-MM-DD, по местному времени клиента. */
  date: z.iso.date().optional(),
  role: tripRoleSchema.optional(),
  priceMax: z.coerce
    .number()
    .int()
    .min(LIMITS.PRICE_MIN)
    .max(LIMITS.PRICE_MAX)
    .optional(),
  seatsMin: z.coerce
    .number()
    .int()
    .min(LIMITS.SEATS_MIN)
    .max(LIMITS.SEATS_MAX)
    .optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITS.PAGE_SIZE_MAX)
    .default(LIMITS.PAGE_SIZE_DEFAULT),
});
export type TripListQuery = z.input<typeof tripListQuerySchema>;

/* ───────────────────────── вход: создание поездки ───────────────────────── */

export const createTripSchema = z
  .object({
    role: tripRoleSchema,
    fromCity: cityNameSchema,
    fromPoint: optionalText(LIMITS.POINT_MAX),
    toCity: cityNameSchema,
    toPoint: optionalText(LIMITS.POINT_MAX),
    departAt: z.iso.datetime({ offset: true }),
    seatsTotal: z.coerce.number().int().min(LIMITS.SEATS_MIN).max(LIMITS.SEATS_MAX),
    priceRub: z.coerce
      .number()
      .int()
      .min(LIMITS.PRICE_MIN, `Цена не может быть меньше ${LIMITS.PRICE_MIN} ₽`)
      .max(LIMITS.PRICE_MAX, `Цена не может быть больше ${LIMITS.PRICE_MAX} ₽`),
    carModel: optionalText(LIMITS.CAR_MODEL_MAX),
    comment: optionalText(LIMITS.COMMENT_MAX),
  })
  .refine((value) => new Date(value.departAt).getTime() > Date.now(), {
    message: 'Дата отправления должна быть в будущем',
    path: ['departAt'],
  })
  .refine((value) => isAllowedDepartTime(new Date(value.departAt)), {
    message: `Время выезда задаётся с шагом ${DEPART_STEP_MINUTES} минут: 08:00, 08:30 и так далее`,
    path: ['departAt'],
  })
  .refine((value) => isKnownRoute(value.fromCity, value.toCity), {
    message: 'Такого направления нет. Доступны Оренбург, Соль-Илецк и Акбулак между собой',
    path: ['toCity'],
  });
export type CreateTripInput = z.input<typeof createTripSchema>;

export const patchTripSchema = z.object({
  status: z.enum(['COMPLETED', 'CANCELLED']),
});
export type PatchTripInput = z.infer<typeof patchTripSchema>;

/* ───────────────────────── вход: отклики ───────────────────────── */

export const createTripRequestSchema = z.object({
  message: optionalText(LIMITS.REQUEST_MESSAGE_MAX),
});
export type CreateTripRequestInput = z.input<typeof createTripRequestSchema>;

export const patchTripRequestSchema = z.object({
  status: z.enum(['ACCEPTED', 'DECLINED']),
});
export type PatchTripRequestInput = z.infer<typeof patchTripRequestSchema>;

export const myRequestSchema = tripRequestSchema.extend({
  trip: tripSummarySchema,
});
export type MyRequestDto = z.infer<typeof myRequestSchema>;

export const myTripsQuerySchema = z.object({
  status: tripStatusSchema.optional(),
});
export const myRequestsQuerySchema = z.object({
  status: requestStatusSchema.optional(),
});

/* ───────────────────────── отзывы ───────────────────────── */

export const createReviewSchema = z.object({
  tripId: z.string().min(1),
  targetVkId: vkUserIdSchema,
  rating: z.coerce.number().int().min(LIMITS.RATING_MIN).max(LIMITS.RATING_MAX),
  text: optionalText(LIMITS.REVIEW_TEXT_MAX),
});
export type CreateReviewInput = z.input<typeof createReviewSchema>;

export const reviewSchema = z.object({
  id: z.string(),
  tripId: z.string(),
  rating: z.number().int(),
  text: z.string().nullable(),
  createdAt: z.string(),
  author: userPublicSchema,
  target: userPublicSchema,
});
export type ReviewDto = z.infer<typeof reviewSchema>;

/* ───────────────────────── публичный профиль ───────────────────────── */

export const userProfileResponseSchema = z.object({
  user: userPublicSchema,
  completedTripsCount: z.number().int(),
  reviews: z.array(reviewSchema),
});
export type UserProfileResponse = z.infer<typeof userProfileResponseSchema>;

/** Кандидаты на отзыв по завершённой поездке. */
export const reviewableParticipantSchema = z.object({
  trip: tripSummarySchema,
  participants: z.array(userPublicSchema),
  /** Кому текущий пользователь уже поставил оценку по этой поездке. */
  alreadyReviewedVkIds: z.array(vkUserIdSchema),
});
export type ReviewableParticipants = z.infer<typeof reviewableParticipantSchema>;
