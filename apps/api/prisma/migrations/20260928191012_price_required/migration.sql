/*
  Warnings:

  - Made the column `priceRub` on table `trips` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "trips" ALTER COLUMN "priceRub" SET NOT NULL;
