import type { UserProfileResponse } from '@vk-rideshare/shared';
import { Avatar, Caption, Div, Footer, Group, Header, Headline, SimpleCell } from '@vkontakte/vkui';
import type { ReactNode } from 'react';

import { formatDate, formatRating, fullName } from '../lib/format.js';
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
        {/* Те же плитки, что на экране поездки: одинаковые приёмы на разных
            экранах и дают ощущение одного приложения, а не набора форм. */}
        <Div style={{ display: 'flex', gap: 'var(--app-space-2)' }}>
          <div className="app-tile">
            <Caption level="1" weight="2" className="app-field-label">
              Рейтинг
            </Caption>
            <Headline level="1" weight="1">
              {formatRating(profile.user.ratingAvg, profile.user.ratingCount)}
            </Headline>
          </div>
          <div className="app-tile">
            <Caption level="1" weight="2" className="app-field-label">
              Поездок
            </Caption>
            {/* В плитке только число: подпись сверху уже говорит, чего оно. */}
            <Headline level="1" weight="1">
              {profile.completedTripsCount}
            </Headline>
          </div>
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
