import { buildTelUrl, formatPhone, type UserPublic } from '@vk-rideshare/shared';
import { Icon20LogoVk, Icon20PhoneOutline } from '@vkontakte/icons';
import { Button, Caption, Div } from '@vkontakte/vkui';
import type { ReactNode } from 'react';

import { buildProfileUrl } from '../vk/bridge.js';

/**
 * Способы связаться с человеком: страница ВКонтакте и звонок.
 *
 * Кнопки рядом и равной ширины. Если номер не указан — «Позвонить» нет
 * вовсе, а кнопка профиля занимает всю строку: неактивная кнопка, по
 * которой нельзя понять почему, раздражает сильнее, чем её отсутствие.
 *
 * Диалог ВКонтакте открыть напрямую нельзя — подтверждённого метода в
 * VK Bridge нет, поэтому ведём на профиль.
 */
export function ContactButtons({ user }: { user: UserPublic }): ReactNode {
  const phone = user.phone !== null && user.phone !== '' ? user.phone : null;

  return (
    <Div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          size="l"
          mode="secondary"
          stretched
          before={
            /*
             * Цвет логотипа ВКонтакте закреплён явно. Иконка рисуется
             * currentColor, то есть по умолчанию берёт цвет кнопки, а он
             * у нас коралловый — и фирменный знак чужого бренда
             * перекрашивался в наш акцент. Токен accent_azure — это
             * синий ВКонтакте (#07f), и он не входит в набор акцентных,
             * которые мы переопределяем.
             */
            <Icon20LogoVk
              width={20}
              height={20}
              style={{ color: 'var(--vkui--color_accent_azure)' }}
            />
          }
          href={buildProfileUrl(user.vkUserId)}
          target="_blank"
          rel="noreferrer"
        >
          Профиль
        </Button>

        {phone !== null && (
          <Button
            size="l"
            stretched
            before={<Icon20PhoneOutline />}
            href={buildTelUrl(phone)}
          >
            Позвонить
          </Button>
        )}
      </div>

      {phone !== null && (
        <Caption
          level="1"
          style={{
            display: 'block',
            marginTop: 8,
            textAlign: 'center',
            color: 'var(--vkui--color_text_secondary)',
          }}
        >
          {formatPhone(phone)}
        </Caption>
      )}
    </Div>
  );
}
