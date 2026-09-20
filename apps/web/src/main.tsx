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

import { App } from './App.js';
import { SessionProvider } from './lib/SessionContext.js';
import { SnackbarProvider } from './lib/SnackbarContext.js';
import { router } from './routes.js';
import { initBridge, subscribeColorScheme } from './vk/bridge.js';

function Root(): ReactNode {
  // Тему берём из ВКонтакте: событие VKWebAppUpdateConfig приходит и при
  // запуске, и при смене оформления в клиенте.
  const [colorScheme, setColorScheme] = useState<ColorSchemeType>('light');

  useEffect(() => {
    const unsubscribe = subscribeColorScheme(setColorScheme);
    void initBridge();
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
