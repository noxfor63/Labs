import { LIMITS } from '@vk-rideshare/shared';
import {
  useActiveVkuiLocation,
  useParams,
  useRouteNavigator,
} from '@vkontakte/vk-mini-apps-router';
import {
  Avatar,
  Button,
  Div,
  Footer,
  FormItem,
  ModalPage,
  ModalPageHeader,
  PanelSpinner,
  Placeholder,
  SegmentedControl,
  SimpleCell,
  Spacing,
  Textarea,
} from '@vkontakte/vkui';
import { useCallback, useState, type ReactNode } from 'react';

import { ApiRequestError, api } from '../api/client.js';
import { ErrorState } from '../components/ErrorState.js';
import { fullName } from '../lib/format.js';
import { useAsync } from '../lib/useAsync.js';
import { useSnackbar } from '../lib/SnackbarContext.js';

const RATINGS = ['1', '2', '3', '4', '5'] as const;

export function ReviewModal({ id }: { id: string }): ReactNode {
  const routeNavigator = useRouteNavigator();
  const { modal: activeModal } = useActiveVkuiLocation();
  const params = useParams<'tripId'>();
  const tripId = params?.tripId ?? '';
  const snackbar = useSnackbar();
  // ModalRoot держит все модалки в дереве; грузим данные только у открытой.
  const isActive = activeModal === id && tripId !== '';

  const [targetId, setTargetId] = useState<string | null>(null);
  const [rating, setRating] = useState<string>('5');
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loader = useCallback(
    (signal: AbortSignal) => api.reviewable(tripId, signal),
    [tripId],
  );
  const { data, isLoading, error, reload } = useAsync(loader, { enabled: isActive });

  const submit = async (): Promise<void> => {
    if (targetId === null) {
      return;
    }
    setIsSubmitting(true);
    try {
      await api.createReview({
        tripId,
        targetId,
        rating: Number(rating),
        text: text.trim() === '' ? null : text.trim(),
      });
      snackbar.showSuccess('Спасибо! Отзыв опубликован');
      await routeNavigator.hideModal();
    } catch (caught) {
      snackbar.showError(
        caught instanceof ApiRequestError ? caught.message : 'Не удалось отправить отзыв',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const header = <ModalPageHeader>Отзыв о поездке</ModalPageHeader>;

  if (isLoading) {
    return (
      <ModalPage id={id} header={header}>
        <PanelSpinner />
      </ModalPage>
    );
  }

  if (error !== null || data === null) {
    return (
      <ModalPage id={id} header={header}>
        {error !== null ? (
          <ErrorState error={error} onRetry={reload} />
        ) : (
          <Placeholder title="Поездка недоступна" />
        )}
      </ModalPage>
    );
  }

  const pending = data.participants.filter(
    (participant) => !data.alreadyReviewedUserIds.includes(participant.id),
  );

  if (pending.length === 0) {
    return (
      <ModalPage id={id} header={header}>
        <Placeholder title="Все отзывы уже оставлены">
          По этой поездке вы всем поставили оценку.
        </Placeholder>
      </ModalPage>
    );
  }

  return (
    <ModalPage id={id} header={header}>
      <Footer>
        {`${data.trip.fromCity} → ${data.trip.toCity}`}
      </Footer>

      <FormItem top="Кому оставляете отзыв">
        {pending.map((participant) => (
          <SimpleCell
            key={participant.id}
            before={<Avatar size={40} src={participant.photoUrl ?? undefined} />}
            subtitle={participant.id === targetId ? 'Выбран' : undefined}
            onClick={() => {
              setTargetId(participant.id);
            }}
            style={
              participant.id === targetId
                ? { background: 'var(--vkui--color_background_secondary)' }
                : undefined
            }
          >
            {fullName(participant)}
          </SimpleCell>
        ))}
      </FormItem>

      <FormItem top="Оценка">
        <SegmentedControl
          value={rating}
          onChange={(value) => {
            setRating(String(value));
          }}
          options={RATINGS.map((value) => ({ label: value, value }))}
        />
      </FormItem>

      <FormItem top="Комментарий (необязательно)">
        <Textarea
          maxLength={LIMITS.REVIEW_TEXT_MAX}
          placeholder="Как прошла поездка?"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </FormItem>

      <Div>
        <Button
          size="l"
          stretched
          loading={isSubmitting}
          disabled={isSubmitting || targetId === null}
          onClick={() => {
            void submit();
          }}
        >
          {targetId === null ? 'Выберите попутчика' : 'Отправить отзыв'}
        </Button>
      </Div>
      <Spacing size={8} />
    </ModalPage>
  );
}
