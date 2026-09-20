import { Icon56ErrorOutline } from '@vkontakte/icons';
import { Button, Placeholder } from '@vkontakte/vkui';
import type { ReactNode } from 'react';

import type { ApiRequestError } from '../api/client.js';

/**
 * Отдельное состояние для сетевых сбоев: пользователю нужна кнопка
 * «Повторить», а не текст ошибки.
 */
export function ErrorState({
  error,
  onRetry,
}: {
  error: ApiRequestError;
  onRetry: () => void;
}): ReactNode {
  const isNetwork = error.isNetwork;

  return (
    <Placeholder
      icon={<Icon56ErrorOutline />}
      title={isNetwork ? 'Нет связи' : 'Не получилось загрузить'}
      action={
        <Button size="m" onClick={onRetry}>
          Повторить
        </Button>
      }
    >
      {isNetwork
        ? 'Проверьте интернет и попробуйте ещё раз.'
        : error.message}
    </Placeholder>
  );
}
