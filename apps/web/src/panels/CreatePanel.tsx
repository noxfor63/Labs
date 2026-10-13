import {
  DEPART_TIME_SLOTS,
  LIMITS,
  SEAT_OPTIONS,
  buildRoute,
  formatPhone,
  isAllowedDepartTime,
  isUnreachable,
  normalizePhone,
  type CreateTripInput,
  type Direction,
  type Route,
  type TripRole,
} from '@vk-rideshare/shared';
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
  SegmentedControl,
  Textarea,
} from '@vkontakte/vkui';
import { useState, type ReactNode } from 'react';

import { ApiRequestError, api } from '../api/client.js';
import { FilterChips, type ChipOption } from '../components/FilterChips.js';
import { PhoneField } from '../components/PhoneField.js';
import { toDateInputValue } from '../lib/format.js';
import { SPOKE_CHIPS, directionChips } from '../lib/routeChips.js';
import { useSession } from '../lib/SessionContext.js';
import { useSnackbar } from '../lib/SnackbarContext.js';

/** 48 получасовых слотов суток — время выезда выбирается только из них. */
const timeOptions = DEPART_TIME_SLOTS.map((slot) => ({ value: slot, label: slot }));

/**
 * Места — выбор из списка, а не ввод числа.
 *
 * Свободный ввод здесь ничего не давал: допустимых значений всего шесть,
 * зато он пускал в поле пустую строку, «3.5» и «e», а на телефоне
 * поднимал цифровую клавиатуру поверх формы ради одного нажатия.
 */
const seatChips: readonly ChipOption<string>[] = SEAT_OPTIONS.map((count) => ({
  value: String(count),
  label: String(count),
}));

type FieldErrors = Partial<Record<string, string>>;

type FormState = {
  role: TripRole;
  /** Спица маршрута; null — не выбрана. Оренбург всегда второй конец. */
  spoke: string | null;
  /** Сторона: из Оренбурга или в Оренбург. null — не выбрана. */
  direction: Direction | null;
  fromPoint: string;
  toPoint: string;
  date: string;
  time: string;
  seatsTotal: string;
  priceRub: string;
  carModel: string;
  comment: string;
  phone: string;
};

/**
 * Номер подставляется из профиля: он один на человека, и перенабирать его
 * при каждом объявлении незачем. Правка здесь меняет его и в профиле.
 */
const emptyForm = (phone: string): FormState => ({
  role: 'DRIVER',
  spoke: null,
  direction: null,
  fromPoint: '',
  toPoint: '',
  date: toDateInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000)),
  time: '09:00',
  seatsTotal: '3',
  priceRub: '600',
  carModel: '',
  comment: '',
  phone,
});

/** Локальная проверка — чтобы не гонять заведомо плохую форму на сервер. */
function validate(
  form: FormState,
  phoneRequired: boolean,
): { errors: FieldErrors; departAt: Date | null; route: Route | null } {
  const errors: FieldErrors = {};

  /*
   * Маршрут собирается из спицы и стороны, а не вводится двумя городами.
   * Проверять пару на существование больше не нужно: пара, которой нет,
   * в двухшаговом выборе просто не выражается.
   */
  let route: Route | null = null;
  if (form.spoke === null) {
    errors['spoke'] = 'Выберите направление';
  } else if (form.direction === null) {
    errors['direction'] = 'Выберите, в какую сторону едете';
  } else {
    route = buildRoute(form.spoke, form.direction);
  }

  let departAt: Date | null = null;
  if (form.date === '' || form.time === '') {
    errors['date'] = 'Укажите дату и время';
  } else {
    // Время местное: пользователь выбирает слот в своём часовом поясе.
    departAt = new Date(`${form.date}T${form.time}`);
    if (Number.isNaN(departAt.getTime())) {
      errors['date'] = 'Некорректная дата';
      departAt = null;
    } else if (departAt.getTime() <= Date.now()) {
      errors['date'] = 'Дата отправления должна быть в будущем';
    } else if (!isAllowedDepartTime(departAt)) {
      // Пояса России смещены на целое число часов, так что сюда можно
      // попасть только из экзотического пояса со смещением в 45 минут.
      errors['time'] = 'Выберите время из списка получасовых слотов';
    }
  }

  const seats = Number(form.seatsTotal);
  if (
    !Number.isInteger(seats) ||
    seats < LIMITS.SEATS_MIN ||
    seats > LIMITS.SEATS_MAX
  ) {
    errors['seatsTotal'] = `От ${LIMITS.SEATS_MIN} до ${LIMITS.SEATS_MAX}`;
  }

  if (form.phone.trim() === '') {
    /*
     * Пустое поле — ошибка только для того, кому иначе не дозвониться.
     * У пришедшего из ВКонтакте остаётся страница, у пришедшего из
     * Telegram — ничего: диалог там открывается не у всех, а в России
     * Telegram работает с перебоями, и договариваются звонком.
     */
    if (phoneRequired) {
      errors['phone'] = 'Без номера попутчики не смогут с вами связаться';
    }
  } else if (normalizePhone(form.phone) === null) {
    errors['phone'] = 'Укажите мобильный номер в виде +7 999 123-45-67';
  }

  const price = Number(form.priceRub);
  if (form.priceRub === '') {
    errors['priceRub'] = 'Укажите цену';
  } else if (
    !Number.isInteger(price) ||
    price < LIMITS.PRICE_MIN ||
    price > LIMITS.PRICE_MAX
  ) {
    errors['priceRub'] = `От ${LIMITS.PRICE_MIN} до ${LIMITS.PRICE_MAX} ₽`;
  }

  return { errors, departAt, route };
}

export function CreatePanel({ id }: { id: string }): ReactNode {
  const routeNavigator = useRouteNavigator();
  const snackbar = useSnackbar();
  const session = useSession();
  const profilePhone = session.user?.phone ?? '';

  // Формат для показа, не для хранения: в поле удобнее видеть
  // «+7 999 123-45-67», а на сервер всё равно уедет нормализованный вид.
  const [form, setForm] = useState<FormState>(() => emptyForm(formatPhone(profilePhone)));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => {
      if (previous[key] === undefined) {
        return previous;
      }
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  /*
   * Считается по полю формы, а не по сохранённому профилю: номер можно
   * стереть прямо здесь, и тогда человек снова остаётся без связи.
   */
  const phoneRequired =
    session.user !== null &&
    isUnreachable({ vkUserId: session.user.vkUserId, phone: form.phone });

  const submit = async (): Promise<void> => {
    const { errors: found, departAt, route } = validate(form, phoneRequired);
    setErrors(found);
    if (Object.keys(found).length > 0 || departAt === null || route === null) {
      return;
    }

    const input: CreateTripInput = {
      role: form.role,
      fromCity: route.from,
      fromPoint: form.fromPoint.trim() === '' ? null : form.fromPoint.trim(),
      toCity: route.to,
      toPoint: form.toPoint.trim() === '' ? null : form.toPoint.trim(),
      departAt: departAt.toISOString(),
      seatsTotal: Number(form.seatsTotal),
      priceRub: Number(form.priceRub),
      carModel: form.carModel.trim() === '' ? null : form.carModel.trim(),
      comment: form.comment.trim() === '' ? null : form.comment.trim(),
    };

    const phone = form.phone.trim() === '' ? null : normalizePhone(form.phone);

    setIsSubmitting(true);
    try {
      // Номер сохраняем до создания поездки: если объявление уедет, а
      // номер нет, попутчики увидят поездку без способа дозвониться.
      if (phone !== (session.user?.phone ?? null)) {
        await session.savePhone(phone);
      }
      const trip = await api.createTrip(input);
      snackbar.showSuccess('Поездка опубликована');
      setForm(emptyForm(phone === null ? '' : formatPhone(phone)));
      await routeNavigator.push(`/trip/${trip.id}`);
    } catch (caught) {
      snackbar.showError(
        caught instanceof ApiRequestError ? caught.message : 'Не удалось создать поездку',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDriver = form.role === 'DRIVER';

  return (
    <Panel id={id}>
      <PanelHeader>Новая поездка</PanelHeader>

      <Group header={<Header size="s">Кто вы в этой поездке</Header>}>
        <FormItem>
          <SegmentedControl
            value={form.role}
            onChange={(value) => {
              update('role', value as TripRole);
            }}
            options={[
              { label: 'Я за рулём', value: 'DRIVER' },
              { label: 'Ищу водителя', value: 'PASSENGER' },
            ]}
          />
        </FormItem>
      </Group>

      <Group header={<Header size="s">Маршрут</Header>}>
        {/*
          Те же два шага, что в поиске: спица, затем сторона. Выбора
          «любой город → любой город» здесь нет и быть не может — все
          поездки идут через Оренбург, и два независимых списка городов
          давали бы заведомо невозможные пары вроде «Акбулак →
          Соль-Илецк».
        */}
        <FormItem
          top="Направление"
          status={errors['spoke'] === undefined ? 'default' : 'error'}
          bottom={errors['spoke']}
        >
          <FilterChips
            ariaLabel="Направление поездки"
            options={SPOKE_CHIPS}
            value={form.spoke}
            onChange={(value) => {
              update('spoke', value);
            }}
          />
        </FormItem>

        {/*
          Сторона не подставляется сама, в отличие от фильтра поиска:
          неверно угаданный фильтр человек поправит, увидев не ту ленту, а
          неверно угаданная сторона уедет в опубликованное объявление —
          попутчики приедут не туда.
        */}
        {form.spoke !== null && (
          <FormItem
            top="В какую сторону"
            status={errors['direction'] === undefined ? 'default' : 'error'}
            bottom={errors['direction']}
          >
            <FilterChips
              ariaLabel="Сторона маршрута"
              options={directionChips(form.spoke)}
              value={form.direction}
              onChange={(value) => {
                update('direction', value);
              }}
            />
          </FormItem>
        )}

        {/* Точки сбора и высадки — после обоих городов: сначала «куда едем»,
            потом подробности. Раньше они стояли между городами и разрывали
            маршрут пополам. */}
        <FormLayoutGroup mode="horizontal">
          <FormItem top="Место сбора">
            <Input
              maxLength={LIMITS.POINT_MAX}
              placeholder="Необязательно"
              value={form.fromPoint}
              onChange={(event) => {
                update('fromPoint', event.target.value);
              }}
            />
          </FormItem>
          <FormItem top="Место высадки">
            <Input
              maxLength={LIMITS.POINT_MAX}
              placeholder="Необязательно"
              value={form.toPoint}
              onChange={(event) => {
                update('toPoint', event.target.value);
              }}
            />
          </FormItem>
        </FormLayoutGroup>
      </Group>

      <Group header={<Header size="s">Когда и на каких условиях</Header>}>
        <FormLayoutGroup mode="horizontal">
          <FormItem
            top="Дата"
            status={errors['date'] === undefined ? 'default' : 'error'}
            bottom={errors['date']}
          >
            <Input
              type="date"
              value={form.date}
              onChange={(event) => {
                update('date', event.target.value);
              }}
            />
          </FormItem>
          <FormItem
            top="Время выезда"
            status={errors['time'] === undefined ? 'default' : 'error'}
            bottom={errors['time']}
          >
            <CustomSelect
              options={timeOptions}
              value={form.time}
              onChange={(_, value) => {
                update('time', value === null ? '' : String(value));
              }}
            />
          </FormItem>
        </FormLayoutGroup>

        <FormItem
          top={isDriver ? 'Свободных мест' : 'Сколько вас едет'}
          status={errors['seatsTotal'] === undefined ? 'default' : 'error'}
          bottom={errors['seatsTotal']}
        >
          {/* Шесть однозначных чисел помещаются в строку — выпадающий
              список ради них открывать незачем. */}
          <FilterChips
            ariaLabel="Количество мест"
            options={seatChips}
            value={form.seatsTotal}
            onChange={(value) => {
              update('seatsTotal', value);
            }}
          />
        </FormItem>

        <FormItem
          top="Цена с человека, ₽"
          status={errors['priceRub'] === undefined ? 'default' : 'error'}
          bottom={errors['priceRub'] ?? `От ${LIMITS.PRICE_MIN} до ${LIMITS.PRICE_MAX}`}
        >
          <Input
            type="number"
            inputMode="numeric"
            min={LIMITS.PRICE_MIN}
            max={LIMITS.PRICE_MAX}
            step={50}
            required
            value={form.priceRub}
            onChange={(event) => {
              update('priceRub', event.target.value);
            }}
          />
        </FormItem>

        {isDriver && (
          <FormItem top="Автомобиль (необязательно)">
            <Input
              maxLength={LIMITS.CAR_MODEL_MAX}
              placeholder="Например, Lada Vesta"
              value={form.carModel}
              onChange={(event) => {
                update('carModel', event.target.value);
              }}
            />
          </FormItem>
        )}

        <FormItem top="Комментарий (необязательно)">
          <Textarea
            maxLength={LIMITS.COMMENT_MAX}
            placeholder="Что важно знать попутчикам"
            value={form.comment}
            onChange={(event) => {
              update('comment', event.target.value);
            }}
          />
        </FormItem>

        <PhoneField
          value={form.phone}
          error={errors['phone']}
          required={session.user !== null && session.user.vkUserId === null}
          onChange={(value) => {
            update('phone', value);
          }}
        />

        <Div>
          <Button
            size="l"
            stretched
            loading={isSubmitting}
            disabled={isSubmitting}
            onClick={() => {
              void submit();
            }}
          >
            Опубликовать
          </Button>
        </Div>
      </Group>
    </Panel>
  );
}
