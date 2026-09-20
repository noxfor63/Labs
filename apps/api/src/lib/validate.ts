import { type z } from 'zod';

import { validationFailed } from './errors.js';

/**
 * Разбирает вход Zod-схемой и превращает провал в 400 с понятным текстом.
 * Сообщение склеивается из путей полей, чтобы фронтенд мог показать его как есть.
 */
export function parseWith<Schema extends z.ZodType>(
  schema: Schema,
  data: unknown,
): z.output<Schema> {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  const message = result.error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path === '' ? issue.message : `${path}: ${issue.message}`;
    })
    .join('; ');
  throw validationFailed(message);
}
