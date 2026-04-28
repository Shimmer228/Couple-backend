import { BlueprintType, Prisma, TaskRecurrenceType, TaskType } from "../../node_modules/.prisma/client";
import { Response } from "express";
import { prisma } from "../config/prisma";
import { AuthenticatedRequest } from "../types/auth-request";
import { createDateForDayAndTime, parseOptionalTime } from "../utils/date";
import { createEventForUser } from "./event.controller";
import { createTaskForUser } from "./task.controller";

const blueprintInclude = {
  createdBy: {
    select: {
      id: true,
      email: true,
    },
  },
} satisfies Prisma.BlueprintInclude;

const blueprintOrderBy = {
  createdAt: "desc",
} satisfies Prisma.BlueprintOrderByWithRelationInput;

const normalizeTitle = (value: string) => value.trim();
const normalizeDescription = (value: unknown) => {
  const normalized = String(value ?? "").trim();
  return normalized || null;
};

const parseBlueprintType = (value: unknown) => {
  const normalized = String(value ?? "").trim().toUpperCase();

  if (normalized === BlueprintType.TASK || normalized === BlueprintType.EVENT) {
    return normalized;
  }

  throw new Error("INVALID_BLUEPRINT_TYPE");
};

const getCurrentUserContext = async (userId: string) => {
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

const getBlueprintForPair = async (id: string, pairId: string) => {
  const blueprint = await prisma.blueprint.findUnique({
    where: { id },
  });

  if (!blueprint || blueprint.pairId !== pairId) {
    throw new Error("BLUEPRINT_NOT_FOUND");
  }

  return blueprint;
};

const sendBlueprintError = (res: Response, error: unknown) => {
  if (error instanceof Error) {
    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({ message: "User not found" });
    }

    if (error.message === "PAIR_REQUIRED") {
      return res.status(400).json({ message: "You need to be connected to a pair first" });
    }

    if (error.message === "INVALID_BLUEPRINT_TYPE") {
      return res.status(400).json({ message: "Invalid blueprint type" });
    }

    if (error.message === "INVALID_TIME") {
      return res.status(400).json({ message: "Time must use HH:mm format" });
    }

    if (error.message === "BLUEPRINT_NOT_FOUND") {
      return res.status(404).json({ message: "Blueprint not found" });
    }

    if (error.message === "TASK_BLUEPRINT_POINTS_REQUIRED") {
      return res.status(400).json({ message: "Task blueprints require positive default points" });
    }

    if (error.message === "INVALID_DATE_QUERY") {
      return res.status(400).json({ message: "Date must use YYYY-MM-DD format" });
    }

    if (error.message === "INSUFFICIENT_POINTS") {
      return res.status(400).json({ message: "Not enough points for this blueprint" });
    }

    if (error.message === "PARTNER_REQUIRED") {
      return res.status(400).json({ message: "Your pair must contain two users" });
    }
  }

  console.error("Blueprint controller error:", error);
  return res.status(500).json({ message: "Internal server error" });
};

export const getBlueprints = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await getCurrentUserContext(userId);
    const blueprints = await prisma.blueprint.findMany({
      where: { pairId: user.pairId! },
      include: blueprintInclude,
      orderBy: blueprintOrderBy,
    });

    return res.json({ blueprints });
  } catch (error) {
    return sendBlueprintError(res, error);
  }
};

export const createBlueprint = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const title = normalizeTitle(String(req.body.title ?? ""));
    const description = normalizeDescription(req.body.description);
    const type = parseBlueprintType(req.body.type);
    const defaultPoints =
      req.body.defaultPoints === undefined || req.body.defaultPoints === null || req.body.defaultPoints === ""
        ? null
        : Number(req.body.defaultPoints);
    const defaultTime = parseOptionalTime(req.body.defaultTime);

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!title) {
      return res.status(400).json({ message: "Blueprint title is required" });
    }

    if (type === BlueprintType.TASK && (typeof defaultPoints !== "number" || !Number.isInteger(defaultPoints) || defaultPoints <= 0)) {
      throw new Error("TASK_BLUEPRINT_POINTS_REQUIRED");
    }

    const taskDefaultPoints = type === BlueprintType.TASK ? defaultPoints : null;
    const user = await getCurrentUserContext(userId);

    const blueprint = await prisma.blueprint.create({
      data: {
        title,
        description,
        type,
        defaultPoints: taskDefaultPoints,
        defaultDueTime: type === BlueprintType.TASK ? defaultTime : null,
        defaultTime: type === BlueprintType.EVENT ? defaultTime : null,
        createdById: userId,
        pairId: user.pairId!,
      },
      include: blueprintInclude,
    });

    return res.status(201).json({ blueprint });
  } catch (error) {
    return sendBlueprintError(res, error);
  }
};

export const deleteBlueprint = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const blueprintId = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await getCurrentUserContext(userId);
    const blueprint = await getBlueprintForPair(blueprintId, user.pairId!);

    await prisma.blueprint.delete({
      where: { id: blueprint.id },
    });

    return res.json({ deletedId: blueprint.id });
  } catch (error) {
    return sendBlueprintError(res, error);
  }
};

export const useBlueprint = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const blueprintId = String(req.params.id ?? "");
    const date = String(req.body.date ?? "").trim();

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await getCurrentUserContext(userId);
    const blueprint = await getBlueprintForPair(blueprintId, user.pairId!);

    const result = await prisma.$transaction(async (tx) => {
      if (blueprint.type === BlueprintType.TASK) {
        const blueprintPoints = blueprint.defaultPoints;

        if (typeof blueprintPoints !== "number" || !Number.isInteger(blueprintPoints) || blueprintPoints <= 0) {
          throw new Error("TASK_BLUEPRINT_POINTS_REQUIRED");
        }

        const taskResult = await createTaskForUser(tx, {
          userId,
          title: blueprint.title,
          taskType: TaskType.CHALLENGE,
          points: blueprintPoints,
          dueDate: createDateForDayAndTime(date, blueprint.defaultDueTime),
          recurrenceType: TaskRecurrenceType.NONE,
          recurrenceInterval: null,
        });

        return {
          type: BlueprintType.TASK,
          task: taskResult.task,
          currentUserPoints: taskResult.currentUserPoints,
        };
      }

      const eventResult = await createEventForUser(tx, {
        userId,
        title: blueprint.title,
        description: blueprint.description,
        date: createDateForDayAndTime(date, blueprint.defaultTime),
        recurrenceType: TaskRecurrenceType.NONE,
        recurrenceInterval: null,
      });

      return {
        type: BlueprintType.EVENT,
        event: eventResult.event,
      };
    });

    return res.status(201).json(result);
  } catch (error) {
    return sendBlueprintError(res, error);
  }
};
