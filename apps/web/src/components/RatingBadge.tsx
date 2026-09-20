import { Icon16StarCircleFillYellow } from '@vkontakte/icons';
import { Caption } from '@vkontakte/vkui';
import type { ReactNode } from 'react';

import { formatRating, formatReviews } from '../lib/format.js';

export function RatingBadge({
  ratingAvg,
  ratingCount,
  withCount = true,
}: {
  ratingAvg: number;
  ratingCount: number;
  withCount?: boolean;
}): ReactNode {
  if (ratingCount === 0) {
    return <Caption level="1">Пока без оценок</Caption>;
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Icon16StarCircleFillYellow />
      <Caption level="1" weight="2">
        {formatRating(ratingAvg, ratingCount)}
      </Caption>
      {withCount && <Caption level="1">· {formatReviews(ratingCount)}</Caption>}
    </span>
  );
}
