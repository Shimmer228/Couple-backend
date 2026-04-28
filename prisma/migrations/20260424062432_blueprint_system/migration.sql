-- CreateEnum
CREATE TYPE "BlueprintType" AS ENUM ('TASK', 'EVENT');

-- CreateTable
CREATE TABLE "Blueprint" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "BlueprintType" NOT NULL,
    "defaultPoints" INTEGER,
    "defaultDueTime" TEXT,
    "defaultTime" TEXT,
    "createdById" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Blueprint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Blueprint_pairId_createdAt_idx" ON "Blueprint"("pairId", "createdAt");

-- AddForeignKey
ALTER TABLE "Blueprint" ADD CONSTRAINT "Blueprint_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blueprint" ADD CONSTRAINT "Blueprint_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "Pair"("id") ON DELETE CASCADE ON UPDATE CASCADE;
