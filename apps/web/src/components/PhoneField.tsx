import { LIMITS, normalizePhone } from '@vk-rideshare/shared';
import { Icon16Phone } from '@vkontakte/icons';
import { Button, FormItem, Input } from '@vkontakte/vkui';
import { useState, type ReactNode } from 'react';

import { getPlatform } from '../platform/index.js';

/**
 * Поле номера телефона с подстановкой из профиля ВКонтакте.
 *
 * Кнопка подстановки показывается только внутри клиента ВКонтакте: вне
 * его мост не отвечает, и кнопка, которая заведомо ничего не сделает,
 * хуже, чем её отсутствие.
 */
export function PhoneField({
  value,
  onChange,
  error,
  top = 'Мобильный телефон',
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  top?: string;
}): ReactNode {
  const [isFetching, setIsFetching] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const platform = getPlatform();

  const pullFromPlatform = async (): Promise<void> => {
    setIsFetching(true);
    setHint(null);
    try {
      const raw = await platform.fetchPhone();
      if (raw === null) {
        setHint(`${platform.title} не отдал номер — введите его вручную`);
        return;
      }
      // Площадка возвращает номер в своём формате, приводим к единому виду.
      onChange(normalizePhone(raw) ?? raw);
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <FormItem
      top={top}
      status={error === undefined ? 'default' : 'error'}
      bottom={error ?? hint ?? 'Нужен, чтобы попутчики могли позвонить. Можно не указывать'}
    >
      <Input
        type="tel"
        inputMode="tel"
        maxLength={LIMITS.PHONE_MAX}
        placeholder="+7 999 123-45-67"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {/*
        Кнопка только там, где площадка умеет отдавать номер. У Telegram
        это делается через бота и явное согласие в диалоге, из
        мини-приложения номер не получить — значит и кнопки быть не должно:
        неактивная кнопка без объяснения раздражает сильнее, чем её
        отсутствие.
      */}
      {platform.id === 'vk' && (
        <Button
          mode="link"
          size="s"
          before={<Icon16Phone />}
          loading={isFetching}
          disabled={isFetching}
          style={{ marginTop: 8 }}
          onClick={() => {
            void pullFromPlatform();
          }}
        >
          Добавить номер из профиля VK
        </Button>
      )}
    </FormItem>
  );
}
