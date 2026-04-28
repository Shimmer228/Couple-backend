import { Response } from "express";
import { prisma } from "../config/prisma";
import { AuthenticatedRequest } from "../types/auth-request";
import { generateUniqueJoinCode } from "../utils/pair";

const normalizeJoinCode = (value: string) => value.trim().toUpperCase();

export const createPair = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const pair = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          pairId: true,
        },
      });

      if (!user) {
        return null;
      }

      if (user.pairId) {
        throw new Error("USER_ALREADY_IN_PAIR");
      }

      const joinCode = await generateUniqueJoinCode(async (candidate) => {
        const existingPair = await tx.pair.findUnique({
          where: { joinCode: candidate },
          select: { id: true },
        });

        return Boolean(existingPair);
      });

      const createdPair = await tx.pair.create({
        data: { joinCode },
      });

      await tx.user.update({
        where: { id: userId },
        data: { pairId: createdPair.id },
      });

      return createdPair;
    });

    if (!pair) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(201).json({
      pairId: pair.id,
      joinCode: pair.joinCode,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "USER_ALREADY_IN_PAIR") {
      return res.status(400).json({ message: "User is already connected to a pair" });
    }

    console.error("Create pair error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const joinPair = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const joinCode = normalizeJoinCode(String(req.body.joinCode ?? ""));

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!joinCode) {
      return res.status(400).json({ message: "Join code is required" });
    }

    const pair = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          pairId: true,
        },
      });

      if (!user) {
        return null;
      }

      if (user.pairId) {
        throw new Error("USER_ALREADY_IN_PAIR");
      }

      const existingPair = await tx.pair.findUnique({
        where: { joinCode },
        select: {
          id: true,
          joinCode: true,
        },
      });

      if (!existingPair) {
        throw new Error("PAIR_NOT_FOUND");
      }

      const membersCount = await tx.user.count({
        where: { pairId: existingPair.id },
      });

      if (membersCount >= 2) {
        throw new Error("PAIR_IS_FULL");
      }

      await tx.user.update({
        where: { id: userId },
        data: { pairId: existingPair.id },
      });

      return existingPair;
    });

    if (!pair) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      pairId: pair.id,
      joinCode: pair.joinCode,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "USER_ALREADY_IN_PAIR") {
        return res.status(400).json({ message: "User is already connected to a pair" });
      }

      if (error.message === "PAIR_NOT_FOUND") {
        return res.status(404).json({ message: "Pair with this join code was not found" });
      }

      if (error.message === "PAIR_IS_FULL") {
        return res.status(400).json({ message: "This pair already has two users" });
      }
    }

    console.error("Join pair error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const leavePair = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          pairId: true,
        },
      });

      if (!user) {
        return null;
      }

      if (!user.pairId) {
        throw new Error("PAIR_REQUIRED");
      }

      const pairId = user.pairId;

      await tx.user.update({
        where: { id: userId },
        data: {
          pairId: null,
        },
      });

      const remainingMembers = await tx.user.count({
        where: { pairId },
      });

      if (remainingMembers === 0) {
        await tx.pair.delete({
          where: { id: pairId },
        });
      }

      return { pairId };
    });

    if (!result) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      leftPair: true,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PAIR_REQUIRED") {
      return res.status(400).json({ message: "You are not connected to a pair" });
    }

    console.error("Leave pair error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
