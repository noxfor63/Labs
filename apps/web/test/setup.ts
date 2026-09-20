/**
 * jsdom не реализует часть браузерных API, которые использует VKUI
 * и лента поездок. Ставим минимальные заглушки.
 */
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// globals: false, поэтому авто-очистку react-testing-library
// подключаем руками — иначе DOM копится между тестами.
afterEach(() => {
  cleanup();
});

if (typeof window !== 'undefined') {
  if (window.matchMedia === undefined) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }

  if (!('IntersectionObserver' in window)) {
    class FakeIntersectionObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): [] {
        return [];
      }
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds: readonly number[] = [];
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  }
}
