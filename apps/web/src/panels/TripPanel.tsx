import { REPORT_TARGET, isUnreachable, type TripRequestDto } from '@vk-rideshare/shared';
import {
  Icon16ReportOutline,
  Icon20CarOutline,
  Icon20PhoneOutline,
  Icon20PlaceOutline,
} from '@vkontakte/icons';
import { useActiveVkuiLocation, useParams, useRouteNavigator } from '@vkontakte/vk-mini-apps-router';
import {
  Avatar,
  Button,
  Caption,
  Div,
  Footer,
  FormItem,
  Group,
  Header,
  Headline,
  MiniInfoCell,
  Panel,
  PanelHeader,
  PanelHeaderBack,
  PanelSpinner,
  Placeholder,
  SimpleCell,
  Spacing,
  Subhead,
  Text,
  Textarea,
  Title,
} from '@vkontakte/vkui';
import { useCallback, useState, type ReactNode } from 'react';

import { ApiRequestError, api } from '../api/client.js';
import { ContactButtons } from '../components/ContactButtons.js';
import { ErrorState } from '../components/ErrorState.js';
import { RatingBadge } from '../components/RatingBadge.js';
import {
  dayTimeSeparator,
  formatDayLabel,
  formatPrice,
  formatTime,
  fullName,
} from '../lib/format.js';
import { useAsync } from '../lib/useAsync.js';
import { useNow } from '../lib/useNow.js';
import { useReport } from '../lib/ReportContext.js';
import { useSession } from '../lib/SessionContext.js';
import { useSnackbar } from '../lib/SnackbarContext.js';
import { sectionPrefix } from '../routes.js';

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
  const report = useReport();
  const session = useSession();
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

  const dayLabel = formatDayLabel(trip.departAt, new Date(now));
  const isPast = new Date(trip.departAt).getTime() <= now;
  /** Своя живая поездка без номера в профиле — тот случай, про который стоит напомнить. */
  const needsPhone =
    trip.isAuthor &&
    trip.status === 'ACTIVE' &&
    (trip.author.phone === null || trip.author.phone === '');
  /*
   * Отклик — это заявка «позвоните мне», и звонить должно быть куда.
   * Для пришедшего из ВКонтакте запасной путь есть всегда: автор откроет
   * его страницу. Для пришедшего из Telegram — нет.
   */
  const viewerUnreachable = session.user !== null && isUnreachable(session.user);
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
        <Div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-space-4)' }}>
          <div>
            <Title level="2">
              {trip.fromCity} → {trip.toCity}
            </Title>
            <Spacing size={6} />
            <Subhead style={{ color: 'var(--vkui--color_text_secondary)' }}>
              {`${dayLabel}${dayTimeSeparator(dayLabel)}`}
              <span style={{ fontWeight: 600, color: 'var(--vkui--color_text_primary)' }}>
                {formatTime(trip.departAt)}
              </span>
            </Subhead>
          </div>

          {/* Два числа, ради которых сюда и заходят. */}
          <div style={{ display: 'flex', gap: 'var(--app-space-2)' }}>
            <div className="app-tile">
              <Caption level="1" weight="2" className="app-field-label">
                Цена
              </Caption>
              <Headline
                level="1"
                weight="1"
                style={{ color: 'var(--app-accent)' }}
              >
                {formatPrice(trip.priceRub)}
              </Headline>
            </div>

            <div className="app-tile">
              <Caption level="1" weight="2" className="app-field-label">
                Места
              </Caption>
              <Headline
                level="1"
                weight="1"
                style={
                  trip.seatsLeft === 0
                    ? { color: 'var(--vkui--color_text_negative)' }
                    : undefined
                }
              >
                {trip.seatsLeft > 0 ? `${trip.seatsLeft} из ${trip.seatsTotal}` : 'Мест нет'}
              </Headline>
            </div>
          </div>
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

        {/*
          Жалоба на объявление: точки, машина и комментарий — текст,
          написанный человеком, и его никто не проверял до публикации.
          Кнопка намеренно серая и в конце карточки: это выход на крайний
          случай, а не одно из обычных действий.
        */}
        {!trip.isAuthor && (
          <Div>
            <Button
              size="s"
              mode="tertiary"
              appearance="neutral"
              before={<Icon16ReportOutline />}
              style={{ paddingLeft: 0 }}
              onClick={() => {
                report.open({
                  target: REPORT_TARGET.TRIP,
                  id: trip.id,
                  title: `Объявление ${trip.fromCity} → ${trip.toCity}`,
                });
              }}
            >
              Пожаловаться на объявление
            </Button>
          </Div>
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
            void routeNavigator.push(`${prefix}/user/${trip.author.id}`);
          }}
        >
          {fullName(trip.author)}
        </SimpleCell>

        {trip.isAuthor ? (
          needsPhone && (
            <Div>
              {/*
                Автор видит это на своей же поездке: там, где у чужой стоят
                кнопки связи, у своей было пустое место, и про номер просто
                забывали. Телефон берём из trip.author — на своей поездке
                это и есть текущий пользователь.
              */}
              <div
                className="app-tile"
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-space-3)' }}
              >
                <Icon20PhoneOutline style={{ color: 'var(--vkui--color_icon_secondary)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Subhead weight="2">Добавьте номер телефона</Subhead>
                  <Caption level="1" style={{ color: 'var(--vkui--color_text_secondary)' }}>
                    Без него попутчики не смогут вам позвонить
                  </Caption>
                </div>
                <Button
                  size="s"
                  mode="secondary"
                  onClick={() => {
                    void routeNavigator.push('/profile');
                  }}
                >
                  Добавить
                </Button>
              </div>
            </Div>
          )
        ) : (
          <ContactButtons user={trip.author} />
        )}
      </Group>

      {trip.isAuthor ? (
        <Group header={<Header size="s">Отклики</Header>}>
          {trip.requests.length === 0 ? (
            <Footer>Пока никто не откликнулся</Footer>
          ) : (
            /* Нажатие по строке открывает карточку человека — там профиль
               ВКонтакте и звонок. Дублировать кнопки в списке незачем:
               на узком экране они вытесняют «Принять» и «Отклонить». */
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
                  void routeNavigator.push(`${prefix}/user/${request.user.id}`);
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
          ) : canRespond && viewerUnreachable ? (
            <Div>
              <div
                className="app-tile"
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-space-3)' }}
              >
                <Icon20PhoneOutline style={{ color: 'var(--vkui--color_icon_secondary)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Subhead weight="2">Сначала укажите номер телефона</Subhead>
                  <Caption level="1" style={{ color: 'var(--vkui--color_text_secondary)' }}>
                    Автор поездки перезвонит вам — другого способа связаться у него нет
                  </Caption>
                </div>
                <Button
                  size="s"
                  mode="secondary"
                  onClick={() => {
                    void routeNavigator.push('/profile');
                  }}
                >
                  Указать
                </Button>
              </div>
            </Div>
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
