-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('CHALLENGE', 'SHARED');

-- CreateEnum
CREATE TYPE "SharedSplitStatus" AS ENUM ('NONE', 'PROPOSED', 'AGREED');

-- AlterTable
ALTER TABLE "Task"
ALTER COLUMN "assignedToId" DROP NOT NULL,
ADD COLUMN "type" "TaskType" NOT NULL DEFAULT 'CHALLENGE',
ADD COLUMN "sharedSplitStatus" "SharedSplitStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN "proposedById" TEXT,
ADD COLUMN "proposedUser1Points" INTEGER,
ADD COLUMN "proposedUser2Points" INTEGER;

-- CreateIndex
CREATE INDEX "Task_proposedById_idx" ON "Task"("proposedById");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
