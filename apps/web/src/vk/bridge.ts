/**
 * Обёртка над VK Bridge.
 *
 * Здесь используются только методы, наличие и сигнатура которых
 * подтверждены типами пакета @vkontakte/vk-bridge:
 *   • VKWebAppInit
 *   • VKWebAppGetUserInfo → UserInfo
 *   • событие VKWebAppUpdateConfig → ParentConfigData { appearance, scheme }
 *
 * Метода «открыть диалог с пользователем» в пакете нет, поэтому кнопка
 * «Написать» ведёт на страницу профиля — см. buildProfileUrl ниже.
 */
import bridge, { type ParentConfigData, type UserInfo } from '@vkontakte/vk-bridge';
import type { ColorSchemeType } from '@vkontakte/vkui';

export type VkProfile = {
  vkUserId: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  city: string | null;
};

/**
 * Вне фрейма ВКонтакте вызовы моста не отклоняются, а просто никогда не
 * отвечают: сообщение уходит в родительское окно, которого нет. Поэтому
 * каждый вызов ограничен по времени, а перед ним проверяется isEmbedded().
 */
const BRIDGE_TIMEOUT_MS = 3_000;

function withTimeout<T>(promise: Promise<T>): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(null);
    }, BRIDGE_TIMEOUT_MS);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

/** Запущены ли мы внутри клиента ВКонтакте. */
export function isInsideVk(): boolean {
  try {
    return bridge.isEmbedded();
  } catch {
    return false;
  }
}

export async function initBridge(): Promise<void> {
  if (!isInsideVk()) {
    return;
  }
  await withTimeout(bridge.send('VKWebAppInit'));
}

export async function fetchVkProfile(): Promise<VkProfile | null> {
  if (!isInsideVk()) {
    return null;
  }

  const info = await withTimeout<UserInfo>(bridge.send('VKWebAppGetUserInfo'));
  if (info === null) {
    return null;
  }

  return {
    vkUserId: String(info.id),
    firstName: info.first_name,
    lastName: info.last_name,
    photoUrl: info.photo_200 !== '' ? info.photo_200 : null,
    city: info.city?.title ?? null,
  };
}

function toColorScheme(appearance: ParentConfigData['appearance']): ColorSchemeType {
  return appearance === 'dark' ? 'dark' : 'light';
}

/**
 * Подписка на смену оформления в клиенте ВКонтакте.
 * Возвращает функцию отписки.
 */
export function subscribeColorScheme(
  onChange: (scheme: ColorSchemeType) => void,
): () => void {
  const listener = (event: Parameters<Parameters<typeof bridge.subscribe>[0]>[0]): void => {
    const detail = event.detail;
    if (detail.type !== 'VKWebAppUpdateConfig') {
      return;
    }
    const data = detail.data as ParentConfigData;
    onChange(toColorScheme(data.appearance));
  };

  if (!isInsideVk()) {
    // Вне ВКонтакте ориентируемся на системную тему браузера — так
    // локальная разработка выглядит так же, как настоящий запуск.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = (): void => {
      onChange(media.matches ? 'dark' : 'light');
    };
    sync();
    media.addEventListener('change', sync);
    return () => {
      media.removeEventListener('change', sync);
    };
  }

  bridge.subscribe(listener);
  return () => {
    bridge.unsubscribe(listener);
  };
}

/**
 * Ссылка на профиль ВКонтакте.
 *
 * Подтверждённого способа открыть диалог из мини-приложения в API нет,
 * поэтому кнопка «Написать» ведёт на профиль — оттуда диалог открывается
 * штатными средствами клиента.
 */
export function buildProfileUrl(vkUserId: string): string {
  return `https://vk.com/id${vkUserId}`;
}
