import type { UserProfileResponse } from '@vk-rideshare/shared';
import { Avatar, Footer, Group, Header, InfoRow, SimpleCell, Div } from '@vkontakte/vkui';
import type { ReactNode } from 'react';

import { formatDate, formatRating, formatTrips, fullName } from '../lib/format.js';
import { RatingBadge } from './RatingBadge.js';

/** Общая «начинка» профиля: свой и чужой отличаются только шапкой. */
export function UserProfileBody({
  profile,
  onOpenUser,
}: {
  profile: UserProfileResponse;
  onOpenUser?: (vkUserId: string) => void;
}): ReactNode {
  return (
    <>
      <Group>
        <Div style={{ display: 'flex', gap: 24 }}>
          <InfoRow header="Рейтинг">
            {formatRating(profile.user.ratingAvg, profile.user.ratingCount)}
          </InfoRow>
          <InfoRow header="Завершено">{formatTrips(profile.completedTripsCount)}</InfoRow>
        </Div>
      </Group>

      <Group header={<Header size="s">Отзывы</Header>}>
        {profile.reviews.length === 0 ? (
          <Footer>Отзывов пока нет</Footer>
        ) : (
          profile.reviews.map((review) => (
            <SimpleCell
              key={review.id}
              multiline
              before={<Avatar size={40} src={review.author.photoUrl ?? undefined} />}
              subtitle={review.text ?? 'Без комментария'}
              after={
                <RatingBadge ratingAvg={review.rating} ratingCount={1} withCount={false} />
              }
              {...(onOpenUser === undefined
                ? {}
                : {
                    onClick: () => {
                      onOpenUser(review.author.vkUserId);
                    },
                  })}
            >
              {`${fullName(review.author)} · ${formatDate(review.createdAt)}`}
            </SimpleCell>
          ))
        )}
      </Group>
    </>
  );
}
