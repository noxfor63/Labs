import {
  CITIES,
  DEPART_TIME_SLOTS,
  LIMITS,
  SEAT_OPTIONS,
  destinationsFrom,
  formatPhone,
  isAllowedDepartTime,
  isKnownRoute,
  isUnreachable,
  normalizePhone,
  type CreateTripInput,
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
import { useSession } from '../lib/SessionContext.js';
import { useSnackbar } from '../lib/SnackbarContext.js';

const cityChips: readonly ChipOption<string>[] = CITIES.map((city) => ({
  value: city.name,
  label: city.name,
}));

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
  fromCity: string;
  fromPoint: string;
  toCity: string;
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
  fromCity: '',
  fromPoint: '',
  toCity: '',
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
function validate(form: FormState, phoneRequired: boolean): { errors: FieldErrors; departAt: Date | null } {
  const errors: FieldErrors = {};

  if (form.fromCity === '') {
    errors['fromCity'] = 'Выберите город отправления';
  }
  if (form.toCity === '') {
    errors['toCity'] = 'Выберите город назначения';
  }
  if (form.fromCity !== '' && form.toCity !== '' && !isKnownRoute(form.fromCity, form.toCity)) {
    errors['toCity'] = 'Такого направления нет';
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

  return { errors, departAt };
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
    const { errors: found, departAt } = validate(form, phoneRequired);
    setErrors(found);
    if (Object.keys(found).length > 0 || departAt === null) {
      return;
    }

    const input: CreateTripInput = {
      role: form.role,
      fromCity: form.fromCity,
      fromPoint: form.fromPoint.trim() === '' ? null : form.fromPoint.trim(),
      toCity: form.toCity,
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

  // Направления закрытые: показываем только достижимые города,
  // чтобы невозможный маршрут нельзя было и собрать.
  const toCityChips: readonly ChipOption<string>[] =
    form.fromCity === ''
      ? cityChips
      : destinationsFrom(form.fromCity).map((city) => ({ value: city.name, label: city.name }));

  const pickFromCity = (value: string): void => {
    update('fromCity', value);
    if (value !== '' && form.toCity !== '' && !isKnownRoute(value, form.toCity)) {
      update('toCity', '');
    }
  };

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
          Те же «таблетки», что в поиске. Городов три, набор закрытый —
          выпадающий список здесь был лишним шагом: открыть, выбрать,
          закрыть вместо одного касания. Заодно оба города видны рядом, и
          маршрут читается целиком, а не двумя полями через форму.
        */}
        <FormItem
          top="Откуда"
          status={errors['fromCity'] === undefined ? 'default' : 'error'}
          bottom={errors['fromCity']}
        >
          <FilterChips
            ariaLabel="Город отправления"
            options={cityChips}
            value={form.fromCity}
            onChange={pickFromCity}
          />
        </FormItem>

        <FormItem
          top="Куда"
          status={errors['toCity'] === undefined ? 'default' : 'error'}
          bottom={errors['toCity']}
        >
          <FilterChips
            ariaLabel="Город назначения"
            options={toCityChips}
            value={form.toCity}
            onChange={(value) => {
              update('toCity', value);
            }}
          />
        </FormItem>

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
