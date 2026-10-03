import type { TripSummary } from '@vk-rideshare/shared';
import {
  Icon16ClockOutline,
  Icon20ArrowRightOutline,
  Icon20CarOutline,
  Icon20HandOutline,
  Icon20UsersOutline,
} from '@vkontakte/icons';
import { Avatar, Caption, Headline, Subhead } from '@vkontakte/vkui';
import type { ReactNode } from 'react';

import {
  dayTimeSeparator,
  formatDayLabel,
  formatPrice,
  formatSeats,
  formatTime,
  fullName,
} from '../lib/format.js';
import { Badge, type BadgeTone } from './Badge.js';
import { RatingBadge } from './RatingBadge.js';

/** Подпись состояния поездки. null — поездка живая, плашка не нужна. */
function stateBadge(trip: TripSummary): { tone: BadgeTone; label: string } | null {
  if (trip.status === 'CANCELLED') {
    return { tone: 'muted', label: 'Отменена' };
  }
  if (trip.status === 'COMPLETED') {
    return { tone: 'muted', label: 'Завершена' };
  }
  if (trip.isExpired) {
    return { tone: 'muted', label: 'Время вышло' };
  }
  return null;
}

export function TripCard({
  trip,
  now,
  onClick,
}: {
  trip: TripSummary;
  /**
   * Текущее время миллисекундами. Приходит извне, а не берётся здесь
   * через Date.now(): вызов в теле рендера нечист — значение меняется
   * само по себе между рендерами. Источник — useNow() на уровне экрана.
   */
  now: number;
  onClick: () => void;
}): ReactNode {
  const isDriver = trip.role === 'DRIVER';
  const state = stateBadge(trip);
  const at = new Date(now);
  const dayLabel = formatDayLabel(trip.departAt, at);

  const points = [
    trip.fromPoint === null ? null : `от: ${trip.fromPoint}`,
    trip.toPoint === null ? null : `до: ${trip.toPoint}`,
  ].filter((part) => part !== null);

  return (
    <div
      className="app-card app-card--tappable"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--app-space-3)',
        padding: 'var(--app-space-4)',
        // Прошедшая или закрытая поездка не должна спорить за внимание с живыми.
        opacity: state === null ? 1 : 0.55,
      }}
    >
      {/* Маршрут и цена на одной линии: по ним ленту просматривают по диагонали. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--app-space-3)' }}>
        <div
          aria-label={`${trip.fromCity} → ${trip.toCity}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 6,
            flex: 1,
            minWidth: 0,
          }}
        >
          <Headline level="1" weight="2">
            {trip.fromCity}
          </Headline>
          {/* Стрелка иконкой: её цвет и размер задаёт тема, а не системный шрифт. */}
          <Icon20ArrowRightOutline
            width={16}
            height={16}
            style={{ color: 'var(--vkui--color_icon_secondary)' }}
          />
          <Headline level="1" weight="2">
            {trip.toCity}
          </Headline>
        </div>

        {/* Цена — акцентом. Берётся через --app-accent, а не через
            accent_themed: второй используется как заливка, и текст им
            красить нельзя — в тёмной теме он задуман светлым под тёмную
            надпись, а здесь нужен ровно наоборот. */}
        <Headline
          level="1"
          weight="2"
          style={{ whiteSpace: 'nowrap', color: 'var(--app-accent)' }}
        >
          {formatPrice(trip.priceRub)}
        </Headline>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-space-1)' }}>
        <Subhead style={{ color: 'var(--vkui--color_text_secondary)' }}>
          {`${dayLabel}${dayTimeSeparator(dayLabel)}`}
          <span style={{ fontWeight: 600, color: 'var(--vkui--color_text_primary)' }}>
            {formatTime(trip.departAt)}
          </span>
        </Subhead>

        {points.length > 0 && (
          <Caption level="1" style={{ color: 'var(--vkui--color_text_secondary)' }}>
            {points.join(' · ')}
          </Caption>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Badge
          tone={isDriver ? 'positive' : 'accent'}
          icon={
            isDriver ? (
              <Icon20CarOutline width={16} height={16} />
            ) : (
              <Icon20HandOutline width={16} height={16} />
            )
          }
        >
          {isDriver ? 'За рулём' : 'Ищет водителя'}
        </Badge>

        <Badge
          tone={trip.seatsLeft === 0 ? 'negative' : 'neutral'}
          icon={<Icon20UsersOutline width={16} height={16} />}
        >
          {trip.seatsLeft > 0 ? `Свободно ${formatSeats(trip.seatsLeft)}` : 'Мест нет'}
        </Badge>

        {state !== null && (
          <Badge tone={state.tone} icon={<Icon16ClockOutline />}>
            {state.label}
          </Badge>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--app-space-2)',
          paddingTop: 'var(--app-space-3)',
          borderTop: 'var(--app-hairline)',
        }}
      >
        <Avatar size={28} src={trip.author.photoUrl ?? undefined} />
        <Caption level="1" style={{ flex: 1, minWidth: 0 }}>
          {fullName(trip.author)}
        </Caption>
        <RatingBadge
          ratingAvg={trip.author.ratingAvg}
          ratingCount={trip.author.ratingCount}
          withCount={false}
        />
      </div>
    </div>
  );
}
