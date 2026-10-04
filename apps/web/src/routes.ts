import { createHashRouter, type RouteWithoutRoot } from '@vkontakte/vk-mini-apps-router';

/**
 * Разделы приложения — отдельные view, чтобы у каждой вкладки была своя
 * история и аппаратная кнопка «назад» возвращала туда, откуда ушли.
 *
 * Панель «Поездка» и «Профиль другого человека» доступны из двух разделов,
 * поэтому у них по два маршрута: компонент один, история — своя на вкладку.
 */
export const VIEW = {
  SEARCH: 'search',
  CREATE: 'create',
  MY: 'my',
  PROFILE: 'profile',
} as const;

export const PANEL = {
  SEARCH: 'search',
  TRIP: 'trip',
  CREATE: 'create',
  MY: 'my',
  PROFILE: 'profile',
  USER: 'user',
} as const;

export const MODAL = {
  REVIEW: 'review',
} as const;

export const routes: RouteWithoutRoot[] = [
  { path: '/', view: VIEW.SEARCH, panel: PANEL.SEARCH },
  { path: '/trip/:tripId', view: VIEW.SEARCH, panel: PANEL.TRIP },
  { path: '/user/:userId', view: VIEW.SEARCH, panel: PANEL.USER },

  { path: '/create', view: VIEW.CREATE, panel: PANEL.CREATE },

  { path: '/my', view: VIEW.MY, panel: PANEL.MY },
  { path: '/my/trip/:tripId', view: VIEW.MY, panel: PANEL.TRIP },
  { path: '/my/user/:userId', view: VIEW.MY, panel: PANEL.USER },
  { path: '/my/review/:tripId', view: VIEW.MY, panel: PANEL.MY, modal: MODAL.REVIEW },

  { path: '/profile', view: VIEW.PROFILE, panel: PANEL.PROFILE },
  { path: '/profile/user/:userId', view: VIEW.PROFILE, panel: PANEL.USER },
];

export const router = createHashRouter(routes);

/**
 * Префикс текущего раздела: ссылки на поездку и профиль должны оставаться
 * внутри той вкладки, из которой по ним перешли.
 */
export function sectionPrefix(view: string | undefined): string {
  switch (view) {
    case VIEW.MY:
      return '/my';
    case VIEW.PROFILE:
      return '/profile';
    default:
      return '';
  }
}
