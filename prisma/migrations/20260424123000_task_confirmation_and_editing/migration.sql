-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'WAITING_CONFIRMATION';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "completionRequestedById" TEXT;

-- CreateIndex
CREATE INDEX "Task_completionRequestedById_idx" ON "Task"("completionRequestedById");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_completionRequestedById_fkey" FOREIGN KEY ("completionRequestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
