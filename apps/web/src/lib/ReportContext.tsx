import type { ReportTarget } from '@vk-rideshare/shared';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * На что жалуются и как это назвать человеку.
 *
 * `title` нужен не для красоты: кнопка «Пожаловаться» стоит в нескольких
 * местах, и открывшееся окно должно само говорить, на что именно уйдёт
 * жалоба. Иначе легко отправить её не на тот объект и не заметить.
 */
export type ReportSubject = {
  target: ReportTarget;
  id: string;
  title: string;
};

type ReportApi = {
  /** Что сейчас обжалуют; null — окно закрыто. */
  subject: ReportSubject | null;
  open: (subject: ReportSubject) => void;
  close: () => void;
};

const ReportContext = createContext<ReportApi>({
  subject: null,
  open: () => undefined,
  close: () => undefined,
});

export const useReport = (): ReportApi => useContext(ReportContext);

/**
 * Состояние окна жалобы — в контексте, а не в маршруте.
 *
 * Пожаловаться можно с экрана поездки, с чужого профиля и со своего — а
 * каждый из них живёт в трёх разделах со своей историей. Маршрут на
 * модалку пришлось бы прописать для каждого сочетания, и это пять лишних
 * строк в таблице маршрутов ради окна, ссылкой на которое никто не
 * поделится. Цена решения: окно не переживает аппаратную кнопку «назад»
 * как отдельный шаг истории — закрывает её сам ModalRoot.
 */
export function ReportProvider({ children }: { children: ReactNode }): ReactNode {
  const [subject, setSubject] = useState<ReportSubject | null>(null);

  const api = useMemo<ReportApi>(
    () => ({
      subject,
      open: (next: ReportSubject) => {
        setSubject(next);
      },
      close: () => {
        setSubject(null);
      },
    }),
    [subject],
  );

  return <ReportContext.Provider value={api}>{children}</ReportContext.Provider>;
}
