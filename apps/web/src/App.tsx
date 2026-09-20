import {
  Icon28AddCircleOutline,
  Icon28ListOutline,
  Icon28SearchOutline,
  Icon28UserCircleOutline,
} from '@vkontakte/icons';
import {
  useActiveVkuiLocation,
  usePopout,
  useRouteNavigator,
} from '@vkontakte/vk-mini-apps-router';
import {
  Epic,
  Group,
  ModalRoot,
  Panel,
  PanelHeader,
  PanelSpinner,
  Placeholder,
  SplitCol,
  SplitLayout,
  Tabbar,
  TabbarItem,
  View,
} from '@vkontakte/vkui';
import type { ReactNode } from 'react';

import { ErrorState } from './components/ErrorState.js';
import { useSession } from './lib/SessionContext.js';
import { ReviewModal } from './modals/ReviewModal.js';
import { CreatePanel } from './panels/CreatePanel.js';
import { MyPanel } from './panels/MyPanel.js';
import { ProfilePanel } from './panels/ProfilePanel.js';
import { SearchPanel } from './panels/SearchPanel.js';
import { TripPanel } from './panels/TripPanel.js';
import { UserPanel } from './panels/UserPanel.js';
import { MODAL, PANEL, VIEW } from './routes.js';

const TABS = [
  { view: VIEW.SEARCH, path: '/', label: 'Поиск', icon: <Icon28SearchOutline /> },
  { view: VIEW.CREATE, path: '/create', label: 'Создать', icon: <Icon28AddCircleOutline /> },
  { view: VIEW.MY, path: '/my', label: 'Мои', icon: <Icon28ListOutline /> },
  { view: VIEW.PROFILE, path: '/profile', label: 'Профиль', icon: <Icon28UserCircleOutline /> },
] as const;

export function App(): ReactNode {
  const { view: activeView = VIEW.SEARCH, panel: activePanel, modal: activeModal } =
    useActiveVkuiLocation();
  const routeNavigator = useRouteNavigator();
  const routerPopout = usePopout();
  const session = useSession();

  const modals = (
    <ModalRoot
      activeModal={activeModal ?? null}
      onClose={() => {
        void routeNavigator.hideModal();
      }}
    >
      <ReviewModal id={MODAL.REVIEW} />
    </ModalRoot>
  );

  // Пока сессия не подтверждена бэкендом, показывать ленту нечем:
  // любой запрос всё равно вернёт 401.
  if (session.isLoading) {
    return (
      <SplitLayout center>
        <SplitCol width="100%" maxWidth={560} stretchedOnMobile autoSpaced>
          <View activePanel="loading">
            <Panel id="loading">
              <PanelHeader>Поиск попутчиков</PanelHeader>
              <PanelSpinner size="l">Загружаем профиль…</PanelSpinner>
            </Panel>
          </View>
        </SplitCol>
      </SplitLayout>
    );
  }

  if (session.error !== null) {
    return (
      <SplitLayout center>
        <SplitCol width="100%" maxWidth={560} stretchedOnMobile autoSpaced>
          <View activePanel="error">
            <Panel id="error">
              <PanelHeader>Поиск попутчиков</PanelHeader>
              <Group>
                {session.error.status === 401 ? (
                  <Placeholder title="Не удалось подтвердить запуск">
                    Откройте приложение из ВКонтакте. Для локальной разработки задайте
                    VK_MOCK_LAUNCH_PARAMS в .env.
                  </Placeholder>
                ) : (
                  <ErrorState error={session.error} onRetry={session.reload} />
                )}
              </Group>
            </Panel>
          </View>
        </SplitCol>
      </SplitLayout>
    );
  }

  return (
    <SplitLayout popout={routerPopout} modal={modals} center>
      <SplitCol width="100%" maxWidth={560} stretchedOnMobile autoSpaced>
        <Epic
          activeStory={activeView}
          tabbar={
            <Tabbar>
              {TABS.map((tab) => (
                <TabbarItem
                  key={tab.view}
                  selected={activeView === tab.view}
                  label={tab.label}
                  onClick={() => {
                    void routeNavigator.push(tab.path);
                  }}
                >
                  {tab.icon}
                </TabbarItem>
              ))}
            </Tabbar>
          }
        >
          <View id={VIEW.SEARCH} activePanel={activePanel ?? PANEL.SEARCH}>
            <SearchPanel id={PANEL.SEARCH} />
            <TripPanel id={PANEL.TRIP} view={VIEW.SEARCH} />
            <UserPanel id={PANEL.USER} view={VIEW.SEARCH} />
          </View>

          <View id={VIEW.CREATE} activePanel={PANEL.CREATE}>
            <CreatePanel id={PANEL.CREATE} />
          </View>

          <View id={VIEW.MY} activePanel={activePanel ?? PANEL.MY}>
            <MyPanel id={PANEL.MY} view={VIEW.MY} />
            <TripPanel id={PANEL.TRIP} view={VIEW.MY} />
            <UserPanel id={PANEL.USER} view={VIEW.MY} />
          </View>

          <View id={VIEW.PROFILE} activePanel={activePanel ?? PANEL.PROFILE}>
            <ProfilePanel id={PANEL.PROFILE} view={VIEW.PROFILE} />
            <UserPanel id={PANEL.USER} view={VIEW.PROFILE} />
          </View>
        </Epic>
      </SplitCol>
    </SplitLayout>
  );
}
