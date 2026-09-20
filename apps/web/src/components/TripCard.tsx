import type { TripSummary } from '@vk-rideshare/shared';
import { Icon20CarOutline, Icon20UsersOutline } from '@vkontakte/icons';
import { Avatar, Caption, Card, Div, Headline, Text } from '@vkontakte/vkui';
import type { ReactNode } from 'react';

import { formatDateTime, formatPrice, formatSeats, fullName } from '../lib/format.js';
import { RatingBadge } from './RatingBadge.js';

export function TripCard({
  trip,
  onClick,
}: {
  trip: TripSummary;
  onClick: () => void;
}): ReactNode {
  const isDriver = trip.role === 'DRIVER';

  return (
    <Card mode="shadow" onClick={onClick} style={{ cursor: 'pointer' }}>
      <Div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <Headline level="1" weight="2">
            {trip.fromCity} → {trip.toCity}
          </Headline>
          <Headline level="1" weight="2" style={{ whiteSpace: 'nowrap' }}>
            {formatPrice(trip.priceRub)}
          </Headline>
        </div>

        <Text style={{ color: 'var(--vkui--color_text_secondary)' }}>
          {formatDateTime(trip.departAt)}
        </Text>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            color: 'var(--vkui--color_text_secondary)',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon20CarOutline />
            <Caption level="1">{isDriver ? 'Водитель' : 'Ищет водителя'}</Caption>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon20UsersOutline />
            <Caption level="1">
              {trip.seatsLeft > 0 ? `Свободно ${formatSeats(trip.seatsLeft)}` : 'Мест нет'}
            </Caption>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <Avatar size={28} src={trip.author.photoUrl ?? undefined} />
          <Caption level="1">{fullName(trip.author)}</Caption>
          <RatingBadge
            ratingAvg={trip.author.ratingAvg}
            ratingCount={trip.author.ratingCount}
            withCount={false}
          />
        </div>
      </Div>
    </Card>
  );
}
