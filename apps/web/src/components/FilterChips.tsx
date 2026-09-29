import { Caption } from '@vkontakte/vkui';
import type { ReactNode } from 'react';

export type ChipOption<T extends string> = {
  value: T;
  label: string;
};

/**
 * Строка фильтров-«таблеток» с горизонтальной прокруткой.
 *
 * Направлений в приложении всего шесть, и выпадающий список под такой
 * замкнутый набор — лишний шаг: два касания вместо одного и невозможность
 * увидеть все варианты разом.
 *
 * Пара токенов accent_themed + text_contrast_themed выбрана не случайно:
 * в тёмной теме они меняются местами (белый фон, чёрный текст), поэтому
 * контраст сохраняется без отдельной ветки под тему.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}): ReactNode {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        // Прокрутка должна доходить до края экрана, а содержимое —
        // начинаться по общей сетке отступов.
        padding: '4px 16px 8px',
        margin: '0 -16px',
        scrollbarWidth: 'none',
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              onChange(option.value);
            }}
            style={{
              flex: '0 0 auto',
              border: 'none',
              cursor: 'pointer',
              padding: '7px 12px',
              borderRadius: 10,
              background: selected
                ? 'var(--vkui--color_background_accent_themed)'
                : 'var(--vkui--color_background_secondary)',
              color: selected
                ? 'var(--vkui--color_text_contrast_themed)'
                : 'var(--vkui--color_text_primary)',
            }}
          >
            <Caption level="1" weight={selected ? '1' : '2'}>
              {option.label}
            </Caption>
          </button>
        );
      })}
    </div>
  );
}
