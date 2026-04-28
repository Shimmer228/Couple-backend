-- AlterTable
ALTER TABLE "Event"
ADD COLUMN "recurrenceType" "TaskRecurrenceType" NOT NULL DEFAULT 'NONE',
ADD COLUMN "recurrenceInterval" INTEGER,
ADD COLUMN "recurrenceParentId" TEXT;
