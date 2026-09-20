import { useActiveVkuiLocation, useRouteNavigator } from '@vkontakte/vk-mini-apps-router';
import {
  Avatar,
  Div,
  Group,
  Header,
  Panel,
  PanelHeader,
  PanelSpinner,
  Placeholder,
  SimpleCell,
} from '@vkontakte/vkui';
import { useCallback, type ReactNode } from 'react';

import { api } from '../api/client.js';
import { ErrorState } from '../components/ErrorState.js';
import { UserProfileBody } from '../components/UserProfileBody.js';
import { useAsync } from '../lib/useAsync.js';
import { useSession } from '../lib/SessionContext.js';
import { fullName } from '../lib/format.js';

export function ProfilePanel({ id, view }: { id: string; view: string }): ReactNode {
  const session = useSession();
  const routeNavigator = useRouteNavigator();
  const { view: activeView } = useActiveVkuiLocation();
  const vkUserId = session.user?.vkUserId ?? '';

  const loader = useCallback(
    (signal: AbortSignal) => api.getUser(vkUserId, signal),
    [vkUserId],
  );
  const { data, isLoading, error, reload } = useAsync(loader, {
    enabled: activeView === view && vkUserId !== '',
  });

  if (session.user === null) {
    return (
      <Panel id={id}>
        <PanelHeader>Профиль</PanelHeader>
        {session.isLoading ? (
          <PanelSpinner />
        ) : (
          <Group>
            <Placeholder title="Профиль недоступен">
              Откройте приложение из ВКонтакте, чтобы увидеть свой профиль.
            </Placeholder>
          </Group>
        )}
      </Panel>
    );
  }

  return (
    <Panel id={id}>
      <PanelHeader>Профиль</PanelHeader>

      <Group>
        <SimpleCell
          before={<Avatar size={72} src={session.user.photoUrl ?? undefined} />}
          subtitle={session.user.city ?? 'Город не указан'}
        >
          {fullName(session.user)}
        </SimpleCell>
      </Group>

      {error !== null ? (
        <Group>
          <ErrorState error={error} onRetry={reload} />
        </Group>
      ) : isLoading || data === null ? (
        <PanelSpinner />
      ) : (
        <UserProfileBody
          profile={data}
          onOpenUser={(otherVkUserId) => {
            void routeNavigator.push(`/profile/user/${otherVkUserId}`);
          }}
        />
      )}

      <Group header={<Header size="s">О приложении</Header>}>
        <Div style={{ color: 'var(--vkui--color_text_secondary)' }}>
          Поиск попутчиков — договаривайтесь о поездке напрямую и оставляйте отзывы
          после неё.
        </Div>
      </Group>
    </Panel>
  );
}
