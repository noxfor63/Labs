import {
  buildTelUrl,
  buildTelegramDialogUrl,
  formatPhone,
  type UserPublic,
} from '@vk-rideshare/shared';
import { Icon20LogoVk, Icon20PhoneOutline, Icon20Send } from '@vkontakte/icons';
import { Button, Caption, Div } from '@vkontakte/vkui';
import type { ReactNode } from 'react';

import { openTelegramDialog } from '../platform/telegram-sdk.js';
import { buildProfileUrl } from '../vk/bridge.js';

/**
 * Способы связаться с человеком: звонок, страница ВКонтакте, диалог в
 * Telegram.
 *
 * Звонок стоит отдельной строкой и во всю ширину не из эстетики:
 * договариваются о поездке почти всегда по телефону, а переписка —
 * запасной путь для тех, кто номер не указал.
 *
 * Кнопки, которой не на что вести, нет вовсе: нет номера — нет
 * «Позвонить», нет страницы ВКонтакте — нет «Профиля», нет @username в
 * Telegram — нет «Написать». Неактивная кнопка, по которой нельзя
 * понять почему, раздражает сильнее, чем её отсутствие.
 */
export function ContactButtons({ user }: { user: UserPublic }): ReactNode {
  const phone = user.phone !== null && user.phone !== '' ? user.phone : null;
  /*
   * Страница ВКонтакте есть не у всех: пришедший только из Telegram
   * собеседник её не имеет. Диалог Telegram — наоборот.
   */
  const vkUserId = user.vkUserId;
  const telegramUrl = buildTelegramDialogUrl(user.tgUsername);

  if (phone === null && vkUserId === null && telegramUrl === null) {
    return null;
  }

  return (
    <Div>
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

      {(vkUserId !== null || telegramUrl !== null) && (
        <div style={{ display: 'flex', gap: 8, marginTop: phone === null ? 0 : 8 }}>
          {vkUserId !== null && (
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
              href={buildProfileUrl(vkUserId)}
              target="_blank"
              rel="noreferrer"
            >
              Профиль
            </Button>
          )}

          {telegramUrl !== null && (
            <Button
              size="l"
              mode="secondary"
              stretched
              /*
                Бумажный самолётик, а не карандаш: логотипа Telegram в
                наборе иконок ВКонтакте нет по понятным причинам, а
                самолётик узнаётся как Telegram и без подписи.
              */
              before={<Icon20Send />}
              href={telegramUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                /*
                 * Внутри Telegram ссылку открывает сам клиент — иначе
                 * встроенный браузер покажет веб-страницу t.me с лишней
                 * кнопкой «Open in Telegram». Не вышло — остаётся обычный
                 * переход по href, он и так работает.
                 */
                if (openTelegramDialog(telegramUrl)) {
                  event.preventDefault();
                }
              }}
            >
              Написать
            </Button>
          )}
        </div>
      )}

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
