/**
 * Клиент API.
 *
 * Каждый запрос несёт заголовок авторизации своей площадки: у ВКонтакте
 * это исходная query-строка запуска, у Telegram — initData. Какой именно,
 * решает слой площадок; клиенту это знать незачем. Подписи проверяет
 * бэкенд, секретные ключи сюда не попадают и попасть не могут.
 */
import {
  type CreateReportInput,
  type CreateReviewInput,
  type CreateTripInput,
  type MyRequestDto,
  type ReportDto,
  type ReviewableParticipants,
  type SessionResponse,
  type SessionState,
  type TripDetail,
  type TripListQuery,
  type TripListResponse,
  type TripRequestDto,
  type TripSummary,
  type UserProfileResponse,
} from '@vk-rideshare/shared';

import { getPlatform } from '../platform/index.js';

/**
 * VITE_API_BASE_URL из корневого .env, подставленный сборкой
 * (см. define в apps/web/vite.config.ts). В тестах константы нет —
 * от этого спасает проверка через typeof.
 *
 * Пустая строка — это «не задано»: `??` её не ловит, и все запросы
 * ушли бы на относительный путь вместо API.
 */
declare const __API_BASE_URL__: string | undefined;

const configuredBaseUrl = typeof __API_BASE_URL__ === 'string' ? __API_BASE_URL__ : '';
const BASE_URL: string =
  configuredBaseUrl.trim() !== ''
    ? configuredBaseUrl.trim().replace(/\/+$/, '')
    : 'http://localhost:3000/api';

/** Ошибка, у которой есть машиночитаемый код из контракта API. */
export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }

  /** Сеть недоступна — показываем экран «Повторить», а не текст ошибки. */
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
};

function buildUrl(path: string, query: RequestOptions['query']): string {
  const url = `${BASE_URL}${path}`;
  if (query === undefined) {
    return url;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return search === '' ? url : `${url}?${search}`;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...getPlatform().authHeaders() };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiRequestError(0, 'NETWORK', 'Нет связи с сервером');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? (payload as { error: { code?: string; message?: string } }).error
        : {};
    throw new ApiRequestError(
      response.status,
      error.code ?? 'INTERNAL',
      error.message ?? 'Что-то пошло не так',
    );
  }

  return payload as T;
}

export const api = {
  /**
   * Состояние сессии, ничего не создавая.
   *
   * Зовётся первым при запуске: пока не известно, принимал ли человек
   * политику, писать о нём на сервер нельзя.
   */
  getSession: (signal?: AbortSignal): Promise<SessionState> =>
    request('/session', { ...(signal === undefined ? {} : { signal }) }),

  session: (profile: {
    firstName?: string;
    lastName?: string;
    photoUrl?: string | null;
    city?: string | null;
    /** Номер в любом виде — бэкенд сам приведёт к +7XXXXXXXXXX. */
    phone?: string | null;
    /** Согласие с политикой. Без него сервер вернёт PRIVACY_NOT_ACCEPTED. */
    privacyAccepted?: true;
  }): Promise<SessionResponse> => request('/session', { method: 'POST', body: profile }),

  listTrips: (query: TripListQuery, signal?: AbortSignal): Promise<TripListResponse> =>
    request('/trips', {
      query: query as Record<string, string | number | undefined>,
      ...(signal === undefined ? {} : { signal }),
    }),

  createTrip: (input: CreateTripInput): Promise<TripSummary> =>
    request('/trips', { method: 'POST', body: input }),

  getTrip: (tripId: string, signal?: AbortSignal): Promise<TripDetail> =>
    request(`/trips/${encodeURIComponent(tripId)}`, {
      ...(signal === undefined ? {} : { signal }),
    }),

  patchTrip: (tripId: string, status: 'COMPLETED' | 'CANCELLED'): Promise<TripSummary> =>
    request(`/trips/${encodeURIComponent(tripId)}`, { method: 'PATCH', body: { status } }),

  respond: (tripId: string, message: string | null): Promise<TripRequestDto> =>
    request(`/trips/${encodeURIComponent(tripId)}/requests`, {
      method: 'POST',
      body: { message },
    }),

  patchRequest: (requestId: string, status: 'ACCEPTED' | 'DECLINED'): Promise<TripRequestDto> =>
    request(`/requests/${encodeURIComponent(requestId)}`, { method: 'PATCH', body: { status } }),

  myTrips: (signal?: AbortSignal): Promise<{ items: TripSummary[] }> =>
    request('/me/trips', { ...(signal === undefined ? {} : { signal }) }),

  myRequests: (signal?: AbortSignal): Promise<{ items: MyRequestDto[] }> =>
    request('/me/requests', { ...(signal === undefined ? {} : { signal }) }),

  reviewable: (tripId: string, signal?: AbortSignal): Promise<ReviewableParticipants> =>
    request(`/trips/${encodeURIComponent(tripId)}/reviewable`, {
      ...(signal === undefined ? {} : { signal }),
    }),

  createReview: (input: CreateReviewInput): Promise<unknown> =>
    request('/reviews', { method: 'POST', body: input }),

  getUser: (userId: string, signal?: AbortSignal): Promise<UserProfileResponse> =>
    request(`/users/${encodeURIComponent(userId)}`, {
      ...(signal === undefined ? {} : { signal }),
    }),

  /** Жалоба на объявление, отзыв или профиль. */
  createReport: (input: CreateReportInput): Promise<ReportDto> =>
    request('/reports', { method: 'POST', body: input }),
};
