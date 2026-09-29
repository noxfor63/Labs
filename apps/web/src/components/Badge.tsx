import { Caption } from '@vkontakte/vkui';
import type { CSSProperties, ReactNode } from 'react';

/**
 * Маленькая плашка-ярлык: роль в поездке, число мест, состояние.
 *
 * Своя, а не из VKUI: штатный Chip умеет удаление и вход в фокус, то есть
 * ведёт себя как элемент управления. Здесь же нужен именно нечитаемый
 * клавиатурой декоративный ярлык внутри кликабельной карточки — вложенный
 * интерактивный элемент ломал бы и фокус, и клик по карточке.
 */
export type BadgeTone = 'neutral' | 'positive' | 'accent' | 'negative' | 'muted';

const TONE_STYLE: Record<BadgeTone, CSSProperties> = {
  neutral: {
    background: 'var(--vkui--color_background_secondary)',
    color: 'var(--vkui--color_text_secondary)',
  },
  positive: {
    background: 'var(--vkui--color_background_positive_tint)',
    color: 'var(--vkui--color_text_positive)',
  },
  accent: {
    background: 'var(--vkui--color_background_secondary)',
    color: 'var(--vkui--color_text_accent_themed)',
  },
  negative: {
    background: 'var(--vkui--color_background_negative_tint)',
    color: 'var(--vkui--color_text_negative)',
  },
  muted: {
    background: 'transparent',
    color: 'var(--vkui--color_text_subhead)',
    boxShadow: 'inset 0 0 0 1px var(--vkui--color_separator_primary)',
  },
};

export function Badge({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 8,
        // Иконка рисуется currentColor, поэтому цвет тона достаётся ей даром.
        ...TONE_STYLE[tone],
      }}
    >
      {icon}
      <Caption level="1" weight="2">
        {children}
      </Caption>
    </span>
  );
}
