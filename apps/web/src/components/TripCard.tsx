import type { TripSummary } from '@vk-rideshare/shared';
import {
  Icon16ClockOutline,
  Icon20ArrowRightOutline,
  Icon20CarOutline,
  Icon20HandOutline,
  Icon20UsersOutline,
} from '@vkontakte/icons';
import { Avatar, Caption, Card, Headline, Subhead, Text } from '@vkontakte/vkui';
import type { ReactNode } from 'react';

import {
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
   * само по себе между рендерами, и React вправе на этом споткнуться.
   * Источник — useNow() на уровне экрана.
   */
  now: number;
  onClick: () => void;
}): ReactNode {
  const isDriver = trip.role === 'DRIVER';
  const at = new Date(now);
  const state = stateBadge(trip);
  // Прошедшая или закрытая поездка не должна спорить за внимание с живыми.
  const isDimmed = state !== null;

  const seatsTone: BadgeTone = trip.seatsLeft === 0 ? 'negative' : 'neutral';

  return (
    <Card mode="shadow" onClick={onClick} style={{ cursor: 'pointer' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: 16,
          opacity: isDimmed ? 0.6 : 1,
        }}
      >
        {/* Когда и почём — то, по чему ленту просматривают по диагонали. */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
            <Subhead weight="2" style={{ color: 'var(--vkui--color_text_secondary)' }}>
              {formatDayLabel(trip.departAt, at)}
            </Subhead>
            <Headline level="1" weight="1">
              {formatTime(trip.departAt)}
            </Headline>
          </span>
          <Headline
            level="1"
            weight="1"
            style={{ whiteSpace: 'nowrap', color: 'var(--vkui--color_text_accent_themed)' }}
          >
            {formatPrice(trip.priceRub)}
          </Headline>
        </div>

        {/* Маршрут. Стрелка — иконкой, чтобы её цвет и размер задавались
            темой, а не начертанием системного шрифта. Экранному диктору
            иконка ничего не скажет, поэтому у строки есть aria-label. */}
        <div
          aria-label={`${trip.fromCity} → ${trip.toCity}`}
          style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
        >
          <Text weight="2">{trip.fromCity}</Text>
          <Icon20ArrowRightOutline
            width={16}
            height={16}
            style={{ color: 'var(--vkui--color_icon_secondary)' }}
          />
          <Text weight="2">{trip.toCity}</Text>
        </div>

        {(trip.fromPoint !== null || trip.toPoint !== null) && (
          <Caption level="1" style={{ color: 'var(--vkui--color_text_secondary)' }}>
            {[
              trip.fromPoint === null ? null : `от: ${trip.fromPoint}`,
              trip.toPoint === null ? null : `до: ${trip.toPoint}`,
            ]
              .filter((part) => part !== null)
              .join(' · ')}
          </Caption>
        )}

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

          <Badge tone={seatsTone} icon={<Icon20UsersOutline width={16} height={16} />}>
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
            gap: 8,
            paddingTop: 10,
            borderTop: '1px solid var(--vkui--color_separator_primary)',
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
    </Card>
  );
}
