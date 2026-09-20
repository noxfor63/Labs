import type { TripListQuery, TripSummary } from '@vk-rideshare/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiRequestError, api } from '../api/client.js';

export type TripFeed = {
  items: TripSummary[];
  /** Первая загрузка или смена фильтров — показываем скелетоны. */
  isLoading: boolean;
  isLoadingMore: boolean;
  error: ApiRequestError | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
};

type FeedState = {
  /** Ключ фильтров, которым получены эти items. */
  key: string;
  attempt: number;
  items: TripSummary[];
  cursor: string | null;
  error: ApiRequestError | null;
  isLoadingMore: boolean;
};

const asError = (error: unknown): ApiRequestError =>
  error instanceof ApiRequestError
    ? error
    : new ApiRequestError(0, 'NETWORK', 'Нет связи с сервером');

/**
 * Лента поездок с курсорной подгрузкой.
 *
 * Ключ фильтров — сериализованный объект. При его смене лента сбрасывается,
 * а старый запрос отменяется: иначе ответ по прошлым фильтрам может прийти
 * последним и перезаписать актуальный.
 */
export function useTripFeed(filters: TripListQuery): TripFeed {
  const key = JSON.stringify(filters);
  // Стабильная копия фильтров: пересобирается только вместе с ключом,
  // поэтому её можно честно держать в зависимостях эффекта.
  const stableFilters = useMemo(() => JSON.parse(key) as TripListQuery, [key]);

  const [state, setState] = useState<FeedState | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    api
      .listTrips(stableFilters, controller.signal)
      .then((page) => {
        if (cancelled) {
          return;
        }
        setState({
          key,
          attempt,
          items: page.items,
          cursor: page.nextCursor,
          error: null,
          isLoadingMore: false,
        });
      })
      .catch((caught: unknown) => {
        if (cancelled || (caught instanceof DOMException && caught.name === 'AbortError')) {
          return;
        }
        setState({
          key,
          attempt,
          items: [],
          cursor: null,
          error: asError(caught),
          isLoadingMore: false,
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key, stableFilters, attempt]);

  const isFresh = state !== null && state.key === key && state.attempt === attempt;
  const cursor = isFresh ? state.cursor : null;
  const isLoadingMore = isFresh ? state.isLoadingMore : false;

  const loadMore = useCallback(() => {
    if (cursor === null || isLoadingMore) {
      return;
    }

    setState((previous) =>
      previous === null ? previous : { ...previous, isLoadingMore: true },
    );

    api
      .listTrips({ ...stableFilters, cursor })
      .then((page) => {
        setState((previous) => {
          // Пока грузилась страница, фильтры могли смениться — тогда бросаем.
          if (previous === null || previous.key !== key || previous.attempt !== attempt) {
            return previous;
          }
          const known = new Set(previous.items.map((trip) => trip.id));
          return {
            ...previous,
            items: [...previous.items, ...page.items.filter((trip) => !known.has(trip.id))],
            cursor: page.nextCursor,
            isLoadingMore: false,
          };
        });
      })
      .catch((caught: unknown) => {
        setState((previous) =>
          previous === null
            ? previous
            : { ...previous, error: asError(caught), isLoadingMore: false },
        );
      });
  }, [cursor, isLoadingMore, stableFilters, key, attempt]);

  const reload = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  return {
    items: isFresh ? state.items : [],
    isLoading: !isFresh,
    isLoadingMore,
    error: isFresh ? state.error : null,
    hasMore: cursor !== null,
    loadMore,
    reload,
  };
}
