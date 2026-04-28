import { NotificationType, Prisma } from "../../node_modules/.prisma/client";
import { Response } from "express";
import { prisma } from "../config/prisma";
import { AuthenticatedRequest } from "../types/auth-request";

const notificationOrderBy = {
  createdAt: "desc",
} satisfies Prisma.NotificationOrderByWithRelationInput;

const getPairContext = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      pairId: true,
    },
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  if (!user.pairId) {
    throw new Error("PAIR_REQUIRED");
  }

  return user;
};

const getNotificationForUser = async (notificationId: string, userId: string) => {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  });

  if (!notification || notification.userId !== userId) {
    throw new Error("NOTIFICATION_NOT_FOUND");
  }

  return notification;
};

const sendNotificationError = (res: Response, error: unknown) => {
  if (error instanceof Error) {
    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({ message: "User not found" });
    }

    if (error.message === "PAIR_REQUIRED") {
      return res.status(400).json({ message: "You need to be connected to a pair first" });
    }

    if (error.message === "NOTIFICATION_NOT_FOUND") {
      return res.status(404).json({ message: "Notification not found" });
    }
  }

  console.error("Notification controller error:", error);
  return res.status(500).json({ message: "Internal server error" });
};

export const createRewardPurchaseNotification = async (
  tx: Prisma.TransactionClient,
  options: {
    actorId: string;
    pairId: string;
    actorLabel: string;
    rewardTitle: string;
  }
) => {
  const partner = await tx.user.findFirst({
    where: {
      pairId: options.pairId,
      id: {
        not: options.actorId,
      },
    },
    select: {
      id: true,
    },
  });

  if (!partner) {
    return null;
  }

  return tx.notification.create({
    data: {
      title: "Reward purchased",
      message: `${options.actorLabel} bought: ${options.rewardTitle}`,
      type: NotificationType.REWARD_PURCHASE,
      userId: partner.id,
      pairId: options.pairId,
    },
  });
};

export const getNotifications = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    await getPairContext(userId);

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: notificationOrderBy,
    });

    return res.json({ notifications });
  } catch (error) {
    return sendNotificationError(res, error);
  }
};

export const markNotificationRead = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const notificationId = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const notification = await getNotificationForUser(notificationId, userId);

    const updatedNotification = await prisma.notification.update({
      where: { id: notification.id },
      data: {
        isRead: true,
      },
    });

    return res.json({ notification: updatedNotification });
  } catch (error) {
    return sendNotificationError(res, error);
  }
};

export const getUnreadNotificationCount = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    await getPairContext(userId);

    const unreadCount = await prisma.notification.count({
      where: {
        userId,
        isRead: false,
      },
    });

    return res.json({ unreadCount });
  } catch (error) {
    return sendNotificationError(res, error);
  }
};
