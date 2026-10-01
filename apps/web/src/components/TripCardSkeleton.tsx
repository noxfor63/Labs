import { Skeleton } from '@vkontakte/vkui';
import type { ReactNode } from 'react';

/** Скелетон повторяет раскладку TripCard, чтобы список не «прыгал». */
export function TripCardSkeleton(): ReactNode {
  return (
    <div
      className="app-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--app-space-3)',
        padding: 'var(--app-space-4)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--app-space-3)' }}>
        <Skeleton width="58%" height={22} />
        <Skeleton width="22%" height={22} />
      </div>
      <Skeleton width="42%" height={16} />
      <div style={{ display: 'flex', gap: 6 }}>
        <Skeleton width="34%" height={24} borderRadius={8} />
        <Skeleton width="40%" height={24} borderRadius={8} />
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
        <Skeleton width={28} height={28} borderRadius="50%" />
        <Skeleton width="40%" height={16} />
      </div>
    </div>
  );
}
