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
  SimpleCell,
} from '@vkontakte/vkui';
import { useCallback, type ReactNode } from 'react';

import { api } from '../api/client.js';
import { ErrorState } from '../components/ErrorState.js';
import { UserProfileBody } from '../components/UserProfileBody.js';
import { fullName } from '../lib/format.js';
import { useAsync } from '../lib/useAsync.js';
import { buildProfileUrl } from '../vk/bridge.js';

export function UserPanel({ id, view }: { id: string; view: string }): ReactNode {
  const routeNavigator = useRouteNavigator();
  const { view: activeView, panel: activePanel } = useActiveVkuiLocation();
  const params = useParams<'vkUserId'>();
  const vkUserId = params?.vkUserId ?? '';
  const isActive = activeView === view && activePanel === id && vkUserId !== '';

  const loader = useCallback(
    (signal: AbortSignal) => api.getUser(vkUserId, signal),
    [vkUserId],
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
        <SimpleCell
          before={<Avatar size={72} src={data.user.photoUrl ?? undefined} />}
          subtitle={data.user.city ?? 'Город не указан'}
        >
          {fullName(data.user)}
        </SimpleCell>
        <Div>
          <Button
            size="l"
            mode="secondary"
            stretched
            href={buildProfileUrl(data.user.vkUserId)}
            target="_blank"
            rel="noreferrer"
          >
            Открыть страницу ВКонтакте
          </Button>
        </Div>
      </Group>

      <UserProfileBody profile={data} />
    </Panel>
  );
}
