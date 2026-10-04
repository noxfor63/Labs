import { RouterProvider } from '@vkontakte/vk-mini-apps-router';
import {
  AdaptivityProvider,
  AppRoot,
  ConfigProvider,
  type ColorSchemeType,
} from '@vkontakte/vkui';
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import '@vkontakte/vkui/dist/vkui.css';
// Своя визуальная система — после VKUI, чтобы переопределения сработали.
import './styles/app.css';

import { App } from './App.js';
import { SessionProvider } from './lib/SessionContext.js';
import { SnackbarProvider } from './lib/SnackbarContext.js';
import { getPlatform } from './platform/index.js';
import { router } from './routes.js';

function Root(): ReactNode {
  // Тему берёт площадка: у ВКонтакте это событие VKWebAppUpdateConfig,
  // у Telegram — параметры запуска и событие themeChanged.
  const [colorScheme, setColorScheme] = useState<ColorSchemeType>('light');

  useEffect(() => {
    const platform = getPlatform();
    const unsubscribe = platform.subscribeColorScheme(setColorScheme);
    void platform.init();
    return unsubscribe;
  }, []);

  return (
    <ConfigProvider colorScheme={colorScheme}>
      <AdaptivityProvider>
        <AppRoot>
          <RouterProvider router={router}>
            <SnackbarProvider>
              <SessionProvider>
                <App />
              </SessionProvider>
            </SnackbarProvider>
          </RouterProvider>
        </AppRoot>
      </AdaptivityProvider>
    </ConfigProvider>
  );
}

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Не найден контейнер #root');
}

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
