import { REPORT_TARGET, type UserProfileResponse } from '@vk-rideshare/shared';
import { Icon16ReportOutline } from '@vkontakte/icons';
import {
  Avatar,
  Caption,
  Div,
  Footer,
  Group,
  Header,
  Headline,
  IconButton,
  SimpleCell,
} from '@vkontakte/vkui';
import type { ReactNode } from 'react';

import { formatDate, formatRating, fullName } from '../lib/format.js';
import { useReport } from '../lib/ReportContext.js';
import { useSession } from '../lib/SessionContext.js';
import { RatingBadge } from './RatingBadge.js';

/** Общая «начинка» профиля: свой и чужой отличаются только шапкой. */
export function UserProfileBody({
  profile,
  onOpenUser,
}: {
  profile: UserProfileResponse;
  onOpenUser?: (userId: string) => void;
}): ReactNode {
  const report = useReport();
  const session = useSession();

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
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--app-space-2)',
                  }}
                >
                  <RatingBadge ratingAvg={review.rating} ratingCount={1} withCount={false} />
                  {/*
                    Жалоба на отзыв стоит здесь, а не на отдельном экране
                    отзыва: экрана отзыва нет, а текст написан человеком и
                    опубликован сразу. Свой отзыв обжаловать нечего, и
                    кнопки у него нет.
                  */}
                  {session.user?.id !== review.author.id && (
                    <IconButton
                      aria-label="Пожаловаться на отзыв"
                      onClick={(event) => {
                        // Строка целиком ведёт в профиль автора; нажатие
                        // по кнопке не должно заодно открывать его.
                        event.stopPropagation();
                        report.open({
                          target: REPORT_TARGET.REVIEW,
                          id: review.id,
                          title: `Отзыв от ${fullName(review.author)}`,
                        });
                      }}
                    >
                      <Icon16ReportOutline
                        style={{ color: 'var(--vkui--color_icon_secondary)' }}
                      />
                    </IconButton>
                  )}
                </div>
              }
              {...(onOpenUser === undefined
                ? {}
                : {
                    onClick: () => {
                      onOpenUser(review.author.id);
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
