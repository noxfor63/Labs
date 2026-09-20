import {
  CITIES_ALPHABETICAL,
  LIMITS,
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
import { toDateInputValue } from '../lib/format.js';
import { useSnackbar } from '../lib/SnackbarContext.js';

const cityOptions = CITIES_ALPHABETICAL.map((city) => ({ value: city.name, label: city.name }));

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
};

const emptyForm = (): FormState => ({
  role: 'DRIVER',
  fromCity: '',
  fromPoint: '',
  toCity: '',
  toPoint: '',
  date: toDateInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000)),
  time: '09:00',
  seatsTotal: '3',
  priceRub: '',
  carModel: '',
  comment: '',
});

/** Локальная проверка — чтобы не гонять заведомо плохую форму на сервер. */
function validate(form: FormState): { errors: FieldErrors; departAt: Date | null } {
  const errors: FieldErrors = {};

  if (form.fromCity === '') {
    errors['fromCity'] = 'Выберите город отправления';
  }
  if (form.toCity === '') {
    errors['toCity'] = 'Выберите город назначения';
  }
  if (
    form.fromCity !== '' &&
    form.fromCity === form.toCity &&
    form.fromPoint.trim() === form.toPoint.trim()
  ) {
    errors['toCity'] = 'Пункты отправления и назначения должны различаться';
  }

  let departAt: Date | null = null;
  if (form.date === '' || form.time === '') {
    errors['date'] = 'Укажите дату и время';
  } else {
    departAt = new Date(`${form.date}T${form.time}`);
    if (Number.isNaN(departAt.getTime())) {
      errors['date'] = 'Некорректная дата';
      departAt = null;
    } else if (departAt.getTime() <= Date.now()) {
      errors['date'] = 'Дата отправления должна быть в будущем';
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

  if (form.priceRub !== '') {
    const price = Number(form.priceRub);
    if (!Number.isInteger(price) || price < 0 || price > LIMITS.PRICE_MAX) {
      errors['priceRub'] = `От 0 до ${LIMITS.PRICE_MAX}`;
    }
  }

  return { errors, departAt };
}

export function CreatePanel({ id }: { id: string }): ReactNode {
  const routeNavigator = useRouteNavigator();
  const snackbar = useSnackbar();

  const [form, setForm] = useState<FormState>(emptyForm);
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

  const submit = async (): Promise<void> => {
    const { errors: found, departAt } = validate(form);
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
      priceRub: form.priceRub === '' ? null : Number(form.priceRub),
      carModel: form.carModel.trim() === '' ? null : form.carModel.trim(),
      comment: form.comment.trim() === '' ? null : form.comment.trim(),
    };

    setIsSubmitting(true);
    try {
      const trip = await api.createTrip(input);
      snackbar.showSuccess('Поездка опубликована');
      setForm(emptyForm());
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
        <FormItem
          top="Откуда"
          status={errors['fromCity'] === undefined ? 'default' : 'error'}
          bottom={errors['fromCity']}
        >
          <CustomSelect
            placeholder="Выберите город"
            searchable
            options={cityOptions}
            value={form.fromCity === '' ? null : form.fromCity}
            onChange={(_, value) => {
              update('fromCity', value === null ? '' : String(value));
            }}
          />
        </FormItem>
        <FormItem top="Место сбора (необязательно)">
          <Input
            maxLength={LIMITS.POINT_MAX}
            placeholder="Например, метро Тёплый Стан"
            value={form.fromPoint}
            onChange={(event) => {
              update('fromPoint', event.target.value);
            }}
          />
        </FormItem>

        <FormItem
          top="Куда"
          status={errors['toCity'] === undefined ? 'default' : 'error'}
          bottom={errors['toCity']}
        >
          <CustomSelect
            placeholder="Выберите город"
            searchable
            options={cityOptions}
            value={form.toCity === '' ? null : form.toCity}
            onChange={(_, value) => {
              update('toCity', value === null ? '' : String(value));
            }}
          />
        </FormItem>
        <FormItem top="Место высадки (необязательно)">
          <Input
            maxLength={LIMITS.POINT_MAX}
            placeholder="Например, автовокзал"
            value={form.toPoint}
            onChange={(event) => {
              update('toPoint', event.target.value);
            }}
          />
        </FormItem>
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
          <FormItem top="Время">
            <Input
              type="time"
              value={form.time}
              onChange={(event) => {
                update('time', event.target.value);
              }}
            />
          </FormItem>
        </FormLayoutGroup>

        <FormLayoutGroup mode="horizontal">
          <FormItem
            top={isDriver ? 'Свободных мест' : 'Сколько вас едет'}
            status={errors['seatsTotal'] === undefined ? 'default' : 'error'}
            bottom={errors['seatsTotal']}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={LIMITS.SEATS_MIN}
              max={LIMITS.SEATS_MAX}
              value={form.seatsTotal}
              onChange={(event) => {
                update('seatsTotal', event.target.value);
              }}
            />
          </FormItem>
          <FormItem
            top="Цена с человека, ₽"
            status={errors['priceRub'] === undefined ? 'default' : 'error'}
            bottom={errors['priceRub'] ?? 'Можно не указывать'}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={LIMITS.PRICE_MAX}
              placeholder="Договоримся"
              value={form.priceRub}
              onChange={(event) => {
                update('priceRub', event.target.value);
              }}
            />
          </FormItem>
        </FormLayoutGroup>

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
