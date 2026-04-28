-- RenameEnum
ALTER TYPE "TransactionCategory" RENAME TO "TransactionScope";

-- CreateEnum
CREATE TYPE "TransactionCategory" AS ENUM (
    'FOOD',
    'UTILITIES',
    'TRANSPORT',
    'HOME',
    'ENTERTAINMENT',
    'HEALTH',
    'SHOPPING',
    'SUBSCRIPTIONS',
    'SALARY',
    'GIFT',
    'OTHER'
);

-- AlterTable
ALTER TABLE "Transaction"
ADD COLUMN "transactionCategory" "TransactionCategory" NOT NULL DEFAULT 'OTHER';
