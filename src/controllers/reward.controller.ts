import { Prisma } from "@prisma/client";
import { Response } from "express";
import { prisma } from "../config/prisma";
import { AuthenticatedRequest } from "../types/auth-request";
import { ensureDefaultRewards } from "../utils/rewards";
import { createRewardPurchaseNotification } from "./notification.controller";

const rewardPurchaseInclude = {
  reward: {
    select: {
      id: true,
      title: true,
      description: true,
      cost: true,
      minStreak: true,
    },
  },
} satisfies Prisma.RewardPurchaseInclude;

const rewardOrderBy = {
  cost: "asc",
} satisfies Prisma.RewardOrderByWithRelationInput;

const sendRewardError = (res: Response, error: unknown) => {
  if (error instanceof Error) {
    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({ message: "User not found" });
    }

    if (error.message === "PAIR_REQUIRED") {
      return res.status(400).json({ message: "You need to be connected to a pair first" });
    }

    if (error.message === "REWARD_NOT_FOUND") {
      return res.status(404).json({ message: "Reward not found" });
    }

    if (error.message === "REWARD_LOCKED") {
      return res.status(400).json({ message: "Your current streak is too low for this reward" });
    }

    if (error.message === "REWARD_INACTIVE") {
      return res.status(400).json({ message: "Reward is not available right now" });
    }

    if (error.message === "INSUFFICIENT_POINTS") {
      return res.status(400).json({ message: "Not enough points to buy this reward" });
    }
  }

  console.error("Reward controller error:", error);
  return res.status(500).json({ message: "Internal server error" });
};

const getCurrentUser = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      pairId: true,
      points: true,
      winStreak: true,
    },
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  return user;
};

export const getRewards = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    await ensureDefaultRewards(prisma);
    const user = await getCurrentUser(userId);

    const rewards = await prisma.reward.findMany({
      where: { isActive: true },
      orderBy: rewardOrderBy,
    });

    return res.json({
      currentUserPoints: user.points,
      currentUserWinStreak: user.winStreak,
      rewards: rewards.map((reward) => ({
        ...reward,
        isUnlocked: user.winStreak >= reward.minStreak,
      })),
    });
  } catch (error) {
    return sendRewardError(res, error);
  }
};

export const buyReward = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const rewardId = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    await ensureDefaultRewards(prisma);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          pairId: true,
          points: true,
          winStreak: true,
          nickname: true,
          email: true,
        },
      });

      if (!user) {
        throw new Error("USER_NOT_FOUND");
      }

      if (!user.pairId) {
        throw new Error("PAIR_REQUIRED");
      }

      const reward = await tx.reward.findUnique({
        where: { id: rewardId },
      });

      if (!reward) {
        throw new Error("REWARD_NOT_FOUND");
      }

      if (!reward.isActive) {
        throw new Error("REWARD_INACTIVE");
      }

      if (user.winStreak < reward.minStreak) {
        throw new Error("REWARD_LOCKED");
      }

      if (user.points < reward.cost) {
        throw new Error("INSUFFICIENT_POINTS");
      }

      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          points: {
            decrement: reward.cost,
          },
        },
        select: {
          points: true,
        },
      });

      const purchase = await tx.rewardPurchase.create({
        data: {
          rewardId: reward.id,
          userId: user.id,
          pairId: user.pairId,
        },
        include: rewardPurchaseInclude,
      });

      await createRewardPurchaseNotification(tx, {
        actorId: user.id,
        pairId: user.pairId,
        actorLabel: user.nickname?.trim() || user.email,
        rewardTitle: reward.title,
      });

      return {
        purchase,
        currentUserPoints: updatedUser.points,
      };
    });

    return res.status(201).json(result);
  } catch (error) {
    return sendRewardError(res, error);
  }
};

export const getRewardPurchases = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    await ensureDefaultRewards(prisma);
    const user = await getCurrentUser(userId);

    const purchases = await prisma.rewardPurchase.findMany({
      where: { userId: user.id },
      include: rewardPurchaseInclude,
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json({
      currentUserPoints: user.points,
      purchases,
    });
  } catch (error) {
    return sendRewardError(res, error);
  }
};
