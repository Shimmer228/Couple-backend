CREATE TYPE "PointEarningSource" AS ENUM ('WEEKLY_ALLOWANCE', 'CHALLENGE_REWARD', 'SHARED_REWARD');

CREATE TABLE "PointEarning" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pairId" TEXT,
    "source" "PointEarningSource" NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointEarning_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PointEarning_userId_createdAt_idx" ON "PointEarning"("userId", "createdAt");
CREATE INDEX "PointEarning_pairId_createdAt_idx" ON "PointEarning"("pairId", "createdAt");

ALTER TABLE "PointEarning"
ADD CONSTRAINT "PointEarning_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PointEarning"
ADD CONSTRAINT "PointEarning_pairId_fkey"
FOREIGN KEY ("pairId") REFERENCES "Pair"("id") ON DELETE SET NULL ON UPDATE CASCADE;
