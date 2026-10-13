import {
  DIRECTION,
  LIMITS,
  SEAT_OPTIONS,
  buildRoute,
  type Direction,
  type TripListQuery,
  type TripRole,
} from '@vk-rideshare/shared';
import { Icon56SearchOutline } from '@vkontakte/icons';
import { useRouteNavigator } from '@vkontakte/vk-mini-apps-router';
import {
  Button,
  Caption,
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
  Spinner,
} from '@vkontakte/vkui';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { ErrorState } from '../components/ErrorState.js';
import { FilterChips, type ChipOption } from '../components/FilterChips.js';
import { TripCard } from '../components/TripCard.js';
import { TripCardSkeleton } from '../components/TripCardSkeleton.js';
import { toDateInputValue } from '../lib/format.js';
import { SPOKE_CHIPS, directionChips } from '../lib/routeChips.js';
import { useNow } from '../lib/useNow.js';
import { useTripFeed } from '../lib/useTripFeed.js';

const ANY = 'ANY';

/**
 * Маршрут выбирается в два шага: спица, затем сторона.
 *
 * Восемь подписей вида «Оренбург → Соль-Илецк» одним рядом не помещаются
 * на экран телефона и уезжают в горизонтальную прокрутку, а варианты за
 * краем экрана обычно просто не находят. В радиальной модели выбор и так
 * распадается на два: какая спица и в какую сторону — спиц четыре,
 * сторон две, оба ряда видны целиком.
 *
 * Ряд со стороной показывается только после выбора спицы: без неё
 * сторона ничего не значит.
 */
const SPOKE_FILTER_CHIPS: readonly ChipOption<string>[] = [
  { value: ANY, label: 'Все' },
  ...SPOKE_CHIPS,
];

type DayFilter = 'ANY' | 'TODAY' | 'TOMORROW' | 'CUSTOM';

const DAY_CHIPS: readonly ChipOption<DayFilter>[] = [
  { value: 'ANY', label: 'Любой день' },
  { value: 'TODAY', label: 'Сегодня' },
  { value: 'TOMORROW', label: 'Завтра' },
  { value: 'CUSTOM', label: 'Выбрать дату' },
];

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

const ROLE_CHIPS: readonly ChipOption<RoleFilter>[] = [
  { value: 'ANY', label: 'Все' },
  { value: 'DRIVER', label: 'Водители' },
  { value: 'PASSENGER', label: 'Пассажиры' },
];

/**
 * Подпись над рядом «таблеток».
 *
 * Отдельный компонент, а не разметка на месте: подписей четыре, и если
 * задавать отступы каждой руками, они разъедутся на первой же правке.
 */
function FilterLabel({ children }: { children: string }): ReactNode {
  return (
    <Caption level="1" weight="2" className="app-field-label">
      {children}
    </Caption>
  );
}

export function SearchPanel({ id }: { id: string }): ReactNode {
  const routeNavigator = useRouteNavigator();
  // Через useNow, а не Date.now() в рендере: «сегодня» обязано пережить полночь.
  const now = useNow();

  const [spoke, setSpoke] = useState(ANY);
  /*
   * Сторона выбрана заранее, а не пустая: «спица плюс сторона» — это один
   * маршрут, и состояния «спица есть, сторона нет» в фильтре быть не
   * может — лента показывает одно направление, а не оба сразу. По
   * умолчанию стоит дорога в Оренбург: в областной центр из райцентра
   * едут чаще, чем обратно (больница, документы, рынок). Обе стороны
   * подписаны полным маршрутом и лежат рядом, так что переключение —
   * одно касание.
   */
  const [direction, setDirection] = useState<Direction>(DIRECTION.TO_HUB);
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

    if (spoke !== ANY) {
      const route = buildRoute(spoke, direction);
      next.from = route.from;
      next.to = route.to;
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
  }, [spoke, direction, day, customDate, dates, role, priceMax, seatsMin]);

  const feed = useTripFeed(query);
  const hasFilters = Object.keys(query).length > 0;

  const reset = (): void => {
    setSpoke(ANY);
    setDirection(DIRECTION.TO_HUB);
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
        <Div
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-space-4)' }}
        >
          <div>
            <FilterLabel>Направление</FilterLabel>
            <FilterChips
              ariaLabel="Направление поездки"
              options={SPOKE_FILTER_CHIPS}
              value={spoke}
              onChange={setSpoke}
            />
          </div>

          {spoke !== ANY && (
            <div>
              <FilterLabel>Сторона</FilterLabel>
              <FilterChips
                ariaLabel="Сторона маршрута"
                options={directionChips(spoke)}
                value={direction}
                onChange={setDirection}
              />
            </div>
          )}

          <div>
            <FilterLabel>Когда</FilterLabel>
            <FilterChips
              ariaLabel="День поездки"
              options={DAY_CHIPS}
              value={day}
              onChange={setDay}
            />
          </div>

          <div>
            <FilterLabel>Кого ищете</FilterLabel>
            <FilterChips
              ariaLabel="Роль автора объявления"
              options={ROLE_CHIPS}
              value={role}
              onChange={setRole}
            />
          </div>
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

        <Div style={{ display: 'flex', gap: 'var(--app-space-2)', paddingTop: 0 }}>
          <button
            type="button"
            className="app-chip"
            onClick={() => {
              setShowMore((value) => !value);
            }}
          >
            <Caption level="1" weight="2">
              {showMore ? 'Свернуть' : 'Ещё фильтры'}
            </Caption>
          </button>
          {hasFilters && (
            <button type="button" className="app-chip" onClick={reset}>
              <Caption level="1" weight="2">
                Сбросить
              </Caption>
            </button>
          )}
        </Div>
      </Group>

      <Group header={<Header size="s">Поездки</Header>}>{renderFeed()}</Group>
    </Panel>
  );
}
