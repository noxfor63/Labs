import { PRIVACY_POLICY_URL } from '@vk-rideshare/shared';
import {
  Button,
  Checkbox,
  Div,
  Group,
  Panel,
  PanelHeader,
  SplitCol,
  SplitLayout,
  Text,
  Title,
  View,
} from '@vkontakte/vkui';
import { useState, type ReactNode } from 'react';

import { ApiRequestError } from '../api/client.js';
import { useSession } from '../lib/SessionContext.js';

/**
 * Экран согласия с политикой конфиденциальности.
 *
 * Показывается один раз, до того как о человеке будет записана хоть одна
 * строка. Это не формальность и не украшение: правила мини-приложений
 * требуют согласия **до** обработки персональных данных, а приложение
 * получает имя, фотографию и город сразу при запуске.
 *
 * Поэтому экран блокирующий. Соблазн показать его «потом, когда дойдёт до
 * телефона» был, и он неверен: к моменту ввода телефона имя и город уже
 * обработаны.
 */
export function PrivacyGate(): ReactNode {
  const session = useSession();
  const [checked, setChecked] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async (): Promise<void> => {
    setIsSending(true);
    setError(null);
    try {
      await session.acceptPrivacy();
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : 'Не удалось сохранить согласие. Проверьте связь и попробуйте ещё раз.',
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <SplitLayout center>
      <SplitCol width="100%" maxWidth={560} stretchedOnMobile autoSpaced>
        <View activePanel="privacy">
          <Panel id="privacy">
            <PanelHeader>По пути</PanelHeader>

            <Group>
              <Div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-space-4)' }}>
                <Title level="2">Прежде чем начать</Title>

                <Text>
                  Приложение показывает попутчикам ваше имя, фотографию и город — иначе
                  непонятно, с кем вы едете. Если укажете номер телефона, он тоже будет
                  виден тем, кто откроет вашу карточку.
                </Text>

                <Text>
                  Что именно хранится, зачем и как это удалить — написано в политике
                  конфиденциальности. Она короткая.
                </Text>

                {/*
                  Ссылка отдельной строкой и крупно. Спрятать её в мелкий
                  текст под чекбоксом — ровно тот приём, из-за которого
                  согласие перестаёт быть осознанным.
                */}
                <Button
                  size="l"
                  mode="link"
                  href={PRIVACY_POLICY_URL}
                  target="_blank"
                  rel="noreferrer"
                  style={{ alignSelf: 'flex-start', paddingLeft: 0 }}
                >
                  Читать политику конфиденциальности
                </Button>

                <Checkbox
                  checked={checked}
                  onChange={(event) => {
                    setChecked(event.target.checked);
                    setError(null);
                  }}
                >
                  Я прочитал политику конфиденциальности и согласен с обработкой моих данных
                </Checkbox>

                {error !== null && (
                  <Text style={{ color: 'var(--vkui--color_text_negative)' }}>{error}</Text>
                )}

                <Button
                  size="l"
                  stretched
                  loading={isSending}
                  disabled={!checked || isSending}
                  onClick={() => {
                    void accept();
                  }}
                >
                  Продолжить
                </Button>

                <Text style={{ color: 'var(--vkui--color_text_secondary)' }}>
                  Без согласия приложение не сохранит о вас ничего — и работать не сможет.
                  Закройте его, если не согласны.
                </Text>
              </Div>
            </Group>
          </Panel>
        </View>
      </SplitCol>
    </SplitLayout>
  );
}
