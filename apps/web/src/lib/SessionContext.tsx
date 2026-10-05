import type { UserPublic } from '@vk-rideshare/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { ApiRequestError, api } from '../api/client.js';
import { getPlatform } from '../platform/index.js';

export type SessionState = {
  user: UserPublic | null;
  isLoading: boolean;
  error: ApiRequestError | null;
  /**
   * Человек ещё не принимал политику конфиденциальности.
   *
   * Пока это true, приложение не отправило о нём на сервер ничего —
   * ни имени, ни города. Правила площадок требуют согласия до обработки,
   * а не после, и выполнить это можно только так: сначала спросить.
   */
  needsPrivacyConsent: boolean;
  reload: () => void;
  /** Принять политику и завести сессию. Бросает ApiRequestError. */
  acceptPrivacy: () => Promise<void>;
  /**
   * Сохраняет номер телефона в профиль и обновляет состояние.
   * Бросает ApiRequestError — вызывающий показывает сообщение сам.
   */
  savePhone: (phone: string | null) => Promise<void>;
};

const SessionContext = createContext<SessionState>({
  user: null,
  isLoading: true,
  error: null,
  needsPrivacyConsent: false,
  reload: () => undefined,
  acceptPrivacy: () => Promise.resolve(),
  savePhone: () => Promise.resolve(),
});

export const useSession = (): SessionState => useContext(SessionContext);

type Stored = Omit<SessionState, 'reload' | 'acceptPrivacy' | 'savePhone'>;

/**
 * Профиль площадки в виде, пригодном для отправки.
 *
 * null означает одно из двух: его неоткуда взять (запуск вне фрейма) либо
 * он приходит подписанным и серверу не нужен (Telegram). В обоих случаях
 * не шлём ничего: бэкенд не должен затирать сохранённое имя заглушкой.
 */
async function profileBody(): Promise<Record<string, unknown>> {
  const profile = await getPlatform().fetchProfile();
  return profile === null
    ? {}
    : {
        firstName: profile.firstName,
        lastName: profile.lastName,
        photoUrl: profile.photoUrl,
        city: profile.city,
      };
}

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<Stored>({
    user: null,
    isLoading: true,
    error: null,
    needsPrivacyConsent: false,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      setState((previous) => ({ ...previous, isLoading: true, error: null }));
      try {
        /*
         * Первый запрос — читающий и ничего не создающий. Он отвечает на
         * единственный вопрос: спрашивали ли у этого человека согласие.
         * Пишущий POST идёт следом и только если согласие уже есть.
         */
        const current = await api.getSession();
        if (cancelled) {
          return;
        }
        if (current.privacyAcceptedAt === null) {
          setState({
            user: null,
            isLoading: false,
            error: null,
            needsPrivacyConsent: true,
          });
          return;
        }

        const response = await api.session(await profileBody());
        if (!cancelled) {
          setState({
            user: response.user,
            isLoading: false,
            error: null,
            needsPrivacyConsent: false,
          });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setState({
          user: null,
          isLoading: false,
          needsPrivacyConsent: false,
          error:
            error instanceof ApiRequestError
              ? error
              : new ApiRequestError(0, 'NETWORK', 'Нет связи с сервером'),
        });
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const acceptPrivacy = useCallback(async (): Promise<void> => {
    const response = await api.session({ ...(await profileBody()), privacyAccepted: true });
    setState({
      user: response.user,
      isLoading: false,
      error: null,
      needsPrivacyConsent: false,
    });
  }, []);

  const savePhone = useCallback(async (phone: string | null): Promise<void> => {
    const response = await api.session({ phone });
    setState((previous) => ({ ...previous, user: response.user }));
  }, []);

  return (
    <SessionContext.Provider
      value={{
        ...state,
        acceptPrivacy,
        savePhone,
        reload: () => {
          setAttempt((value) => value + 1);
        },
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
