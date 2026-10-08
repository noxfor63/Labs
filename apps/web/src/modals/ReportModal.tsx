import {
  LIMITS,
  REPORT_REASON_LABEL,
  REPORT_REASONS,
  type ReportReason,
} from '@vk-rideshare/shared';
import {
  Button,
  Div,
  Footer,
  FormItem,
  ModalPage,
  ModalPageHeader,
  Radio,
  Spacing,
  Textarea,
} from '@vkontakte/vkui';
import { useState, type ReactNode } from 'react';

import { ApiRequestError, api } from '../api/client.js';
import { useReport, type ReportSubject } from '../lib/ReportContext.js';
import { useSnackbar } from '../lib/SnackbarContext.js';

/**
 * Жалоба на пользовательский контент.
 *
 * Контент в сервисе публикуется сразу, без предварительной проверки:
 * объявление «еду через час» после модерации уже никому не нужно. Значит,
 * разбор постфактум — и это окно его начало, единственный способ
 * сообщить, что опубликованное нарушает правила.
 *
 * Причина выбирается из списка, а не пишется словами. Список — не
 * упрощение для человека, а условие для разбора: одинаково
 * сформулированные жалобы можно отсортировать и сравнить, а свободный
 * текст приходится читать целиком, и это кончается тем, что не читают
 * вовсе. Место для текста тоже есть, но рядом с причиной.
 */
export function ReportModal({ id }: { id: string }): ReactNode {
  const report = useReport();
  const subject = report.subject;

  return (
    <ModalPage id={id} header={<ModalPageHeader>Пожаловаться</ModalPageHeader>}>
      {/*
        Форма — отдельный компонент с ключом по объекту жалобы. ModalRoot
        держит окно в дереве и после закрытия, поэтому выбранная причина
        переживала бы закрытие и уехала бы со следующей жалобой. Ключ
        решает это тем, что формы просто не остаётся: на новый объект
        монтируется новая.
      */}
      {subject !== null && (
        <ReportForm
          key={`${subject.target}:${subject.id}`}
          subject={subject}
          onSent={report.close}
        />
      )}
    </ModalPage>
  );
}

function ReportForm({
  subject,
  onSent,
}: {
  subject: ReportSubject;
  onSent: () => void;
}): ReactNode {
  const snackbar = useSnackbar();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [comment, setComment] = useState('');
  const [isSending, setIsSending] = useState(false);

  const trimmed = comment.trim();
  // «Другое» без пояснения разобрать нельзя — то же правило стоит и на сервере.
  const needsComment = reason === 'OTHER' && trimmed === '';

  const submit = async (): Promise<void> => {
    if (reason === null) {
      return;
    }
    setIsSending(true);
    try {
      await api.createReport({
        target: subject.target,
        targetId: subject.id,
        reason,
        comment: trimmed === '' ? null : trimmed,
      });
      snackbar.showSuccess('Жалоба отправлена — разберёмся');
      onSent();
    } catch (caught) {
      snackbar.showError(
        caught instanceof ApiRequestError ? caught.message : 'Не удалось отправить жалобу',
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <Footer>{subject.title}</Footer>

      <FormItem top="Что не так">
        {REPORT_REASONS.map((value) => (
          <Radio
            key={value}
            name="report-reason"
            value={value}
            checked={reason === value}
            onChange={() => {
              setReason(value);
            }}
          >
            {REPORT_REASON_LABEL[value]}
          </Radio>
        ))}
      </FormItem>

      <FormItem
        top={reason === 'OTHER' ? 'Что произошло' : 'Пояснение (необязательно)'}
        bottom={reason === 'OTHER' ? 'Без пояснения такую жалобу не разобрать' : undefined}
        status={needsComment ? 'error' : 'default'}
      >
        <Textarea
          maxLength={LIMITS.REPORT_COMMENT_MAX}
          placeholder="Коротко: что именно нарушает правила"
          value={comment}
          onChange={(event) => {
            setComment(event.target.value);
          }}
        />
      </FormItem>

      <Div>
        <Button
          size="l"
          stretched
          appearance="negative"
          loading={isSending}
          disabled={isSending || reason === null || needsComment}
          onClick={() => {
            void submit();
          }}
        >
          {reason === null ? 'Выберите причину' : 'Отправить жалобу'}
        </Button>
      </Div>

      {/*
        Что будет дальше — прямо здесь. Жалоба без объяснения выглядит как
        кнопка в пустоту, и второй раз на неё уже не нажимают.
      */}
      <Footer>
        Жалобу читает администрация сервиса. Нарушающее правила удаляем, автору
        закрываем доступ. По самому факту жалобы контент не исчезает — сначала мы
        его смотрим.
      </Footer>
      <Spacing size={8} />
    </>
  );
}
