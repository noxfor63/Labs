import { ERROR_CODE, SUPPORT_EMAIL } from '@vk-rideshare/shared';
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
  Button,
  Div,
  Epic,
  Footer,
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
import { useState, type ReactNode } from 'react';

import { getPlatform } from './platform/index.js';
import { ErrorState } from './components/ErrorState.js';
import { PrivacyGate } from './components/PrivacyGate.js';
import { useReport } from './lib/ReportContext.js';
import { useSession } from './lib/SessionContext.js';
import { ReportModal } from './modals/ReportModal.js';
import { ReviewModal } from './modals/ReviewModal.js';
import { CreatePanel } from './panels/CreatePanel.js';
import { ModerationPanel } from './panels/ModerationPanel.js';
import { MyPanel } from './panels/MyPanel.js';
import { ProfilePanel } from './panels/ProfilePanel.js';
import { SearchPanel } from './panels/SearchPanel.js';
import { TripPanel } from './panels/TripPanel.js';
import { UserPanel } from './panels/UserPanel.js';
import { MODAL, PANEL, VIEW } from './routes.js';

/**
 * Иконки нижней панели на 24 вместо штатных 28.
 *
 * Панель — фон, а не содержание: крупные иконки с плотной тенью тянули
 * взгляд вниз и спорили с карточками. Уменьшенные иконки, отсутствие тени
 * (plain) и волосяная линия сверху возвращают ей роль разделителя.
 */
const TAB_ICON_SIZE = 24;

const TABS = [
  {
    view: VIEW.SEARCH,
    path: '/',
    label: 'Поиск',
    icon: <Icon28SearchOutline width={TAB_ICON_SIZE} height={TAB_ICON_SIZE} />,
  },
  {
    view: VIEW.CREATE,
    path: '/create',
    label: 'Создать',
    icon: <Icon28AddCircleOutline width={TAB_ICON_SIZE} height={TAB_ICON_SIZE} />,
  },
  {
    view: VIEW.MY,
    path: '/my',
    label: 'Мои',
    icon: <Icon28ListOutline width={TAB_ICON_SIZE} height={TAB_ICON_SIZE} />,
  },
  {
    view: VIEW.PROFILE,
    path: '/profile',
    label: 'Профиль',
    icon: <Icon28UserCircleOutline width={TAB_ICON_SIZE} height={TAB_ICON_SIZE} />,
  },
] as const;

export function App(): ReactNode {
  const { view: activeView = VIEW.SEARCH, panel: activePanel, modal: activeModal } =
    useActiveVkuiLocation();
  // Снимок на момент запуска: подсказка читает адрес и хранилище,
  // поэтому вызывать её прямо в теле рендера нельзя — значение менялось
  // бы само по себе.
  const [launchHint] = useState<string>(() => getPlatform().launchHint());
  const routeNavigator = useRouteNavigator();
  const routerPopout = usePopout();
  const session = useSession();
  const report = useReport();

  /*
   * Два источника открытой модалки: маршрут (отзыв) и контекст (жалоба).
   * Жалоба — поверх: её открывают с уже открытого экрана, и маршрут при
   * этом не меняется.
   */
  const isReportOpen = report.subject !== null;
  const modals = (
    <ModalRoot
      activeModal={isReportOpen ? MODAL.REPORT : activeModal ?? null}
      onClose={() => {
        if (isReportOpen) {
          report.close();
          return;
        }
        void routeNavigator.hideModal();
      }}
    >
      <ReviewModal id={MODAL.REVIEW} />
      <ReportModal id={MODAL.REPORT} />
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

  /*
   * Согласие — раньше всего остального, что видно человеку. Проверка стоит
   * до ошибки намеренно: пока согласия нет, сессии тоже нет, и показывать
   * «не удалось подтвердить запуск» было бы неправдой.
   */
  if (session.needsPrivacyConsent) {
    return <PrivacyGate />;
  }

  /*
   * Закрытый доступ — отдельный экран, а не «не получилось загрузить».
   * Человек должен понимать, что произошло и куда писать, если считает
   * решение ошибкой: без этого блокировка выглядит как поломка, и к нам
   * придут через отзывы в магазине приложений, а не на почту.
   */
  if (session.error !== null && session.error.code === ERROR_CODE.ACCESS_BLOCKED) {
    return (
      <SplitLayout center>
        <SplitCol width="100%" maxWidth={560} stretchedOnMobile autoSpaced>
          <View activePanel="blocked">
            <Panel id="blocked">
              <PanelHeader>По пути</PanelHeader>
              <Group>
                <Placeholder title="Доступ закрыт">{session.error.message}</Placeholder>
                <Div>
                  <Button
                    size="l"
                    stretched
                    mode="secondary"
                    href={`mailto:${SUPPORT_EMAIL}`}
                  >
                    Написать нам
                  </Button>
                </Div>
                <Footer>Если считаете решение ошибкой — напишите, разберёмся.</Footer>
              </Group>
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
                  <>
                    <Placeholder title="Не удалось подтвердить запуск">
                      {session.error.message}
                    </Placeholder>
                    <Div>
                      <Button size="l" stretched onClick={session.reload}>
                        Повторить
                      </Button>
                    </Div>
                    {/*
                      Техническая строка внизу: без неё «не подтвердился запуск»
                      выглядит одинаково и когда параметров нет в адресе, и когда
                      они есть, но протухли, — а чинится это по-разному.
                    */}
                    <Footer>{launchHint}</Footer>
                  </>
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
          // Вид панели — в styles/app.css: высота, граница, подписи, акцент.
          tabbar={
            <Tabbar plain>
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
            <ModerationPanel id={PANEL.MODERATION} view={VIEW.PROFILE} />
          </View>
        </Epic>
      </SplitCol>
    </SplitLayout>
  );
}
