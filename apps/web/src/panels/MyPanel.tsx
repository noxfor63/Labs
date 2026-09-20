import type { MyRequestDto, TripSummary } from '@vk-rideshare/shared';
import { Icon56SearchOutline } from '@vkontakte/icons';
import { useActiveVkuiLocation, useRouteNavigator } from '@vkontakte/vk-mini-apps-router';
import {
  Button,
  Div,
  Footer,
  Group,
  Panel,
  PanelHeader,
  Placeholder,
  Tabs,
  TabsItem,
} from '@vkontakte/vkui';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { api } from '../api/client.js';
import { ErrorState } from '../components/ErrorState.js';
import { TripCard } from '../components/TripCard.js';
import { TripCardSkeleton } from '../components/TripCardSkeleton.js';
import { useAsync } from '../lib/useAsync.js';

type TabId = 'trips' | 'requests' | 'completed';

const TAB_ITEM_STYLE = { paddingInline: 6 } as const;

const REQUEST_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Ждёт ответа',
  ACCEPTED: 'Принят',
  DECLINED: 'Отклонён',
  CANCELLED: 'Отменён',
};

export function MyPanel({ id, view }: { id: string; view: string }): ReactNode {
  const routeNavigator = useRouteNavigator();
  const { view: activeView } = useActiveVkuiLocation();
  const [tab, setTab] = useState<TabId>('trips');
  // Данные раздела нужны только когда раздел открыт.
  const enabled = activeView === view;

  const tripsLoader = useCallback((signal: AbortSignal) => api.myTrips(signal), []);
  const requestsLoader = useCallback((signal: AbortSignal) => api.myRequests(signal), []);

  const trips = useAsync(tripsLoader, { enabled });
  const requests = useAsync(requestsLoader, { enabled });

  /**
   * «Завершённые» — это поездки, по которым уже можно оставить отзыв:
   * и свои объявления, и те, куда взяли пассажиром.
   */
  const completed = useMemo<TripSummary[]>(() => {
    const mine = (trips.data?.items ?? []).filter((trip) => trip.status === 'COMPLETED');
    const asPassenger = (requests.data?.items ?? [])
      .filter(
        (request: MyRequestDto) =>
          request.status === 'ACCEPTED' && request.trip.status === 'COMPLETED',
      )
      .map((request) => request.trip);

    const seen = new Set<string>();
    return [...mine, ...asPassenger].filter((trip) => {
      if (seen.has(trip.id)) {
        return false;
      }
      seen.add(trip.id);
      return true;
    });
  }, [trips.data, requests.data]);

  const activeSection =
    tab === 'requests' ? requests : trips;

  const renderList = (): ReactNode => {
    if (activeSection.error !== null) {
      return <ErrorState error={activeSection.error} onRetry={activeSection.reload} />;
    }
    if (activeSection.isLoading) {
      return (
        <Div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TripCardSkeleton />
          <TripCardSkeleton />
        </Div>
      );
    }

    if (tab === 'trips') {
      const items = trips.data?.items ?? [];
      if (items.length === 0) {
        return (
          <Placeholder
            icon={<Icon56SearchOutline />}
            title="Объявлений пока нет"
            action={
              <Button
                size="m"
                onClick={() => {
                  void routeNavigator.push('/create');
                }}
              >
                Создать поездку
              </Button>
            }
          >
            Опубликуйте поездку, чтобы вас нашли попутчики.
          </Placeholder>
        );
      }
      return (
        <Div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((trip) => (
            <TripCard
              key={trip.id}
              trip={trip}
              onClick={() => {
                void routeNavigator.push(`/my/trip/${trip.id}`);
              }}
            />
          ))}
        </Div>
      );
    }

    if (tab === 'requests') {
      const items = requests.data?.items ?? [];
      if (items.length === 0) {
        return (
          <Placeholder icon={<Icon56SearchOutline />} title="Откликов пока нет">
            Найдите поездку в поиске и откликнитесь на неё.
          </Placeholder>
        );
      }
      return (
        <Div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((request) => (
            <div key={request.id}>
              <TripCard
                trip={request.trip}
                onClick={() => {
                  void routeNavigator.push(`/my/trip/${request.trip.id}`);
                }}
              />
              <Footer style={{ paddingTop: 4, paddingBottom: 0 }}>
                {`Ваш отклик: ${REQUEST_STATUS_LABEL[request.status] ?? request.status}`}
              </Footer>
            </div>
          ))}
        </Div>
      );
    }

    if (completed.length === 0) {
      return (
        <Placeholder icon={<Icon56SearchOutline />} title="Завершённых поездок нет">
          Здесь появятся поездки, по которым можно оставить отзыв.
        </Placeholder>
      );
    }

    return (
      <Div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {completed.map((trip) => (
          <div key={trip.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <TripCard
              trip={trip}
              onClick={() => {
                void routeNavigator.push(`/my/trip/${trip.id}`);
              }}
            />
            <Button
              size="m"
              mode="secondary"
              stretched
              onClick={() => {
                void routeNavigator.push(`/my/review/${trip.id}`);
              }}
            >
              Оставить отзыв
            </Button>
          </div>
        ))}
      </Div>
    );
  };

  return (
    <Panel id={id}>
      <PanelHeader>Мои поездки</PanelHeader>

      <Group>
        {/*
          На телефоне ширина вкладки — треть экрана, и штатные отступы
          съедают подпись до многоточия. Урезаем их ровно настолько,
          чтобы «Объявления» помещались целиком.
        */}
        <Tabs selectedId={`tab-${tab}`}>
          <TabsItem
            selected={tab === 'trips'}
            onClick={() => {
              setTab('trips');
            }}
            id="tab-trips"
            style={TAB_ITEM_STYLE}
          >
            Объявления
          </TabsItem>
          <TabsItem
            selected={tab === 'requests'}
            onClick={() => {
              setTab('requests');
            }}
            id="tab-requests"
            style={TAB_ITEM_STYLE}
          >
            Отклики
          </TabsItem>
          <TabsItem
            selected={tab === 'completed'}
            onClick={() => {
              setTab('completed');
            }}
            id="tab-completed"
            style={TAB_ITEM_STYLE}
          >
            Завершено
          </TabsItem>
        </Tabs>

        {renderList()}
      </Group>
    </Panel>
  );
}
