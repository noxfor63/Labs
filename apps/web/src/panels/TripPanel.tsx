import type { TripRequestDto } from '@vk-rideshare/shared';
import {
  Icon20CarOutline,
  Icon20MoneyCircleOutline,
  Icon20PlaceOutline,
  Icon20UsersOutline,
} from '@vkontakte/icons';
import { useActiveVkuiLocation, useParams, useRouteNavigator } from '@vkontakte/vk-mini-apps-router';
import {
  Avatar,
  Button,
  Div,
  Footer,
  FormItem,
  Group,
  Header,
  MiniInfoCell,
  Panel,
  PanelHeader,
  PanelHeaderBack,
  PanelSpinner,
  Placeholder,
  SimpleCell,
  Spacing,
  Text,
  Textarea,
  Title,
} from '@vkontakte/vkui';
import { useCallback, useState, type ReactNode } from 'react';

import { ApiRequestError, api } from '../api/client.js';
import { ErrorState } from '../components/ErrorState.js';
import { RatingBadge } from '../components/RatingBadge.js';
import {
  formatDateTime,
  formatPrice,
  formatSeats,
  fullName,
} from '../lib/format.js';
import { useAsync } from '../lib/useAsync.js';
import { useNow } from '../lib/useNow.js';
import { useSnackbar } from '../lib/SnackbarContext.js';
import { sectionPrefix } from '../routes.js';
import { buildProfileUrl } from '../vk/bridge.js';

const REQUEST_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Ждёт ответа',
  ACCEPTED: 'Принят',
  DECLINED: 'Отклонён',
  CANCELLED: 'Отменён',
};

export function TripPanel({ id, view }: { id: string; view: string }): ReactNode {
  const routeNavigator = useRouteNavigator();
  const { view: activeView, panel: activePanel } = useActiveVkuiLocation();
  const params = useParams<'tripId'>();
  const tripId = params?.tripId ?? '';
  const prefix = sectionPrefix(view);
  // Панель живёт сразу в нескольких View. Грузим только ту копию,
  // которая действительно открыта, и только с непустым id.
  const isActive = activeView === view && activePanel === id && tripId !== '';
  const snackbar = useSnackbar();
  const now = useNow();

  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);

  const loader = useCallback(
    (signal: AbortSignal) => api.getTrip(tripId, signal),
    [tripId],
  );
  const {
    data: trip,
    isLoading,
    error,
    reload,
  } = useAsync(loader, { enabled: isActive });

  const respond = async (): Promise<void> => {
    setIsSending(true);
    try {
      await api.respond(tripId, message.trim() === '' ? null : message.trim());
      setMessage('');
      snackbar.showSuccess('Отклик отправлен');
      reload();
    } catch (caught) {
      snackbar.showError(
        caught instanceof ApiRequestError ? caught.message : 'Не удалось отправить отклик',
      );
    } finally {
      setIsSending(false);
    }
  };

  const decide = async (request: TripRequestDto, status: 'ACCEPTED' | 'DECLINED'): Promise<void> => {
    setBusyRequestId(request.id);
    try {
      await api.patchRequest(request.id, status);
      snackbar.showSuccess(status === 'ACCEPTED' ? 'Отклик принят' : 'Отклик отклонён');
      reload();
    } catch (caught) {
      snackbar.showError(
        caught instanceof ApiRequestError ? caught.message : 'Не удалось обработать отклик',
      );
    } finally {
      setBusyRequestId(null);
    }
  };

  const changeStatus = async (status: 'COMPLETED' | 'CANCELLED'): Promise<void> => {
    try {
      await api.patchTrip(tripId, status);
      snackbar.showSuccess(status === 'COMPLETED' ? 'Поездка завершена' : 'Поездка отменена');
      reload();
    } catch (caught) {
      snackbar.showError(
        caught instanceof ApiRequestError ? caught.message : 'Не удалось изменить поездку',
      );
    }
  };

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
      Поездка
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

  if (error !== null || trip === null) {
    return (
      <Panel id={id}>
        {header}
        <Group>
          {error !== null ? (
            <ErrorState error={error} onRetry={reload} />
          ) : (
            <Placeholder title="Поездка не найдена" />
          )}
        </Group>
      </Panel>
    );
  }

  const isPast = new Date(trip.departAt).getTime() <= now;
  const canRespond =
    !trip.isAuthor &&
    trip.status === 'ACTIVE' &&
    !isPast &&
    trip.seatsLeft > 0 &&
    trip.myRequest === null;

  return (
    <Panel id={id}>
      {header}

      <Group>
        <Div>
          <Title level="2">
            {trip.fromCity} → {trip.toCity}
          </Title>
          <Spacing size={8} />
          <Text style={{ color: 'var(--vkui--color_text_secondary)' }}>
            {formatDateTime(trip.departAt)}
          </Text>
        </Div>

        {(trip.fromPoint !== null || trip.toPoint !== null) && (
          <MiniInfoCell before={<Icon20PlaceOutline />} textWrap="full">
            {[
              trip.fromPoint === null ? null : `Сбор: ${trip.fromPoint}`,
              trip.toPoint === null ? null : `Высадка: ${trip.toPoint}`,
            ]
              .filter((line) => line !== null)
              .join(' · ')}
          </MiniInfoCell>
        )}

        <MiniInfoCell before={<Icon20MoneyCircleOutline />}>
          {formatPrice(trip.priceRub)}
        </MiniInfoCell>

        <MiniInfoCell before={<Icon20UsersOutline />}>
          {trip.seatsLeft > 0
            ? `Свободно ${formatSeats(trip.seatsLeft)} из ${trip.seatsTotal}`
            : `Мест нет · всего ${formatSeats(trip.seatsTotal)}`}
        </MiniInfoCell>

        <MiniInfoCell before={<Icon20CarOutline />}>
          {trip.role === 'DRIVER'
            ? trip.carModel ?? 'Автор за рулём'
            : 'Автор ищет, кто его подвезёт'}
        </MiniInfoCell>

        {trip.comment !== null && (
          <Div>
            <Text>{trip.comment}</Text>
          </Div>
        )}

        {trip.status !== 'ACTIVE' && (
          <Footer>
            {trip.status === 'COMPLETED' ? 'Поездка завершена' : 'Поездка отменена'}
          </Footer>
        )}
      </Group>

      <Group header={<Header size="s">Автор</Header>}>
        <SimpleCell
          before={<Avatar size={48} src={trip.author.photoUrl ?? undefined} />}
          subtitle={
            <RatingBadge
              ratingAvg={trip.author.ratingAvg}
              ratingCount={trip.author.ratingCount}
            />
          }
          onClick={() => {
            void routeNavigator.push(`${prefix}/user/${trip.author.vkUserId}`);
          }}
        >
          {fullName(trip.author)}
        </SimpleCell>

        {!trip.isAuthor && (
          <Div>
            {/*
              Подтверждённого метода VK Bridge для открытия диалога нет,
              поэтому ведём на профиль — диалог открывается оттуда.
            */}
            <Button
              size="l"
              mode="secondary"
              stretched
              href={buildProfileUrl(trip.author.vkUserId)}
              target="_blank"
              rel="noreferrer"
            >
              Написать во ВКонтакте
            </Button>
          </Div>
        )}
      </Group>

      {trip.isAuthor ? (
        <Group header={<Header size="s">Отклики</Header>}>
          {trip.requests.length === 0 ? (
            <Footer>Пока никто не откликнулся</Footer>
          ) : (
            trip.requests.map((request) => (
              <SimpleCell
                key={request.id}
                multiline
                before={<Avatar size={40} src={request.user.photoUrl ?? undefined} />}
                subtitle={
                  request.message ?? REQUEST_STATUS_LABEL[request.status] ?? request.status
                }
                after={
                  request.status === 'PENDING' && trip.status === 'ACTIVE' ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button
                        size="s"
                        loading={busyRequestId === request.id}
                        disabled={busyRequestId !== null || trip.seatsLeft === 0}
                        onClick={() => {
                          void decide(request, 'ACCEPTED');
                        }}
                      >
                        Принять
                      </Button>
                      <Button
                        size="s"
                        mode="secondary"
                        appearance="negative"
                        loading={busyRequestId === request.id}
                        disabled={busyRequestId !== null}
                        onClick={() => {
                          void decide(request, 'DECLINED');
                        }}
                      >
                        Отклонить
                      </Button>
                    </div>
                  ) : (
                    <Text style={{ color: 'var(--vkui--color_text_secondary)' }}>
                      {REQUEST_STATUS_LABEL[request.status] ?? request.status}
                    </Text>
                  )
                }
                onClick={() => {
                  void routeNavigator.push(`${prefix}/user/${request.user.vkUserId}`);
                }}
              >
                {fullName(request.user)}
              </SimpleCell>
            ))
          )}

          {trip.status === 'ACTIVE' && (
            <Div style={{ display: 'flex', gap: 8 }}>
              <Button
                size="l"
                stretched
                mode="secondary"
                onClick={() => {
                  void changeStatus('COMPLETED');
                }}
              >
                Завершить
              </Button>
              <Button
                size="l"
                stretched
                mode="secondary"
                appearance="negative"
                onClick={() => {
                  void changeStatus('CANCELLED');
                }}
              >
                Отменить
              </Button>
            </Div>
          )}
        </Group>
      ) : (
        <Group header={<Header size="s">Ваш отклик</Header>}>
          {trip.myRequest !== null ? (
            <Footer>
              {`Вы откликнулись · ${REQUEST_STATUS_LABEL[trip.myRequest.status] ?? trip.myRequest.status}`}
            </Footer>
          ) : canRespond ? (
            <>
              <FormItem top="Сообщение автору (необязательно)">
                <Textarea
                  value={message}
                  maxLength={500}
                  placeholder="Здравствуйте! Есть свободное место?"
                  onChange={(event) => {
                    setMessage(event.target.value);
                  }}
                />
              </FormItem>
              <Div>
                <Button
                  size="l"
                  stretched
                  loading={isSending}
                  disabled={isSending}
                  onClick={() => {
                    void respond();
                  }}
                >
                  Откликнуться
                </Button>
              </Div>
            </>
          ) : (
            <Footer>
              {trip.status !== 'ACTIVE'
                ? 'Поездка больше не активна'
                : isPast
                  ? 'Поездка уже состоялась'
                  : 'Свободных мест не осталось'}
            </Footer>
          )}
        </Group>
      )}
    </Panel>
  );
}
