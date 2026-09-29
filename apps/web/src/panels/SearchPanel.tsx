import { LIMITS, ROUTES, SEAT_OPTIONS, type TripListQuery, type TripRole } from '@vk-rideshare/shared';
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
import { FilterChips, type ChipOption } from '../components/FilterChips.js';
import { TripCard } from '../components/TripCard.js';
import { TripCardSkeleton } from '../components/TripCardSkeleton.js';
import { toDateInputValue } from '../lib/format.js';
import { useNow } from '../lib/useNow.js';
import { useTripFeed } from '../lib/useTripFeed.js';

/**
 * Направление выбирается одной «таблеткой», а не парой списков.
 *
 * Маршрутов ровно шесть и набор закрыт, поэтому показать их все разом
 * дешевле, чем заставлять выбирать «откуда», потом «куда» — и получать
 * в награду за ошибку сообщение «такого направления нет».
 */
const ROUTE_CHIPS: readonly ChipOption<string>[] = [
  { value: 'ANY', label: 'Все направления' },
  ...ROUTES.map((route, index) => ({
    value: String(index),
    label: `${route.from} → ${route.to}`,
  })),
];

type DayFilter = 'ANY' | 'TODAY' | 'TOMORROW' | 'CUSTOM';

const DAY_CHIPS: readonly ChipOption<DayFilter>[] = [
  { value: 'ANY', label: 'Любой день' },
  { value: 'TODAY', label: 'Сегодня' },
  { value: 'TOMORROW', label: 'Завтра' },
  { value: 'CUSTOM', label: 'Выбрать дату' },
];

const ANY = 'ANY';

/** Цена шагом в 50 ₽ — тем же, что и в форме создания. */
const priceOptions = [
  { value: ANY, label: 'Любая' },
  ...Array.from(
    { length: (LIMITS.PRICE_MAX - LIMITS.PRICE_MIN) / 50 + 1 },
    (_, index) => LIMITS.PRICE_MIN + index * 50,
  ).map((price) => ({ value: String(price), label: `до ${price} ₽` })),
];

const seatsOptions = [
  { value: ANY, label: 'Любое' },
  ...SEAT_OPTIONS.map((count) => ({ value: String(count), label: `от ${count}` })),
];

type RoleFilter = TripRole | 'ANY';

export function SearchPanel({ id }: { id: string }): ReactNode {
  const routeNavigator = useRouteNavigator();
  // Через useNow, а не Date.now() в рендере: «сегодня» обязано пережить полночь.
  const now = useNow();

  const [routeKey, setRouteKey] = useState('ANY');
  const [day, setDay] = useState<DayFilter>('ANY');
  const [customDate, setCustomDate] = useState('');
  const [role, setRole] = useState<RoleFilter>('ANY');
  const [priceMax, setPriceMax] = useState(ANY);
  const [seatsMin, setSeatsMin] = useState(ANY);
  const [showMore, setShowMore] = useState(false);

  const dates = useMemo(() => {
    const today = new Date(now);
    const tomorrow = new Date(now + 24 * 60 * 60 * 1000);
    return { today: toDateInputValue(today), tomorrow: toDateInputValue(tomorrow) };
  }, [now]);

  /**
   * Все фильтры дискретны, поэтому применяются сразу по нажатию —
   * кнопка «Найти» не нужна. Свободного ввода, ради которого её раньше
   * держали, в фильтрах не осталось: цена и места стали списками.
   */
  const query = useMemo<TripListQuery>(() => {
    const next: TripListQuery = {};

    if (routeKey !== 'ANY') {
      const route = ROUTES[Number(routeKey)];
      if (route !== undefined) {
        next.from = route.from;
        next.to = route.to;
      }
    }

    if (day === 'TODAY') {
      next.date = dates.today;
    } else if (day === 'TOMORROW') {
      next.date = dates.tomorrow;
    } else if (day === 'CUSTOM' && customDate !== '') {
      next.date = customDate;
    }

    if (role !== 'ANY') {
      next.role = role;
    }
    if (priceMax !== ANY) {
      next.priceMax = Number(priceMax);
    }
    if (seatsMin !== ANY) {
      next.seatsMin = Number(seatsMin);
    }
    return next;
  }, [routeKey, day, customDate, dates, role, priceMax, seatsMin]);

  const feed = useTripFeed(query);
  const hasFilters = Object.keys(query).length > 0;

  const reset = (): void => {
    setRouteKey('ANY');
    setDay('ANY');
    setCustomDate('');
    setRole('ANY');
    setPriceMax(ANY);
    setSeatsMin(ANY);
  };

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

  const renderFeed = (): ReactNode => {
    if (feed.error !== null && feed.items.length === 0) {
      return <ErrorState error={feed.error} onRetry={feed.reload} />;
    }
    if (feed.isLoading) {
      return (
        <Div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TripCardSkeleton />
          <TripCardSkeleton />
          <TripCardSkeleton />
        </Div>
      );
    }
    if (feed.items.length === 0) {
      return (
        <Placeholder
          icon={<Icon56SearchOutline />}
          title="Ничего не нашлось"
          action={
            hasFilters ? (
              <Button size="m" mode="secondary" onClick={reset}>
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
            ? 'По этим фильтрам поездок нет. Попробуйте другой день или направление.'
            : 'Пока никто не опубликовал поездку. Будьте первым.'}
        </Placeholder>
      );
    }

    return (
      <>
        <Div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {feed.items.map((trip) => (
            <TripCard
              key={trip.id}
              trip={trip}
              now={now}
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
    );
  };

  return (
    <Panel id={id}>
      <PanelHeader>Поиск попутчиков</PanelHeader>

      <Group>
        <Div style={{ paddingBottom: 0 }}>
          <FilterChips
            ariaLabel="Направление"
            options={ROUTE_CHIPS}
            value={routeKey}
            onChange={setRouteKey}
          />
          <FilterChips ariaLabel="День поездки" options={DAY_CHIPS} value={day} onChange={setDay} />
        </Div>

        {day === 'CUSTOM' && (
          <FormItem top="Дата">
            <Input
              type="date"
              value={customDate}
              onChange={(event) => {
                setCustomDate(event.target.value);
              }}
            />
          </FormItem>
        )}

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

        {showMore && (
          <FormLayoutGroup mode="horizontal">
            <FormItem top="Цена">
              <CustomSelect
                options={priceOptions}
                value={priceMax}
                onChange={(_, value) => {
                  setPriceMax(value === null ? ANY : String(value));
                }}
              />
            </FormItem>
            <FormItem top="Мест свободно">
              <CustomSelect
                options={seatsOptions}
                value={seatsMin}
                onChange={(_, value) => {
                  setSeatsMin(value === null ? ANY : String(value));
                }}
              />
            </FormItem>
          </FormLayoutGroup>
        )}

        <Div style={{ display: 'flex', gap: 8 }}>
          <Button
            size="m"
            mode="tertiary"
            onClick={() => {
              setShowMore((value) => !value);
            }}
          >
            {showMore ? 'Свернуть фильтры' : 'Ещё фильтры'}
          </Button>
          {hasFilters && (
            <Button size="m" mode="tertiary" onClick={reset}>
              Сбросить
            </Button>
          )}
        </Div>
      </Group>

      <Group header={<Header size="s">Поездки</Header>}>{renderFeed()}</Group>
    </Panel>
  );
}
