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
 * Вид задаётся классами .app-chip и .app-chip--on в styles/app.css —
 * там же, где отступы и радиусы остальных поверхностей.
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
        gap: 'var(--app-space-2)',
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            className={selected ? 'app-chip app-chip--on' : 'app-chip'}
            onClick={() => {
              onChange(option.value);
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
