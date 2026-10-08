import {
  MODERATION_ACTION,
  REPORT_REASON_LABEL,
  REPORT_TARGET,
  type ModerationAction,
  type ModerationReport,
} from '@vk-rideshare/shared';
import { useActiveVkuiLocation, useRouteNavigator } from '@vkontakte/vk-mini-apps-router';
import {
  Button,
  Caption,
  Div,
  Footer,
  Group,
  Header,
  Panel,
  PanelHeader,
  PanelHeaderBack,
  PanelSpinner,
  Placeholder,
  SegmentedControl,
  Spacing,
  Subhead,
  Text,
} from '@vkontakte/vkui';
import { useCallback, useState, type ReactNode } from 'react';

import { ApiRequestError, api } from '../api/client.js';
import { ErrorState } from '../components/ErrorState.js';
import { formatDate, fullName } from '../lib/format.js';
import { useAsync } from '../lib/useAsync.js';
import { useSnackbar } from '../lib/SnackbarContext.js';

const TARGET_LABEL: Record<string, string> = {
  [REPORT_TARGET.TRIP]: 'Объявление',
  [REPORT_TARGET.REVIEW]: 'Отзыв',
  [REPORT_TARGET.USER]: 'Профиль',
};

const TABS = [
  { value: 'NEW', label: 'Новые' },
  { value: 'REVIEWED', label: 'Разобраны' },
  { value: 'DISMISSED', label: 'Отклонены' },
] as const;

/**
 * Разбор жалоб — для владельца приложения, прямо в приложении.
 *
 * Экран появился не ради удобства. Жалоба ложится в базу на сервере, а
 * оповестить владельца нечем: у сервера нет исходящего доступа к
 * Telegram, почта не настроена. Единственный канал, который работает
 * наверняка, — само приложение, и открывают его чаще, чем консоль по
 * SSH. Те же действия доступны командой `npm run moderate`, и считают
 * обе одинаково: общий код лежит в `apps/api/src/lib/moderation.ts`.
 *
 * Доступ решает сервер по MODERATOR_IDS. Здесь нет и не должно быть
 * проверки «если я владелец»: клиент о таком не договаривается.
 */
export function ModerationPanel({ id, view }: { id: string; view: string }): ReactNode {
  const routeNavigator = useRouteNavigator();
  const { view: activeView, panel: activePanel } = useActiveVkuiLocation();
  const isActive = activeView === view && activePanel === id;
  const snackbar = useSnackbar();

  const [status, setStatus] = useState<string>('NEW');
  const [busyId, setBusyId] = useState<string | null>(null);

  const loader = useCallback(
    (signal: AbortSignal) => api.moderationReports(status, signal),
    [status],
  );
  const { data, isLoading, error, reload } = useAsync(loader, { enabled: isActive });

  const act = async (report: ModerationReport, action: ModerationAction): Promise<void> => {
    setBusyId(report.id);
    try {
      const updated = await api.moderateReport(report.id, action);
      snackbar.showSuccess(
        action === MODERATION_ACTION.UNBLOCK
          ? 'Доступ открыт'
          : action === MODERATION_ACTION.DISMISS
            ? 'Жалоба отклонена'
            : updated.ownerBlocked
              ? 'Контент удалён, доступ закрыт'
              : 'Контент удалён',
      );
      reload();
    } catch (caught) {
      snackbar.showError(
        caught instanceof ApiRequestError ? caught.message : 'Не удалось выполнить действие',
      );
    } finally {
      setBusyId(null);
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
      Жалобы
    </PanelHeader>
  );

  return (
    <Panel id={id}>
      {header}

      <Group>
        <Div>
          <SegmentedControl
            value={status}
            onChange={(value) => {
              setStatus(String(value));
            }}
            options={TABS.map((tab) => ({ label: tab.label, value: tab.value }))}
          />
        </Div>
      </Group>

      {isLoading ? (
        <PanelSpinner />
      ) : error !== null ? (
        <Group>
          <ErrorState error={error} onRetry={reload} />
        </Group>
      ) : data === null || data.items.length === 0 ? (
        <Group>
          <Placeholder title={status === 'NEW' ? 'Новых жалоб нет' : 'Пусто'}>
            {status === 'NEW'
              ? 'Здесь появятся жалобы на объявления, отзывы и профили.'
              : 'В этом разделе пока ничего нет.'}
          </Placeholder>
        </Group>
      ) : (
        data.items.map((report) => (
          <Group
            key={report.id}
            header={
              <Header size="s">
                {`${TARGET_LABEL[report.target] ?? report.target} · ${REPORT_REASON_LABEL[report.reason]}`}
              </Header>
            }
          >
            <Div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-space-3)' }}>
              {/* Сам текст — крупно и первым: разбирают его, а не
                  идентификаторы. Остальное ниже и мельче. */}
              <div className="app-tile">
                <Text style={{ whiteSpace: 'pre-line' }}>{report.content}</Text>
              </div>

              {report.comment !== null && (
                <div>
                  <Caption level="1" weight="2" className="app-field-label">
                    Пояснение
                  </Caption>
                  <Text>{report.comment}</Text>
                </div>
              )}

              <Subhead style={{ color: 'var(--vkui--color_text_secondary)' }}>
                {report.owner === null
                  ? 'Автор неизвестен'
                  : `Автор: ${fullName(report.owner)}${report.ownerBlocked ? ' · доступ закрыт' : ''}`}
              </Subhead>
              <Caption level="1" style={{ color: 'var(--vkui--color_text_secondary)' }}>
                {`Пожаловался ${fullName(report.reporter)} · ${formatDate(report.createdAt)}`}
              </Caption>

              {report.status === 'NEW' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {report.target !== REPORT_TARGET.USER && (
                      <Button
                        size="m"
                        stretched
                        mode="secondary"
                        appearance="negative"
                        loading={busyId === report.id}
                        disabled={busyId !== null}
                        onClick={() => {
                          void act(report, MODERATION_ACTION.REMOVE);
                        }}
                      >
                        Удалить
                      </Button>
                    )}
                    <Button
                      size="m"
                      stretched
                      mode="secondary"
                      loading={busyId === report.id}
                      disabled={busyId !== null}
                      onClick={() => {
                        void act(report, MODERATION_ACTION.DISMISS);
                      }}
                    >
                      Нарушения нет
                    </Button>
                  </div>
                  <Button
                    size="m"
                    stretched
                    appearance="negative"
                    loading={busyId === report.id}
                    disabled={busyId !== null || report.owner === null}
                    onClick={() => {
                      void act(report, MODERATION_ACTION.BLOCK);
                    }}
                  >
                    {report.target === REPORT_TARGET.USER
                      ? 'Закрыть доступ'
                      : 'Удалить и закрыть доступ'}
                  </Button>
                </div>
              ) : report.ownerBlocked ? (
                /* Разобранную жалобу не переигрывают, но ошибку в
                   блокировке надо уметь исправить с телефона — иначе за
                   этим придётся идти на сервер по SSH. */
                <Button
                  size="m"
                  stretched
                  mode="secondary"
                  loading={busyId === report.id}
                  disabled={busyId !== null}
                  onClick={() => {
                    void act(report, MODERATION_ACTION.UNBLOCK);
                  }}
                >
                  Вернуть доступ автору
                </Button>
              ) : null}
            </Div>
          </Group>
        ))
      )}

      <Footer>
        {data === null
          ? ''
          : `Ждут разбора: ${data.newCount}. Те же действия есть командой npm run moderate на сервере.`}
      </Footer>
      <Spacing size={16} />
    </Panel>
  );
}
