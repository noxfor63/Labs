import { ERROR_CODE, type ErrorCode } from '@vk-rideshare/shared';

/**
 * Единственный способ вернуть клиенту ошибку.
 * Формат ответа всегда { error: { code, message } } — фронтенд разбирает code.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;

  constructor(statusCode: number, code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
  }

  toResponse(): { error: { code: ErrorCode; message: string } } {
    return { error: { code: this.code, message: this.message } };
  }
}

export const unauthorized = (message = 'Не удалось подтвердить запуск из ВКонтакте'): ApiError =>
  new ApiError(401, ERROR_CODE.UNAUTHORIZED, message);

export const forbidden = (message = 'Действие доступно только автору'): ApiError =>
  new ApiError(403, ERROR_CODE.FORBIDDEN, message);

export const notFound = (message = 'Не найдено'): ApiError =>
  new ApiError(404, ERROR_CODE.NOT_FOUND, message);

export const validationFailed = (message: string): ApiError =>
  new ApiError(400, ERROR_CODE.VALIDATION_FAILED, message);

export const conflict = (code: ErrorCode, message: string): ApiError =>
  new ApiError(409, code, message);
