import {
  buildTelUrl,
  buildTelegramDialogUrl,
  formatPhone,
  type UserPublic,
} from '@vk-rideshare/shared';
import {
  Icon20CopyOutline,
  Icon20LogoVk,
  Icon20PhoneOutline,
  Icon20Send,
} from '@vkontakte/icons';
import { Button, Caption, Div } from '@vkontakte/vkui';
import type { ReactNode } from 'react';

import { useSnackbar } from '../lib/SnackbarContext.js';
import { copyText, getCallMode } from '../platform/phone-call.js';
import { openTelegramDialog } from '../platform/telegram-sdk.js';
import { buildProfileUrl } from '../vk/bridge.js';

/**
 * Главная кнопка связи по номеру.
 *
 * Как именно она звонит, решает platform/phone-call.ts: обычная ссылка
 * tel: работает только там, где приложение — верхний документ. Во фрейме
 * браузерной версии ВКонтакте такой переход запрещён политикой страницы, и
 * приложение целиком подменялось страницей ошибки — за это модерация и
 * отклонила версию. На компьютере кнопка копирует номер: позвонить с него
 * всё равно нечем.
 */
function CallButton({ phone }: { phone: string }): ReactNode {
  const snackbar = useSnackbar();
  const mode = getCallMode();

  if (mode === 'copy') {
    return (
      <Button
        size="l"
        stretched
        before={<Icon20CopyOutline />}
        onClick={() => {
          void copyText(phone).then((copied) => {
            if (copied) {
              snackbar.showSuccess(`Номер ${formatPhone(phone)} скопирован`);
            } else {
              snackbar.showError('Не удалось скопировать — номер написан под кнопкой');
            }
          });
        }}
      >
        Скопировать номер
      </Button>
    );
  }

  return (
    <Button
      size="l"
      stretched
      before={<Icon20PhoneOutline />}
      href={buildTelUrl(phone)}
      {...(mode === 'dial-new-window' ? { target: '_blank', rel: 'noreferrer' } : {})}
    >
      Позвонить
    </Button>
  );
}

/**
 * Способы связаться с человеком: звонок, страница ВКонтакте, диалог в
 * Telegram.
 *
 * Звонок стоит отдельной строкой и во всю ширину не из эстетики:
 * договариваются о поездке почти всегда по телефону, а переписка —
 * запасной путь для тех, кто номер не указал.
 *
 * Кнопки, которой не на что вести, нет вовсе: нет номера — нет
 * «Позвонить» (на компьютере — «Скопировать номер»), нет страницы
 * ВКонтакте — нет «Профиля», нет @username в
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
      {phone !== null && <CallButton phone={phone} />}

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
