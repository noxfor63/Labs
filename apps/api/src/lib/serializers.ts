/**
 * Превращение строк Prisma в DTO контракта.
 *
 * Два правила, которые нельзя нарушать: BigInt отдаётся строкой
 * (JSON.stringify на BigInt падает, а number теряет точность),
 * Date — ISO-строкой в UTC.
 */
import type { Review, Trip, TripRequest, User } from '@prisma/client';

import {
  TRIP_STATUS,
  type MyRequestDto,
  type ReviewDto,
  type TripDetail,
  type TripRequestDto,
  type TripSummary,
  type UserPublic,
} from '@vk-rideshare/shared';

export function toUserPublic(user: User): UserPublic {
  return {
    vkUserId: user.vkUserId.toString(),
    firstName: user.firstName,
    lastName: user.lastName,
    photoUrl: user.photoUrl,
    city: user.city,
    ratingAvg: user.ratingAvg,
    ratingCount: user.ratingCount,
  };
}

export type TripWithAuthor = Trip & { author: User };
export type RequestWithUser = TripRequest & { user: User };
export type ReviewWithPeople = Review & { author: User; target: User };

/**
 * Поездка, у которой время выезда прошло, а статус так и остался ACTIVE.
 *
 * Состояние вычисляемое, а не хранимое: то же самое условие уже стоит в
 * ленте и в проверке отклика, и лишняя копия в базе означала бы лишний
 * источник расхождений.
 */
export function isTripExpired(trip: Trip, now: Date = new Date()): boolean {
  return trip.status === TRIP_STATUS.ACTIVE && trip.departAt.getTime() <= now.getTime();
}

export function toTripSummary(trip: TripWithAuthor, now: Date = new Date()): TripSummary {
  return {
    id: trip.id,
    role: trip.role,
    fromCity: trip.fromCity,
    fromPoint: trip.fromPoint,
    toCity: trip.toCity,
    toPoint: trip.toPoint,
    departAt: trip.departAt.toISOString(),
    seatsTotal: trip.seatsTotal,
    seatsLeft: trip.seatsLeft,
    priceRub: trip.priceRub,
    carModel: trip.carModel,
    comment: trip.comment,
    status: trip.status,
    isExpired: isTripExpired(trip, now),
    createdAt: trip.createdAt.toISOString(),
    author: toUserPublic(trip.author),
  };
}

export function toTripRequest(request: RequestWithUser): TripRequestDto {
  return {
    id: request.id,
    tripId: request.tripId,
    status: request.status,
    message: request.message,
    createdAt: request.createdAt.toISOString(),
    user: toUserPublic(request.user),
  };
}

export function toMyRequest(request: RequestWithUser & { trip: TripWithAuthor }): MyRequestDto {
  return {
    ...toTripRequest(request),
    trip: toTripSummary(request.trip),
  };
}

export function toReview(review: ReviewWithPeople): ReviewDto {
  return {
    id: review.id,
    tripId: review.tripId,
    rating: review.rating,
    text: review.text,
    createdAt: review.createdAt.toISOString(),
    author: toUserPublic(review.author),
    target: toUserPublic(review.target),
  };
}

export type TripDetailParts = {
  trip: TripWithAuthor;
  requests: RequestWithUser[];
  viewerVkId: bigint;
  canReview: boolean;
};

export function toTripDetail({
  trip,
  requests,
  viewerVkId,
  canReview,
}: TripDetailParts): TripDetail {
  const isAuthor = trip.authorVkId === viewerVkId;
  const mine = requests.find((request) => request.userVkId === viewerVkId);

  return {
    ...toTripSummary(trip),
    // Полный список откликов — привилегия автора. Остальные видят только свой.
    requests: isAuthor ? requests.map(toTripRequest) : [],
    myRequest: !isAuthor && mine !== undefined ? toTripRequest(mine) : null,
    isAuthor,
    canReview,
  };
}
