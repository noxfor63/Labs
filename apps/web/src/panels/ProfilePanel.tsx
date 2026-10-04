import { formatPhone, normalizePhone } from '@vk-rideshare/shared';
import { useActiveVkuiLocation, useRouteNavigator } from '@vkontakte/vk-mini-apps-router';
import {
  Avatar,
  Button,
  Div,
  Group,
  Header,
  Panel,
  PanelHeader,
  PanelSpinner,
  Placeholder,
  Subhead,
  Title,
} from '@vkontakte/vkui';
import { useCallback, useState, type ReactNode } from 'react';

import { ApiRequestError, api } from '../api/client.js';
import { ErrorState } from '../components/ErrorState.js';
import { PhoneField } from '../components/PhoneField.js';
import { UserProfileBody } from '../components/UserProfileBody.js';
import { useAsync } from '../lib/useAsync.js';
import { useSession } from '../lib/SessionContext.js';
import { useSnackbar } from '../lib/SnackbarContext.js';
import { fullName } from '../lib/format.js';

export function ProfilePanel({ id, view }: { id: string; view: string }): ReactNode {
  const session = useSession();
  const snackbar = useSnackbar();
  const routeNavigator = useRouteNavigator();
  const { view: activeView } = useActiveVkuiLocation();
  const userId = session.user?.id ?? '';

  const loader = useCallback(
    (signal: AbortSignal) => api.getUser(userId, signal),
    [userId],
  );
  const { data, isLoading, error, reload } = useAsync(loader, {
    enabled: activeView === view && userId !== '',
  });

  const savedPhone = session.user?.phone ?? '';
  const [phone, setPhone] = useState(() => formatPhone(savedPhone));
  const [phoneError, setPhoneError] = useState<string | undefined>(undefined);
  const [isSavingPhone, setIsSavingPhone] = useState(false);

  const normalized = phone.trim() === '' ? null : normalizePhone(phone);
  const isInvalid = phone.trim() !== '' && normalized === null;
  /**
   * Кнопка активна, если номер изменился — или если введена ерунда.
   *
   * Второе условие не для красоты: без него непонятный ввод давал бы
   * normalized === null, сравнение считало бы «ничего не поменялось», и
   * человек смотрел бы на выключенную кнопку без объяснения причины.
   */
  const isPhoneChanged = (normalized ?? '') !== savedPhone || isInvalid;

  const submitPhone = async (): Promise<void> => {
    if (isInvalid) {
      setPhoneError('Укажите мобильный номер в виде +7 999 123-45-67');
      return;
    }
    setPhoneError(undefined);
    setIsSavingPhone(true);
    try {
      await session.savePhone(normalized);
      setPhone(normalized === null ? '' : formatPhone(normalized));
      snackbar.showSuccess(normalized === null ? 'Номер удалён' : 'Номер сохранён');
    } catch (caught) {
      snackbar.showError(
        caught instanceof ApiRequestError ? caught.message : 'Не удалось сохранить номер',
      );
    } finally {
      setIsSavingPhone(false);
    }
  };

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
        <Div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-space-4)' }}>
          <Avatar size={72} src={session.user.photoUrl ?? undefined} />
          <div style={{ minWidth: 0 }}>
            <Title level="2">{fullName(session.user)}</Title>
            <Subhead style={{ color: 'var(--vkui--color_text_secondary)' }}>
              {session.user.city ?? 'Город не указан'}
            </Subhead>
          </div>
        </Div>
      </Group>

      <Group header={<Header size="s">Связь</Header>}>
        <PhoneField
          value={phone}
          error={phoneError}
          onChange={(value) => {
            setPhone(value);
            setPhoneError(undefined);
          }}
        />
        <Div>
          <Button
            size="l"
            stretched
            mode="secondary"
            loading={isSavingPhone}
            disabled={isSavingPhone || !isPhoneChanged}
            onClick={() => {
              void submitPhone();
            }}
          >
            Сохранить номер
          </Button>
        </Div>
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
