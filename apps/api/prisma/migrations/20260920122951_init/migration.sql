-- CreateEnum
CREATE TYPE "TripRole" AS ENUM ('DRIVER', 'PASSENGER');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "vkUserId" BIGINT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "photoUrl" TEXT,
    "city" TEXT,
    "ratingAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("vkUserId")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" TEXT NOT NULL,
    "authorVkId" BIGINT NOT NULL,
    "role" "TripRole" NOT NULL,
    "fromCity" TEXT NOT NULL,
    "fromPoint" TEXT,
    "toCity" TEXT NOT NULL,
    "toPoint" TEXT,
    "departAt" TIMESTAMP(3) NOT NULL,
    "seatsTotal" INTEGER NOT NULL,
    "seatsLeft" INTEGER NOT NULL,
    "priceRub" INTEGER,
    "carModel" TEXT,
    "comment" TEXT,
    "status" "TripStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_requests" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userVkId" BIGINT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "authorVkId" BIGINT NOT NULL,
    "targetVkId" BIGINT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trips_fromCity_toCity_departAt_idx" ON "trips"("fromCity", "toCity", "departAt");

-- CreateIndex
CREATE INDEX "trips_status_idx" ON "trips"("status");

-- CreateIndex
CREATE INDEX "trips_authorVkId_status_idx" ON "trips"("authorVkId", "status");

-- CreateIndex
CREATE INDEX "trips_departAt_id_idx" ON "trips"("departAt", "id");

-- CreateIndex
CREATE INDEX "trip_requests_userVkId_status_idx" ON "trip_requests"("userVkId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "trip_requests_tripId_userVkId_key" ON "trip_requests"("tripId", "userVkId");

-- CreateIndex
CREATE INDEX "reviews_targetVkId_idx" ON "reviews"("targetVkId");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_tripId_authorVkId_targetVkId_key" ON "reviews"("tripId", "authorVkId", "targetVkId");

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_authorVkId_fkey" FOREIGN KEY ("authorVkId") REFERENCES "users"("vkUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_requests" ADD CONSTRAINT "trip_requests_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_requests" ADD CONSTRAINT "trip_requests_userVkId_fkey" FOREIGN KEY ("userVkId") REFERENCES "users"("vkUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_authorVkId_fkey" FOREIGN KEY ("authorVkId") REFERENCES "users"("vkUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_targetVkId_fkey" FOREIGN KEY ("targetVkId") REFERENCES "users"("vkUserId") ON DELETE CASCADE ON UPDATE CASCADE;
