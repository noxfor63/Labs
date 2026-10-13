import type { TripSummary } from '@vk-rideshare/shared';
import { Icon28CloudSlashOutline, Icon28GlobeCrossOutline } from '@vkontakte/icons';
import {
  Button,
  Caption,
  Div,
  Footer,
  Group,
  Header,
  Panel,
  PanelHeader,
  Placeholder,
  Spacing,
  SplitCol,
  SplitLayout,
  Subhead,
  Text,
  View,
} from '@vkontakte/vkui';
import { useState, type ReactNode } from 'react';

import { ContactButtons } from './ContactButtons.js';
import { TripCard } from './TripCard.js';
import { formatDateTime, formatPrice, fullName } from '../lib/format.js';
import { readFeed } from '../lib/feedCache.js';
import { useNow } from '../lib/useNow.js';

/**
 * Экран, когда до сервера не достучаться.
 *
 * Отличается от обычной ошибки тем, что показывает сохранённый список
 * поездок с номерами телефонов. Смысл в этом и есть: мобильный интернет
 * могут ограничить, а голосовая связь при этом работает — значит,
 * человеку хватит номера, чтобы договориться о поездке без приложения.
 *
 * Чего здесь сознательно нет: создания поездки и откликов. Они требуют
 * сервера, и кнопка, которая заведомо не сработает, хуже её отсутствия.
 * Нажатие по карточке не ведёт на экран поездки по той же причине — он
 * тоже грузится с сервера; вместо перехода карточка разворачивается на
 * месте.
 */
export function OfflineScreen({ onRetry }: { onRetry: () => void }): ReactNode {
  const [snapshot] = useState(() => readFeed());
  const [openId, setOpenId] = useState<string | null>(null);
  // Не Date.now() в теле рендера: значение менялось бы само по себе.
  const now = useNow();

  const explanation = (
    <Group>
      <Placeholder
        icon={<Icon28GlobeCrossOutline width={56} height={56} />}
        title="Нет связи с сервером"
      >
        Так бывает, когда ограничен мобильный интернет: приложение открывается,
        а данные не загружаются. По Wi-Fi обычно работает.
      </Placeholder>
      <Div>
        <Button size="l" stretched onClick={onRetry}>
          Повторить
        </Button>
      </Div>
    </Group>
  );

  return (
    <SplitLayout center>
      <SplitCol width="100%" maxWidth={560} stretchedOnMobile autoSpaced>
        <View activePanel="offline">
          <Panel id="offline">
            <PanelHeader>По пути</PanelHeader>

            {explanation}

            {snapshot !== null && snapshot.items.length > 0 && (
              <Group header={<Header size="s">Сохранённые поездки</Header>}>
                {/*
                  Дата снимка — сразу под заголовком, а не внизу группы.
                  Внизу её прочитают после восемнадцати карточек, то есть
                  уже позвонив по той, которую отменили вчера.
                */}
                <Div style={{ paddingBottom: 0 }}>
                  <Caption level="1" style={{ color: 'var(--vkui--color_text_secondary)' }}>
                    {`Список загружен ${formatDateTime(snapshot.savedAt)}. С тех пор он мог измениться: места могли занять, поездку — отменить.`}
                  </Caption>
                </Div>

                <Div
                  style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-space-3)' }}
                >
                  {snapshot.items.map((trip) => (
                    <CachedTrip
                      key={trip.id}
                      trip={trip}
                      now={now}
                      isOpen={openId === trip.id}
                      onToggle={() => {
                        setOpenId((current) => (current === trip.id ? null : trip.id));
                      }}
                    />
                  ))}
                </Div>
                <Footer>
                  Позвонить можно и без интернета. Создать поездку или откликнуться —
                  только когда появится связь.
                </Footer>
                <Spacing size={8} />
              </Group>
            )}

            {(snapshot === null || snapshot.items.length === 0) && (
              <Group>
                <Placeholder icon={<Icon28CloudSlashOutline width={56} height={56} />}>
                  Сохранённых поездок нет: приложение не успело загрузить ленту до того,
                  как связь пропала.
                </Placeholder>
              </Group>
            )}
          </Panel>
        </View>
      </SplitCol>
    </SplitLayout>
  );
}

/** Карточка из снимка: по нажатию раскрывается, внутри — способы связи. */
function CachedTrip({
  trip,
  now,
  isOpen,
  onToggle,
}: {
  trip: TripSummary;
  now: number;
  isOpen: boolean;
  onToggle: () => void;
}): ReactNode {
  return (
    <div>
      <TripCard trip={trip} now={now} onClick={onToggle} />

      {isOpen && (
        <div className="app-tile" style={{ marginTop: 'var(--app-space-2)' }}>
          <Subhead weight="2">{fullName(trip.author)}</Subhead>
          <Caption level="1" style={{ color: 'var(--vkui--color_text_secondary)' }}>
            {`${trip.fromCity} → ${trip.toCity} · ${formatPrice(trip.priceRub)}`}
          </Caption>

          {(trip.fromPoint !== null || trip.toPoint !== null) && (
            <Text style={{ marginTop: 'var(--app-space-2)' }}>
              {[
                trip.fromPoint === null ? null : `Сбор: ${trip.fromPoint}`,
                trip.toPoint === null ? null : `Высадка: ${trip.toPoint}`,
              ]
                .filter((line) => line !== null)
                .join(' · ')}
            </Text>
          )}

          {trip.comment !== null && (
            <Text style={{ marginTop: 'var(--app-space-2)' }}>{trip.comment}</Text>
          )}

          <ContactButtons user={trip.author} />
        </div>
      )}
    </div>
  );
}
