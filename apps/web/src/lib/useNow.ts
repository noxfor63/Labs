import { useSyncExternalStore } from 'react';

/**
 * Текущее время как внешний источник данных.
 *
 * Date.now() в теле рендера — нечистый вызов: значение меняется само по себе
 * между рендерами. useSyncExternalStore решает это правильно: снимок
 * обновляется по тику таймера, а рендер только читает его.
 *
 * Точность в минуту здесь достаточна — время нужно лишь чтобы понять,
 * не состоялась ли поездка.
 */
const TICK_MS = 30_000;

let snapshot = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  if (timer === null) {
    timer = setInterval(() => {
      snapshot = Date.now();
      for (const notify of listeners) {
        notify();
      }
    }, TICK_MS);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = (): number => snapshot;

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
