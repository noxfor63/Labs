-- Личность пользователя отвязывается от ВКонтакте.
--
-- Было: users.vkUserId BIGINT — первичный ключ, на него ссылаются четыре
-- внешних ключа. Пользователь из Telegram в такую модель не помещается.
--
-- Стало: суррогатный users.id TEXT, а идентификаторы площадок —
-- необязательные уникальные колонки vkUserId и tgUserId.
--
-- Миграция переносит существующие строки, а не пересоздаёт таблицы:
-- на момент написания данных почти нет, но терять их всё равно нельзя.

-- ─────────── 1. Суррогатный ключ у пользователей ───────────

ALTER TABLE "users" ADD COLUMN "id" TEXT;

-- Значения для уже существующих строк. gen_random_uuid() встроена в
-- PostgreSQL начиная с 13-й версии, расширение подключать не нужно.
-- Новые строки получают cuid от Prisma: форматы разные, но оба — просто
-- непрозрачные строки, и ничего кроме равенства по ним не проверяется.
UPDATE "users" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;

ALTER TABLE "users" ALTER COLUMN "id" SET NOT NULL;

-- ─────────── 2. Новые колонки-ссылки в зависимых таблицах ───────────

ALTER TABLE "trips" ADD COLUMN "authorId" TEXT;
ALTER TABLE "trip_requests" ADD COLUMN "userId" TEXT;
ALTER TABLE "reviews" ADD COLUMN "authorId" TEXT;
ALTER TABLE "reviews" ADD COLUMN "targetId" TEXT;

UPDATE "trips" t
   SET "authorId" = u."id"
  FROM "users" u
 WHERE u."vkUserId" = t."authorVkId";

UPDATE "trip_requests" r
   SET "userId" = u."id"
  FROM "users" u
 WHERE u."vkUserId" = r."userVkId";

UPDATE "reviews" rv
   SET "authorId" = ua."id",
       "targetId" = ut."id"
  FROM "users" ua, "users" ut
 WHERE ua."vkUserId" = rv."authorVkId"
   AND ut."vkUserId" = rv."targetVkId";

-- Если хоть одна ссылка не нашлась — значит в базе есть осиротевшая
-- строка, и дальше идти нельзя: NOT NULL ниже всё равно упадёт, но уже
-- с невнятным сообщением.
DO $$
DECLARE orphans INT;
BEGIN
  SELECT (SELECT count(*) FROM "trips" WHERE "authorId" IS NULL)
       + (SELECT count(*) FROM "trip_requests" WHERE "userId" IS NULL)
       + (SELECT count(*) FROM "reviews" WHERE "authorId" IS NULL OR "targetId" IS NULL)
    INTO orphans;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'Миграция прервана: % строк ссылаются на несуществующего пользователя', orphans;
  END IF;
END $$;

ALTER TABLE "trips" ALTER COLUMN "authorId" SET NOT NULL;
ALTER TABLE "trip_requests" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "reviews" ALTER COLUMN "authorId" SET NOT NULL;
ALTER TABLE "reviews" ALTER COLUMN "targetId" SET NOT NULL;

-- ─────────── 3. Снимаем старые связи ───────────

ALTER TABLE "trips" DROP CONSTRAINT "trips_authorVkId_fkey";
ALTER TABLE "trip_requests" DROP CONSTRAINT "trip_requests_userVkId_fkey";
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_authorVkId_fkey";
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_targetVkId_fkey";

DROP INDEX IF EXISTS "trips_authorVkId_status_idx";
DROP INDEX IF EXISTS "trip_requests_userVkId_status_idx";
DROP INDEX IF EXISTS "reviews_targetVkId_idx";
-- Уникальность задана индексами (CREATE UNIQUE INDEX), а не табличными
-- ограничениями, поэтому снимается через DROP INDEX.
DROP INDEX IF EXISTS "trip_requests_tripId_userVkId_key";
DROP INDEX IF EXISTS "reviews_tripId_authorVkId_targetVkId_key";

ALTER TABLE "users" DROP CONSTRAINT "users_pkey";

-- ─────────── 4. Новый первичный ключ и идентификаторы площадок ───────────

ALTER TABLE "users" ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");
ALTER TABLE "users" ALTER COLUMN "vkUserId" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "tgUserId" BIGINT;

CREATE UNIQUE INDEX "users_vkUserId_key" ON "users"("vkUserId");
CREATE UNIQUE INDEX "users_tgUserId_key" ON "users"("tgUserId");

-- ─────────── 5. Старые колонки-ссылки больше не нужны ───────────

ALTER TABLE "trips" DROP COLUMN "authorVkId";
ALTER TABLE "trip_requests" DROP COLUMN "userVkId";
ALTER TABLE "reviews" DROP COLUMN "authorVkId";
ALTER TABLE "reviews" DROP COLUMN "targetVkId";

-- ─────────── 6. Связи и индексы на новых колонках ───────────

ALTER TABLE "trips"
  ADD CONSTRAINT "trips_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trip_requests"
  ADD CONSTRAINT "trip_requests_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_targetId_fkey"
  FOREIGN KEY ("targetId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "trips_authorId_status_idx" ON "trips"("authorId", "status");
CREATE INDEX "trip_requests_userId_status_idx" ON "trip_requests"("userId", "status");
CREATE INDEX "reviews_targetId_idx" ON "reviews"("targetId");
CREATE UNIQUE INDEX "trip_requests_tripId_userId_key" ON "trip_requests"("tripId", "userId");
CREATE UNIQUE INDEX "reviews_tripId_authorId_targetId_key" ON "reviews"("tripId", "authorId", "targetId");
