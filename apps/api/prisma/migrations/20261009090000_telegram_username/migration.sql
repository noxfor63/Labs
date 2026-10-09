-- @username в Telegram: без него диалог не открыть.
--
-- Колонка необязательная и заполняется сама при следующем запуске
-- приложения: имя приходит в подписанных данных Telegram. Данных не
-- трогает, откат — DROP COLUMN.
ALTER TABLE "users" ADD COLUMN "tgUsername" TEXT;
