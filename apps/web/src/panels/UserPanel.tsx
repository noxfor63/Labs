import { REPORT_TARGET } from '@vk-rideshare/shared';
import { Icon16ReportOutline } from '@vkontakte/icons';
import {
  useActiveVkuiLocation,
  useParams,
  useRouteNavigator,
} from '@vkontakte/vk-mini-apps-router';
import {
  Avatar,
  Button,
  Div,
  Group,
  Panel,
  PanelHeader,
  PanelHeaderBack,
  PanelSpinner,
  Placeholder,
  Subhead,
  Title,
} from '@vkontakte/vkui';
import { useCallback, type ReactNode } from 'react';

import { api } from '../api/client.js';
import { ContactButtons } from '../components/ContactButtons.js';
import { ErrorState } from '../components/ErrorState.js';
import { UserProfileBody } from '../components/UserProfileBody.js';
import { fullName } from '../lib/format.js';
import { useAsync } from '../lib/useAsync.js';
import { useReport } from '../lib/ReportContext.js';
import { useSession } from '../lib/SessionContext.js';

export function UserPanel({ id, view }: { id: string; view: string }): ReactNode {
  const routeNavigator = useRouteNavigator();
  const { view: activeView, panel: activePanel } = useActiveVkuiLocation();
  const params = useParams<'userId'>();
  const userId = params?.userId ?? '';
  const isActive = activeView === view && activePanel === id && userId !== '';
  const report = useReport();
  const session = useSession();

  const loader = useCallback(
    (signal: AbortSignal) => api.getUser(userId, signal),
    [userId],
  );
  const { data, isLoading, error, reload } = useAsync(loader, { enabled: isActive });

  const header = (
    <PanelHeader
      before={
        <PanelHeaderBack
          onClick={() => {
            void routeNavigator.back();
          }}
        />
      }
    >
      Профиль
    </PanelHeader>
  );

  if (isLoading) {
    return (
      <Panel id={id}>
        {header}
        <PanelSpinner />
      </Panel>
    );
  }

  if (error !== null || data === null) {
    return (
      <Panel id={id}>
        {header}
        <Group>
          {error !== null ? (
            <ErrorState error={error} onRetry={reload} />
          ) : (
            <Placeholder title="Профиль не найден" />
          )}
        </Group>
      </Panel>
    );
  }

  return (
    <Panel id={id}>
      {header}

      <Group>
        <Div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-space-4)' }}>
          <Avatar size={72} src={data.user.photoUrl ?? undefined} />
          <div style={{ minWidth: 0 }}>
            <Title level="2">{fullName(data.user)}</Title>
            <Subhead style={{ color: 'var(--vkui--color_text_secondary)' }}>
              {data.user.city ?? 'Город не указан'}
            </Subhead>
          </div>
        </Div>
        <ContactButtons user={data.user} />

        {/*
          Имя, фотография и номер телефона в карточке — тоже то, что
          человек указал сам. Жалоба на профиль нужна в первую очередь
          из-за номера: его видит каждый, кто откроет карточку, и чужой
          номер здесь — это уже чужие персональные данные.
        */}
        {session.user?.id !== data.user.id && (
          <Div>
            <Button
              size="s"
              mode="tertiary"
              appearance="neutral"
              before={<Icon16ReportOutline />}
              style={{ paddingLeft: 0 }}
              onClick={() => {
                report.open({
                  target: REPORT_TARGET.USER,
                  id: data.user.id,
                  title: `Профиль: ${fullName(data.user)}`,
                });
              }}
            >
              Пожаловаться на профиль
            </Button>
          </Div>
        )}
      </Group>

      <UserProfileBody profile={data} />
    </Panel>
  );
}
