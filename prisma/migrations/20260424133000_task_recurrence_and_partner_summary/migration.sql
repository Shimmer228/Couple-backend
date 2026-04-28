-- CreateEnum
CREATE TYPE "TaskRecurrenceType" AS ENUM ('NONE', 'EVERY_X_DAYS', 'WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "Task"
ADD COLUMN "recurrenceType" "TaskRecurrenceType" NOT NULL DEFAULT 'NONE',
ADD COLUMN "recurrenceInterval" INTEGER,
ADD COLUMN "recurrenceParentId" TEXT;
