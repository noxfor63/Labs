import {
  CITIES,
  LIMITS,
  SEAT_OPTIONS,
  destinationsFrom,
  isKnownRoute,
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

const ANY = 'ANY';

/**
 * Направление — два коротких ряда «откуда» и «куда», а не шесть длинных
 * «таблеток» с полными названиями маршрутов.
 *
 * Шесть подписей вида «Оренбург → Соль-Илецк» не помещались на экран
 * телефона и уезжали в горизонтальную прокрутку. Названий городов всего
 * три, поэтому в разбивке по «откуда» и «куда» тот же выбор занимает две
 * строки и виден целиком.
 *
 * Второй ряд показывается только после выбора города и содержит лишь
 * достижимые из него направления — невозможный маршрут нельзя и собрать.
 */
const CITY_CHIPS: readonly ChipOption<string>[] = [
  { value: ANY, label: 'Все' },
  ...CITIES.map((city) => ({ value: city.name, label: city.name })),
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

const CHIPS_LABEL_STYLE = {
  display: 'block',
  marginBottom: 6,
  color: 'var(--vkui--color_text_secondary)',
} as const;

export function SearchPanel({ id }: { id: string }): ReactNode {
  const routeNavigator = useRouteNavigator();
  // Через useNow, а не Date.now() в рендере: «сегодня» обязано пережить полночь.
  const now = useNow();

  const [from, setFrom] = useState(ANY);
  const [to, setTo] = useState(ANY);
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

    if (from !== ANY) {
      next.from = from;
    }
    if (to !== ANY) {
      next.to = to;
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
  }, [from, to, day, customDate, dates, role, priceMax, seatsMin]);

  const feed = useTripFeed(query);
  const hasFilters = Object.keys(query).length > 0;

  /** Во втором ряду — только города, куда из выбранного действительно ездят. */
  const toChips: ChipOption<string>[] =
    from === ANY
      ? [...CITY_CHIPS]
      : [
          { value: ANY, label: 'Все' },
          ...destinationsFrom(from).map((city) => ({ value: city.name, label: city.name })),
        ];

  const pickFrom = (value: string): void => {
    setFrom(value);
    // Прошлое «куда» могло стать недостижимым — тогда сбрасываем его.
    if (value !== ANY && to !== ANY && !isKnownRoute(value, to)) {
      setTo(ANY);
    }
  };

  const reset = (): void => {
    setFrom(ANY);
    setTo(ANY);
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
          <Caption level="1" style={CHIPS_LABEL_STYLE}>
            Откуда
          </Caption>
          <FilterChips
            ariaLabel="Город отправления"
            options={CITY_CHIPS}
            value={from}
            onChange={pickFrom}
          />

          {from !== ANY && (
            <>
              <Caption level="1" style={{ ...CHIPS_LABEL_STYLE, marginTop: 12 }}>
                Куда
              </Caption>
              <FilterChips
                ariaLabel="Город назначения"
                options={toChips}
                value={to}
                onChange={setTo}
              />
            </>
          )}

          <Caption level="1" style={{ ...CHIPS_LABEL_STYLE, marginTop: 12 }}>
            Когда
          </Caption>
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
