import { useCallback, useEffect, useState } from 'react';

import { ApiRequestError } from '../api/client.js';

export type AsyncState<T> = {
  data: T | null;
  /** Данных ещё нет или они от прошлого запроса. */
  isLoading: boolean;
  /** Данные есть, но идёт повторная загрузка. */
  isRefreshing: boolean;
  error: ApiRequestError | null;
};

export type AsyncResult<T> = AsyncState<T> & {
  reload: () => void;
};

export type UseAsyncOptions = {
  /**
   * false — запрос не уходит вообще. Нужно панелям, которые смонтированы,
   * но сейчас не видны: `View` держит в дереве все свои панели сразу, и без
   * этого флага неактивная панель дёргает API с пустым id.
   */
  enabled?: boolean;
};

type Entry<T> = {
  /** Чей результат лежит в entry — сравниваем по идентичности загрузчика. */
  loader: unknown;
  attempt: number;
  data: T | null;
  error: ApiRequestError | null;
};

const asError = (error: unknown): ApiRequestError =>
  error instanceof ApiRequestError
    ? error
    : new ApiRequestError(0, 'NETWORK', 'Нет связи с сервером');

/**
 * Загрузка данных с отменой предыдущего запроса и ручным перезапуском.
 *
 * `loader` должен быть стабильным (useCallback у вызывающего) — именно он
 * играет роль ключа запроса. Состояние «идёт загрузка» не выставляется
 * в эффекте, а выводится сравнением ключа: так не возникает каскада
 * лишних рендеров.
 */
export function useAsync<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  options: UseAsyncOptions = {},
): AsyncResult<T> {
  const enabled = options.enabled ?? true;

  const [entry, setEntry] = useState<Entry<T> | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    loader(controller.signal)
      .then((data) => {
        if (!cancelled) {
          setEntry({ loader, attempt, data, error: null });
        }
      })
      .catch((caught: unknown) => {
        if (cancelled || (caught instanceof DOMException && caught.name === 'AbortError')) {
          return;
        }
        setEntry({ loader, attempt, data: null, error: asError(caught) });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [loader, attempt, enabled]);

  const reload = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  const sameLoader = entry !== null && entry.loader === loader;
  const isFresh = sameLoader && entry.attempt === attempt;

  // Пока идёт повтор, показываем прошлые данные, но без прошлой ошибки.
  const data = sameLoader ? entry.data : null;

  return {
    data,
    error: isFresh ? entry.error : null,
    isLoading: enabled && !isFresh,
    isRefreshing: enabled && !isFresh && data !== null,
    reload,
  };
}
