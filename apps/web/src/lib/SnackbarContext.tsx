import { Icon20CheckCircleFillGreen, Icon20ErrorCircleFillRed } from '@vkontakte/icons';
import { Snackbar } from '@vkontakte/vkui';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type SnackbarKind = 'success' | 'error';

type SnackbarApi = {
  showSuccess: (text: string) => void;
  showError: (text: string) => void;
};

const SnackbarContext = createContext<SnackbarApi>({
  showSuccess: () => undefined,
  showError: () => undefined,
});

export const useSnackbar = (): SnackbarApi => useContext(SnackbarContext);

export function SnackbarProvider({ children }: { children: ReactNode }): ReactNode {
  const [current, setCurrent] = useState<{ text: string; kind: SnackbarKind } | null>(null);

  const api = useMemo<SnackbarApi>(
    () => ({
      showSuccess: (text: string) => {
        setCurrent({ text, kind: 'success' });
      },
      showError: (text: string) => {
        setCurrent({ text, kind: 'error' });
      },
    }),
    [],
  );

  const close = useCallback(() => {
    setCurrent(null);
  }, []);

  return (
    <SnackbarContext.Provider value={api}>
      {children}
      {current !== null && (
        <Snackbar
          onClosed={close}
          before={
            current.kind === 'success' ? <Icon20CheckCircleFillGreen /> : <Icon20ErrorCircleFillRed />
          }
        >
          {current.text}
        </Snackbar>
      )}
    </SnackbarContext.Provider>
  );
}
