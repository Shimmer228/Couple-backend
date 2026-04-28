import { Prisma } from "@prisma/client";
import { Response } from "express";
import { prisma } from "../config/prisma";
import { AuthenticatedRequest } from "../types/auth-request";
import { deleteLocalAvatarFile, buildAvatarUrl } from "../utils/avatar-storage";
import { getWeeklyWinnerId, normalizeOptionalNickname, parseAvatarKey } from "../utils/profile";
import { getCurrentWeekStart } from "../utils/weekly-points";

const purchaseHistoryInclude = {
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

const myProfileSelect = {
  id: true,
  email: true,
  nickname: true,
  avatarKey: true,
  avatarUrl: true,
  points: true,
  winStreak: true,
  pairId: true,
  rewardPurchases: {
    include: purchaseHistoryInclude,
    orderBy: {
      createdAt: "desc",
    },
  },
} satisfies Prisma.UserSelect;

const partnerProfileSelect = {
  id: true,
  email: true,
  nickname: true,
  avatarKey: true,
  avatarUrl: true,
  points: true,
  winStreak: true,
  pairId: true,
} satisfies Prisma.UserSelect;

type WeeklyLeaderboardEntry = {
  userId: string;
  label: string;
  weeklyPointsEarned: number;
};

const getWeeklyLeaderboardForPair = async (pairId: string | null) => {
  if (!pairId) {
    return {
      winnerId: null as string | null,
      weeklyLeaderboard: [] as WeeklyLeaderboardEntry[],
    };
  }

  const pairUsers = await prisma.user.findMany({
    where: { pairId },
    select: {
      id: true,
      email: true,
      nickname: true,
      avatarKey: true,
    },
  });

  const earnings = await prisma.pointEarning.groupBy({
    by: ["userId"],
    where: {
      pairId,
      createdAt: {
        gte: getCurrentWeekStart(),
      },
    },
    _sum: {
      amount: true,
    },
  });

  const earningsByUserId = new Map(
    earnings.map((entry) => [entry.userId, entry._sum.amount ?? 0])
  );

  const weeklyLeaderboard = pairUsers
    .map((pairUser) => ({
      id: pairUser.id,
      userId: pairUser.id,
      label: pairUser.nickname?.trim() || pairUser.email,
      weeklyPointsEarned: earningsByUserId.get(pairUser.id) ?? 0,
    }))
    .sort((left, right) => right.weeklyPointsEarned - left.weeklyPointsEarned);

  return {
    winnerId: getWeeklyWinnerId(weeklyLeaderboard),
    weeklyLeaderboard,
  };
};

const buildProfileResponse = async (user: {
  id: string;
  pairId: string | null;
  [key: string]: unknown;
}) => {
  const weeklyData = await getWeeklyLeaderboardForPair(user.pairId);
  const leaderboardEntry = weeklyData.weeklyLeaderboard.find((entry) => entry.userId === user.id);

  return {
    ...user,
    weeklyPointsEarned: leaderboardEntry?.weeklyPointsEarned ?? 0,
    weeklyLeaderboard: weeklyData.weeklyLeaderboard,
    isWeeklyWinner: weeklyData.winnerId === user.id,
  };
};

const sendProfileError = (res: Response, error: unknown) => {
  if (error instanceof Error) {
    if (error.message === "INVALID_AVATAR_KEY") {
      return res.status(400).json({ message: "Invalid avatar key" });
    }

    if (error.message === "PARTNER_NOT_FOUND") {
      return res.status(404).json({ message: "Partner not found" });
    }

    if (error.message === "PAIR_REQUIRED") {
      return res.status(400).json({ message: "You need to be connected to a pair first" });
    }
  }

  console.error("Profile controller error:", error);
  return res.status(500).json({ message: "Internal server error" });
};

export const getMyProfile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: myProfileSelect,
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      profile: await buildProfileResponse(user),
    });
  } catch (error) {
    return sendProfileError(res, error);
  }
};

export const updateMyProfile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const hasNickname = Object.prototype.hasOwnProperty.call(req.body, "nickname");
    const hasAvatarKey = Object.prototype.hasOwnProperty.call(req.body, "avatarKey");
    const nickname = hasNickname ? normalizeOptionalNickname(req.body.nickname) : undefined;
    const avatarKey = hasAvatarKey ? parseAvatarKey(req.body.avatarKey) : undefined;

    if (typeof nickname === "string" && nickname.length > 40) {
      return res.status(400).json({ message: "Nickname must be 40 characters or fewer" });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        nickname,
        avatarKey,
      },
      select: myProfileSelect,
    });

    return res.json({
      profile: await buildProfileResponse(updatedUser),
    });
  } catch (error) {
    return sendProfileError(res, error);
  }
};

export const uploadMyAvatar = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Avatar image is required" });
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        avatarUrl: true,
      },
    });

    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const avatarUrl = buildAvatarUrl(req.file.filename);

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        avatarUrl,
      },
      select: myProfileSelect,
    });

    if (currentUser.avatarUrl && currentUser.avatarUrl !== avatarUrl) {
      deleteLocalAvatarFile(currentUser.avatarUrl);
    }

    return res.json({
      profile: await buildProfileResponse(updatedUser),
    });
  } catch (error) {
    return sendProfileError(res, error);
  }
};

export const getPartnerProfile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        pairId: true,
      },
    });

    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!currentUser.pairId) {
      throw new Error("PAIR_REQUIRED");
    }

    const partner = await prisma.user.findFirst({
      where: {
        pairId: currentUser.pairId,
        id: {
          not: userId,
        },
      },
      select: partnerProfileSelect,
    });

    if (!partner) {
      throw new Error("PARTNER_NOT_FOUND");
    }

    return res.json({
      profile: await buildProfileResponse(partner),
    });
  } catch (error) {
    return sendProfileError(res, error);
  }
};
