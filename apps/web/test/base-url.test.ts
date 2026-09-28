import { describe, expect, it } from 'vitest';

/**
 * Тот же выбор адреса API, что в apps/web/src/api/client.ts.
 * Проверяем именно поведение на пустой строке: `??` её не ловит, и с
 * незаполненным VITE_API_BASE_URL все запросы ушли бы в никуда.
 */
function resolveBaseUrl(configured: unknown): string {
  return typeof configured === 'string' && configured.trim() !== ''
    ? configured.trim().replace(/\/+$/, '')
    : 'http://localhost:3000/api';
}

describe('выбор адреса API', () => {
  const fallback = 'http://localhost:3000/api';

  it('незаполненная переменная даёт локальный адрес по умолчанию', () => {
    expect(resolveBaseUrl(undefined)).toBe(fallback);
    expect(resolveBaseUrl('')).toBe(fallback);
    expect(resolveBaseUrl('   ')).toBe(fallback);
  });

  it('заданный адрес используется как есть', () => {
    expect(resolveBaseUrl('https://api.example.com/api')).toBe('https://api.example.com/api');
  });

  it('хвостовые слэши срезаются, чтобы не получилось //trips', () => {
    expect(resolveBaseUrl('https://api.example.com/api/')).toBe('https://api.example.com/api');
    expect(resolveBaseUrl('https://api.example.com/api///')).toBe('https://api.example.com/api');
  });
});
