import { Card, Div, Skeleton } from '@vkontakte/vkui';
import type { ReactNode } from 'react';

/** Скелетон повторяет раскладку TripCard, чтобы список не «прыгал». */
export function TripCardSkeleton(): ReactNode {
  return (
    <Card mode="shadow">
      <Div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <Skeleton width="55%" height={22} />
          <Skeleton width="25%" height={22} />
        </div>
        <Skeleton width="45%" height={18} />
        <Skeleton width="70%" height={18} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Skeleton width={28} height={28} borderRadius="50%" />
          <Skeleton width="40%" height={16} />
        </div>
      </Div>
    </Card>
  );
}
