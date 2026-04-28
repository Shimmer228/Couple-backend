import { PointEarningSource, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";

export const WEEKLY_ALLOWANCE_POINTS = 100;

export const getCurrentWeekStart = (reference = new Date()) => {
  const weekStart = new Date(reference);
  weekStart.setUTCHours(0, 0, 0, 0);
  const day = weekStart.getUTCDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  weekStart.setUTCDate(weekStart.getUTCDate() - diffToMonday);
  return weekStart;
};

export const recordPointEarning = async (
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    pairId: string | null;
    source: PointEarningSource;
    amount: number;
  }
) => {
  if (input.amount <= 0) {
    return;
  }

  await tx.pointEarning.create({
    data: {
      userId: input.userId,
      pairId: input.pairId ?? null,
      source: input.source,
      amount: input.amount,
    },
  });
};

export const grantWeeklyPointsIfNeeded = async (userId: string) => {
  const now = new Date();
  const eligibleBefore = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        pairId: true,
      },
    });

    if (!user) {
      return false;
    }

    const updateResult = await tx.user.updateMany({
      where: {
        id: userId,
        OR: [
          { lastWeeklyPointsAt: null },
          { lastWeeklyPointsAt: { lte: eligibleBefore } },
        ],
      },
      data: {
        points: {
          increment: WEEKLY_ALLOWANCE_POINTS,
        },
        lastWeeklyPointsAt: now,
      },
    });

    if (updateResult.count === 0) {
      return false;
    }

    await recordPointEarning(tx, {
      userId: user.id,
      pairId: user.pairId,
      source: PointEarningSource.WEEKLY_ALLOWANCE,
      amount: WEEKLY_ALLOWANCE_POINTS,
    });

    return true;
  });
};
