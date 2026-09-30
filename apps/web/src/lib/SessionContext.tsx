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
import { fetchVkProfile } from '../vk/bridge.js';

export type SessionState = {
  user: UserPublic | null;
  isLoading: boolean;
  error: ApiRequestError | null;
  reload: () => void;
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
  reload: () => undefined,
  savePhone: () => Promise.resolve(),
});

export const useSession = (): SessionState => useContext(SessionContext);

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<Omit<SessionState, 'reload' | 'savePhone'>>({
    user: null,
    isLoading: true,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      setState((previous) => ({ ...previous, isLoading: true, error: null }));
      try {
        // Профиль берём из VK Bridge. Вне фрейма ВКонтакте его нет — тогда
        // не шлём ничего: бэкенд не должен затирать сохранённое имя заглушкой.
        const profile = await fetchVkProfile();
        const response = await api.session(
          profile === null
            ? {}
            : {
                firstName: profile.firstName,
                lastName: profile.lastName,
                photoUrl: profile.photoUrl,
                city: profile.city,
              },
        );
        if (!cancelled) {
          setState({ user: response.user, isLoading: false, error: null });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setState({
          user: null,
          isLoading: false,
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

  const savePhone = useCallback(async (phone: string | null): Promise<void> => {
    const response = await api.session({ phone });
    setState((previous) => ({ ...previous, user: response.user }));
  }, []);

  return (
    <SessionContext.Provider
      value={{
        ...state,
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
