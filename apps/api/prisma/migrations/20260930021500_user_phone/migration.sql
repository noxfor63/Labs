-- AlterTable
-- Номер необязателен: у существующих пользователей он останется NULL,
-- и кнопка «Позвонить» у них просто не появится.
ALTER TABLE "users" ADD COLUMN     "phone" TEXT;
