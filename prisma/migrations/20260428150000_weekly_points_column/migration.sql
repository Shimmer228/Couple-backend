-- AlterTable
ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "lastWeeklyPointsAt" TIMESTAMP(3);
