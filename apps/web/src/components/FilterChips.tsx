import { Caption } from '@vkontakte/vkui';
import type { ReactNode } from 'react';

export type ChipOption<T extends string> = {
  value: T;
  label: string;
};

/**
 * Строка фильтров-«таблеток».
 *
 * Переносится на новую строку, а не прокручивается вбок: прокрутку надо
 * заметить, а варианты за краем экрана обычно просто не находят.
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
        flexWrap: 'wrap',
        gap: 6,
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
              padding: '6px 11px',
              borderRadius: 9,
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
