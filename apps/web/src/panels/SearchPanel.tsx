import {
  CITIES_ALPHABETICAL,
  LIMITS,
  type TripListQuery,
  type TripRole,
} from '@vk-rideshare/shared';
import { Icon56SearchOutline } from '@vkontakte/icons';
import { useRouteNavigator } from '@vkontakte/vk-mini-apps-router';
import {
  Button,
  CustomSelect,
  Div,
  FormItem,
  FormLayoutGroup,
  Group,
  Header,
  Input,
  Panel,
  PanelHeader,
  Placeholder,
  SegmentedControl,
  Spinner,
} from '@vkontakte/vkui';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { ErrorState } from '../components/ErrorState.js';
import { TripCard } from '../components/TripCard.js';
import { TripCardSkeleton } from '../components/TripCardSkeleton.js';
import { useTripFeed } from '../lib/useTripFeed.js';

const cityOptions = CITIES_ALPHABETICAL.map((city) => ({ value: city.name, label: city.name }));

type RoleFilter = TripRole | 'ANY';

export function SearchPanel({ id }: { id: string }): ReactNode {
  const routeNavigator = useRouteNavigator();

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [date, setDate] = useState('');
  const [role, setRole] = useState<RoleFilter>('ANY');
  const [priceMax, setPriceMax] = useState('');
  const [seatsMin, setSeatsMin] = useState('');

  // Фильтры применяются кнопкой: дёргать API на каждое нажатие клавиши
  // в поле цены — плохая идея и для сети, и для глаз.
  const [applied, setApplied] = useState<TripListQuery>({});

  const feed = useTripFeed(applied);

  const draft = useMemo<TripListQuery>(() => {
    const next: TripListQuery = {};
    if (from !== '') {
      next.from = from;
    }
    if (to !== '') {
      next.to = to;
    }
    if (date !== '') {
      next.date = date;
    }
    if (role !== 'ANY') {
      next.role = role;
    }
    const price = Number(priceMax);
    if (priceMax !== '' && Number.isFinite(price) && price >= 0) {
      next.priceMax = price;
    }
    const seats = Number(seatsMin);
    if (seatsMin !== '' && Number.isFinite(seats) && seats >= 1) {
      next.seatsMin = seats;
    }
    return next;
  }, [from, to, date, role, priceMax, seatsMin]);

  const hasFilters = Object.keys(applied).length > 0;

  // Подгрузка по скроллу: наблюдаем за пустым блоком в конце списка.
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const { hasMore, loadMore } = feed;

  useEffect(() => {
    if (sentinel === null || !hasMore) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [sentinel, hasMore, loadMore]);

  return (
    <Panel id={id}>
      <PanelHeader>Поиск попутчиков</PanelHeader>

      <Group header={<Header size="s">Фильтры</Header>}>
        <FormLayoutGroup mode="horizontal">
          <FormItem top="Откуда">
            <CustomSelect
              placeholder="Любой город"
              searchable
              allowClearButton
              options={cityOptions}
              value={from === '' ? null : from}
              onChange={(_, value) => {
                setFrom(value === null ? '' : String(value));
              }}
            />
          </FormItem>
          <FormItem top="Куда">
            <CustomSelect
              placeholder="Любой город"
              searchable
              allowClearButton
              options={cityOptions}
              value={to === '' ? null : to}
              onChange={(_, value) => {
                setTo(value === null ? '' : String(value));
              }}
            />
          </FormItem>
        </FormLayoutGroup>

        <FormItem top="Кого ищете">
          <SegmentedControl
            value={role}
            onChange={(value) => {
              setRole(value as RoleFilter);
            }}
            options={[
              { label: 'Все', value: 'ANY' },
              { label: 'Водители', value: 'DRIVER' },
              { label: 'Пассажиры', value: 'PASSENGER' },
            ]}
          />
        </FormItem>

        <FormItem top="Дата">
          <Input
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
            }}
          />
        </FormItem>

        <FormLayoutGroup mode="horizontal">
          <FormItem top="Цена до, ₽">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={LIMITS.PRICE_MAX}
              placeholder="Любая"
              value={priceMax}
              onChange={(event) => {
                setPriceMax(event.target.value);
              }}
            />
          </FormItem>
          <FormItem top="Мест от">
            <Input
              type="number"
              inputMode="numeric"
              min={LIMITS.SEATS_MIN}
              max={LIMITS.SEATS_MAX}
              placeholder="Любое"
              value={seatsMin}
              onChange={(event) => {
                setSeatsMin(event.target.value);
              }}
            />
          </FormItem>
        </FormLayoutGroup>

        <Div style={{ display: 'flex', gap: 8 }}>
          <Button
            size="l"
            stretched
            onClick={() => {
              setApplied(draft);
            }}
          >
            Найти
          </Button>
          {hasFilters && (
            <Button
              size="l"
              mode="secondary"
              onClick={() => {
                setFrom('');
                setTo('');
                setDate('');
                setRole('ANY');
                setPriceMax('');
                setSeatsMin('');
                setApplied({});
              }}
            >
              Сбросить
            </Button>
          )}
        </Div>
      </Group>

      <Group header={<Header size="s">Поездки</Header>}>
        {feed.error !== null && feed.items.length === 0 ? (
          <ErrorState error={feed.error} onRetry={feed.reload} />
        ) : feed.isLoading ? (
          <Div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <TripCardSkeleton />
            <TripCardSkeleton />
            <TripCardSkeleton />
          </Div>
        ) : feed.items.length === 0 ? (
          <Placeholder
            icon={<Icon56SearchOutline />}
            title="Ничего не нашлось"
            action={
              hasFilters ? (
                <Button
                  size="m"
                  mode="secondary"
                  onClick={() => {
                    setApplied({});
                  }}
                >
                  Сбросить фильтры
                </Button>
              ) : (
                <Button
                  size="m"
                  onClick={() => {
                    void routeNavigator.push('/create');
                  }}
                >
                  Создать поездку
                </Button>
              )
            }
          >
            {hasFilters
              ? 'По этим фильтрам поездок нет. Попробуйте изменить дату или маршрут.'
              : 'Пока никто не опубликовал поездку. Будьте первым.'}
          </Placeholder>
        ) : (
          <>
            <Div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {feed.items.map((trip) => (
                <TripCard
                  key={trip.id}
                  trip={trip}
                  onClick={() => {
                    void routeNavigator.push(`/trip/${trip.id}`);
                  }}
                />
              ))}
            </Div>

            <div ref={setSentinel} />

            {feed.isLoadingMore && (
              <Div style={{ display: 'flex', justifyContent: 'center' }}>
                <Spinner size="m" />
              </Div>
            )}
          </>
        )}
      </Group>
    </Panel>
  );
}
