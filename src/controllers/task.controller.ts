import { Response } from "express";
import { Prisma, SharedSplitStatus, TaskRecurrenceType, TaskStatus, TaskType } from "../../node_modules/.prisma/client";
import { prisma } from "../config/prisma";
import { AuthenticatedRequest } from "../types/auth-request";
import { parseOptionalDate } from "../utils/date";

export const taskDetailsInclude = {
  createdBy: {
    select: {
      id: true,
      email: true,
    },
  },
  assignedTo: {
    select: {
      id: true,
      email: true,
    },
  },
  completionRequestedBy: {
    select: {
      id: true,
      email: true,
    },
  },
  proposedBy: {
    select: {
      id: true,
      email: true,
    },
  },
} satisfies Prisma.TaskInclude;

const taskOrderBy = {
  createdAt: "desc",
} satisfies Prisma.TaskOrderByWithRelationInput;

const normalizeTitle = (value: string) => value.trim();

const taskContextSelect = {
  id: true,
  title: true,
  bank: true,
  type: true,
  status: true,
  sharedSplitStatus: true,
  pairId: true,
  assignedToId: true,
  createdById: true,
  completionRequestedById: true,
  proposedById: true,
  proposedUser1Points: true,
  proposedUser2Points: true,
  dueDate: true,
  recurrenceType: true,
  recurrenceInterval: true,
  recurrenceParentId: true,
} satisfies Prisma.TaskSelect;

type PairUser = {
  id: string;
  email: string;
  nickname: string | null;
  avatarKey: string | null;
  points: number;
};

type TaskCreationInput = {
  userId: string;
  title: string;
  taskType: TaskType;
  points: number;
  dueDate: Date | null;
  recurrenceType: TaskRecurrenceType;
  recurrenceInterval: number | null;
};

type UserContext = {
  id: string;
  pairId: string;
  points: number;
};

type TaskContext = Prisma.TaskGetPayload<{ select: typeof taskContextSelect }>;

type SharedSplitInput = {
  myPoints: number;
  partnerPoints: number;
};

type TaskInstanceInput = {
  title: string;
  bank: number;
  type: TaskType;
  dueDate: Date | null;
  pairId: string;
  createdById: string;
  assignedToId: string | null;
  recurrenceType: TaskRecurrenceType;
  recurrenceInterval: number | null;
  recurrenceParentId: string | null;
};

const getUserContext = async (tx: Prisma.TransactionClient, userId: string): Promise<UserContext> => {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      pairId: true,
      points: true,
    },
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  if (!user.pairId) {
    throw new Error("PAIR_REQUIRED");
  }

  return {
    id: user.id,
    pairId: user.pairId,
    points: user.points,
  };
};

const getPairUsers = async (tx: Prisma.TransactionClient, pairId: string) => {
  const pairUsers = await tx.user.findMany({
    where: { pairId },
    select: {
      id: true,
      email: true,
      nickname: true,
      avatarKey: true,
      points: true,
    },
  });

  if (pairUsers.length !== 2) {
    throw new Error("PARTNER_REQUIRED");
  }

  return pairUsers.sort((left, right) => left.id.localeCompare(right.id));
};

const getPartner = (pairUsers: PairUser[], userId: string) => {
  const partner = pairUsers.find((pairUser) => pairUser.id !== userId);

  if (!partner) {
    throw new Error("PARTNER_REQUIRED");
  }

  return partner;
};

const getTaskForPair = async (tx: Prisma.TransactionClient, taskId: string, pairId: string) => {
  const task = await tx.task.findUnique({
    where: { id: taskId },
    select: taskContextSelect,
  });

  if (!task || task.pairId !== pairId) {
    throw new Error("TASK_NOT_FOUND");
  }

  return task;
};

const ensureChallengeTask = (task: TaskContext) => {
  if (task.type !== TaskType.CHALLENGE) {
    throw new Error("CHALLENGE_TASK_REQUIRED");
  }
};

const ensureSharedTask = (task: TaskContext) => {
  if (task.type !== TaskType.SHARED) {
    throw new Error("SHARED_TASK_REQUIRED");
  }
};

const ensureAssignedUserCanAct = (task: TaskContext, userId: string) => {
  ensureChallengeTask(task);

  if (task.status !== TaskStatus.ACTIVE) {
    throw new Error("TASK_NOT_ACTIVE");
  }

  if (task.assignedToId !== userId) {
    throw new Error("FORBIDDEN_ACTION");
  }
};

const ensureCreatorCanModify = (task: TaskContext, userId: string) => {
  if (task.createdById !== userId) {
    throw new Error("FORBIDDEN_CREATOR_ACTION");
  }

  if (task.status !== TaskStatus.ACTIVE) {
    throw new Error("TASK_NOT_EDITABLE");
  }
};

const parseRecurrenceType = (value: unknown): TaskRecurrenceType => {
  const normalized = String(value ?? "NONE").trim().toUpperCase();

  if (
    normalized === TaskRecurrenceType.NONE ||
    normalized === TaskRecurrenceType.EVERY_X_DAYS ||
    normalized === TaskRecurrenceType.WEEKLY ||
    normalized === TaskRecurrenceType.MONTHLY
  ) {
    return normalized;
  }

  throw new Error("INVALID_RECURRENCE_TYPE");
};

const parseTaskType = (value: unknown): TaskType => {
  const normalized = String(value ?? TaskType.CHALLENGE).trim().toUpperCase();

  if (normalized === TaskType.CHALLENGE || normalized === TaskType.SHARED) {
    return normalized;
  }

  throw new Error("INVALID_TASK_TYPE");
};

const parseRecurrenceInterval = (type: TaskRecurrenceType, value: unknown) => {
  if (type !== TaskRecurrenceType.EVERY_X_DAYS) {
    return null;
  }

  const interval = Number(value);
  if (!Number.isInteger(interval) || interval <= 0) {
    throw new Error("INVALID_RECURRENCE_INTERVAL");
  }

  return interval;
};

const parseSharedSplitInput = (body: Record<string, unknown>): SharedSplitInput => {
  const myPoints = Number(body.myPoints);
  const partnerPoints = Number(body.partnerPoints);

  if (!Number.isInteger(myPoints) || !Number.isInteger(partnerPoints) || myPoints < 0 || partnerPoints < 0) {
    throw new Error("INVALID_SHARED_SPLIT");
  }

  return {
    myPoints,
    partnerPoints,
  };
};

const getGenerationHorizon = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0, 23, 59, 59, 999));
};

const addRecurrence = (date: Date, type: TaskRecurrenceType, interval: number | null) => {
  const next = new Date(date);

  switch (type) {
    case TaskRecurrenceType.EVERY_X_DAYS:
      next.setUTCDate(next.getUTCDate() + (interval ?? 1));
      return next;
    case TaskRecurrenceType.WEEKLY:
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    case TaskRecurrenceType.MONTHLY:
      next.setUTCMonth(next.getUTCMonth() + 1);
      return next;
    default:
      return next;
  }
};

const createTaskInstance = async (tx: Prisma.TransactionClient, input: TaskInstanceInput) => {
  return tx.task.create({
    data: {
      title: input.title,
      bank: input.bank,
      type: input.type,
      status: TaskStatus.ACTIVE,
      sharedSplitStatus: SharedSplitStatus.NONE,
      assignedToId: input.assignedToId ?? undefined,
      createdById: input.createdById,
      completionRequestedById: null,
      proposedById: null,
      proposedUser1Points: null,
      proposedUser2Points: null,
      pairId: input.pairId,
      dueDate: input.dueDate,
      recurrenceType: input.recurrenceType,
      recurrenceInterval: input.recurrenceInterval,
      recurrenceParentId: input.recurrenceParentId ?? undefined,
    },
    include: taskDetailsInclude,
  });
};

const generateFutureRecurringTasks = async (
  tx: Prisma.TransactionClient,
  options: {
    rootTaskId: string;
    title: string;
    bank: number;
    type: TaskType;
    pairId: string;
    createdById: string;
    assignedToId: string | null;
    dueDate: Date;
    recurrenceType: TaskRecurrenceType;
    recurrenceInterval: number | null;
  }
) => {
  if (options.recurrenceType === TaskRecurrenceType.NONE) {
    return;
  }

  const horizon = getGenerationHorizon();
  const relatedTasks = await tx.task.findMany({
    where: {
      OR: [{ id: options.rootTaskId }, { recurrenceParentId: options.rootTaskId }],
    },
    select: {
      dueDate: true,
    },
    orderBy: {
      dueDate: "asc",
    },
  });

  const datedTasks = relatedTasks
    .map((task) => task.dueDate)
    .filter((date): date is Date => date instanceof Date)
    .sort((left, right) => left.getTime() - right.getTime());

  let lastDate = datedTasks.length > 0 ? datedTasks[datedTasks.length - 1] : options.dueDate;

  while (true) {
    const nextDate = addRecurrence(lastDate, options.recurrenceType, options.recurrenceInterval);
    if (nextDate.getTime() > horizon.getTime()) {
      break;
    }

    if (options.type === TaskType.CHALLENGE) {
      const creator = await tx.user.findUnique({
        where: { id: options.createdById },
        select: { points: true },
      });

      if (!creator || creator.points < options.bank) {
        break;
      }

      await tx.user.update({
        where: { id: options.createdById },
        data: {
          points: {
            decrement: options.bank,
          },
        },
      });
    }

    await createTaskInstance(tx, {
      title: options.title,
      bank: options.bank,
      type: options.type,
      dueDate: nextDate,
      pairId: options.pairId,
      createdById: options.createdById,
      assignedToId: options.assignedToId,
      recurrenceType: options.recurrenceType,
      recurrenceInterval: options.recurrenceInterval,
      recurrenceParentId: options.rootTaskId,
    });

    lastDate = nextDate;
  }
};

const ensureRecurringTasksForPair = async (tx: Prisma.TransactionClient, pairId: string) => {
  const recurringRoots = await tx.task.findMany({
    where: {
      pairId,
      recurrenceType: {
        not: TaskRecurrenceType.NONE,
      },
      recurrenceParentId: null,
      dueDate: {
        not: null,
      },
    },
    select: {
      id: true,
      title: true,
      bank: true,
      type: true,
      pairId: true,
      createdById: true,
      assignedToId: true,
      dueDate: true,
      recurrenceType: true,
      recurrenceInterval: true,
    },
  });

  for (const task of recurringRoots) {
    await generateFutureRecurringTasks(tx, {
      rootTaskId: task.id,
      title: task.title,
      bank: task.bank,
      type: task.type,
      pairId: task.pairId,
      createdById: task.createdById,
      assignedToId: task.assignedToId,
      dueDate: task.dueDate!,
      recurrenceType: task.recurrenceType,
      recurrenceInterval: task.recurrenceInterval,
    });
  }
};

const toStoredSharedSplit = (
  pairUsers: PairUser[],
  currentUserId: string,
  myPoints: number,
  partnerPoints: number
) => {
  const partner = getPartner(pairUsers, currentUserId);
  const pointsById = new Map<string, number>([
    [currentUserId, myPoints],
    [partner.id, partnerPoints],
  ]);

  return {
    proposedUser1Points: pointsById.get(pairUsers[0].id) ?? 0,
    proposedUser2Points: pointsById.get(pairUsers[1].id) ?? 0,
  };
};

const ensureSharedSplitMatchesBank = (task: TaskContext, myPoints: number, partnerPoints: number) => {
  if (myPoints + partnerPoints !== task.bank) {
    throw new Error("INVALID_SHARED_SPLIT");
  }
};

const getCurrentUserPoints = async (tx: Prisma.TransactionClient, userId: string, fallback: number) => {
  const refreshedUser = await tx.user.findUnique({
    where: { id: userId },
    select: {
      points: true,
    },
  });

  return refreshedUser?.points ?? fallback;
};

export const createTaskForUser = async (tx: Prisma.TransactionClient, input: TaskCreationInput) => {
  const { userId, title, taskType, points, dueDate, recurrenceType, recurrenceInterval } = input;
  const user = await getUserContext(tx, userId);
  const pairUsers = await getPairUsers(tx, user.pairId);

  if (recurrenceType !== TaskRecurrenceType.NONE && !dueDate) {
    throw new Error("RECURRENCE_DATE_REQUIRED");
  }

  let assignedToId: string | null = null;
  let currentUserPoints = user.points;

  if (taskType === TaskType.CHALLENGE) {
    if (user.points < points) {
      throw new Error("INSUFFICIENT_POINTS");
    }

    const partner = getPartner(pairUsers, userId);
    assignedToId = partner.id;

    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        points: {
          decrement: points,
        },
      },
      select: {
        points: true,
      },
    });

    currentUserPoints = updatedUser.points;
  }

  const task = await createTaskInstance(tx, {
    title,
    bank: points,
    type: taskType,
    dueDate,
    pairId: user.pairId,
    createdById: userId,
    assignedToId,
    recurrenceType,
    recurrenceInterval,
    recurrenceParentId: null,
  });

  if (recurrenceType !== TaskRecurrenceType.NONE && dueDate) {
    await generateFutureRecurringTasks(tx, {
      rootTaskId: task.id,
      title,
      bank: points,
      type: taskType,
      pairId: user.pairId,
      createdById: userId,
      assignedToId,
      dueDate,
      recurrenceType,
      recurrenceInterval,
    });

    if (taskType === TaskType.CHALLENGE) {
      currentUserPoints = await getCurrentUserPoints(tx, userId, currentUserPoints);
    }
  }

  return {
    task,
    currentUserPoints,
  };
};

const sendTaskError = (res: Response, error: unknown) => {
  if (error instanceof Error) {
    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({ message: "User not found" });
    }

    if (error.message === "PAIR_REQUIRED") {
      return res.status(400).json({ message: "You need to be connected to a pair first" });
    }

    if (error.message === "TASK_NOT_FOUND") {
      return res.status(404).json({ message: "Task not found" });
    }

    if (error.message === "TASK_NOT_ACTIVE") {
      return res.status(400).json({ message: "Only active tasks can be changed this way" });
    }

    if (error.message === "TASK_NOT_EDITABLE") {
      return res.status(400).json({ message: "Only active tasks can be edited or deleted" });
    }

    if (error.message === "WAITING_CONFIRMATION_REQUIRED") {
      return res.status(400).json({ message: "Task must be waiting for confirmation" });
    }

    if (error.message === "COMPLETION_REQUEST_REQUIRED") {
      return res.status(400).json({ message: "Task does not have a pending completion request" });
    }

    if (error.message === "FORBIDDEN_ACTION") {
      return res.status(403).json({ message: "Only the assigned user can respond to this task" });
    }

    if (error.message === "FORBIDDEN_CREATOR_ACTION") {
      return res.status(403).json({ message: "Only the task creator can edit or delete this task" });
    }

    if (error.message === "FORBIDDEN_CONFIRMATION") {
      return res.status(403).json({ message: "Only the other partner can confirm or reject completion" });
    }

    if (error.message === "FORBIDDEN_SHARED_SPLIT_ACTION") {
      return res.status(403).json({ message: "Only the other partner can answer this shared split proposal" });
    }

    if (error.message === "PARTNER_REQUIRED") {
      return res.status(400).json({ message: "Your pair must contain two users" });
    }

    if (error.message === "INSUFFICIENT_POINTS") {
      return res.status(400).json({ message: "Not enough points for this action" });
    }

    if (error.message === "INVALID_DATE") {
      return res.status(400).json({ message: "Invalid due date format" });
    }

    if (error.message === "TASK_UPDATE_REQUIRED") {
      return res.status(400).json({ message: "Provide a title or due date to update" });
    }

    if (error.message === "INVALID_RECURRENCE_TYPE") {
      return res.status(400).json({ message: "Invalid recurrence type" });
    }

    if (error.message === "INVALID_RECURRENCE_INTERVAL") {
      return res.status(400).json({ message: "Every X days recurrence needs a positive interval" });
    }

    if (error.message === "RECURRENCE_DATE_REQUIRED") {
      return res.status(400).json({ message: "Recurring tasks require a due date" });
    }

    if (error.message === "INVALID_TASK_TYPE") {
      return res.status(400).json({ message: "Invalid task type" });
    }

    if (error.message === "CHALLENGE_TASK_REQUIRED") {
      return res.status(400).json({ message: "This action is only available for challenge tasks" });
    }

    if (error.message === "SHARED_TASK_REQUIRED") {
      return res.status(400).json({ message: "This action is only available for shared tasks" });
    }

    if (error.message === "INVALID_SHARED_SPLIT") {
      return res.status(400).json({ message: "Shared reward split must be valid and match the bank" });
    }
  }

  console.error("Task controller error:", error);
  return res.status(500).json({ message: "Internal server error" });
};

export const getTasks = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        pairId: true,
        points: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.pairId) {
      return res.status(400).json({ message: "You need to be connected to a pair first" });
    }

    await prisma.$transaction(async (tx) => {
      await ensureRecurringTasksForPair(tx, user.pairId!);
    });

    const pairUsers = await prisma.user.findMany({
      where: { pairId: user.pairId },
      select: {
        id: true,
        email: true,
        nickname: true,
        avatarKey: true,
        points: true,
      },
    });

    const partner = pairUsers.find((pairUser) => pairUser.id !== user.id) ?? null;
    const refreshedUser = pairUsers.find((pairUser) => pairUser.id === user.id);

    const tasks = await prisma.task.findMany({
      where: { pairId: user.pairId },
      include: taskDetailsInclude,
      orderBy: taskOrderBy,
    });

    return res.json({
      currentUserId: user.id,
      currentUserPoints: refreshedUser?.points ?? user.points,
      partner: partner
        ? {
            id: partner.id,
            email: partner.email,
            nickname: partner.nickname,
            avatarKey: partner.avatarKey,
            points: partner.points,
          }
        : null,
      tasks,
    });
  } catch (error) {
    return sendTaskError(res, error);
  }
};

export const createTask = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const title = normalizeTitle(String(req.body.title ?? ""));
    const taskType = parseTaskType(req.body.type);
    const points = Number(req.body.points);
    const dueDate = parseOptionalDate(req.body.dueDate);
    const recurrenceType = parseRecurrenceType(req.body.recurrenceType);
    const recurrenceInterval = parseRecurrenceInterval(recurrenceType, req.body.recurrenceInterval);

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!title) {
      return res.status(400).json({ message: "Task title is required" });
    }

    if (!Number.isInteger(points) || points <= 0) {
      return res.status(400).json({ message: "Points must be a positive integer" });
    }

    const result = await prisma.$transaction((tx) =>
      createTaskForUser(tx, {
        userId,
        title,
        taskType,
        points,
        dueDate,
        recurrenceType,
        recurrenceInterval,
      })
    );

    return res.status(201).json(result);
  } catch (error) {
    return sendTaskError(res, error);
  }
};

export const updateTask = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const taskId = String(req.params.id ?? "");
    const hasTitle = Object.prototype.hasOwnProperty.call(req.body, "title");
    const hasDueDate = Object.prototype.hasOwnProperty.call(req.body, "dueDate");
    const title = hasTitle ? normalizeTitle(String(req.body.title ?? "")) : undefined;
    const dueDate = hasDueDate ? parseOptionalDate(req.body.dueDate) : undefined;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!hasTitle && !hasDueDate) {
      throw new Error("TASK_UPDATE_REQUIRED");
    }

    if (hasTitle && !title) {
      return res.status(400).json({ message: "Task title is required" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await getUserContext(tx, userId);
      const task = await getTaskForPair(tx, taskId, user.pairId);

      ensureCreatorCanModify(task, userId);

      if (task.recurrenceType !== TaskRecurrenceType.NONE && hasDueDate && !dueDate) {
        throw new Error("RECURRENCE_DATE_REQUIRED");
      }

      const updatedTask = await tx.task.update({
        where: { id: task.id },
        data: {
          ...(hasTitle ? { title } : {}),
          ...(hasDueDate ? { dueDate: dueDate ?? null } : {}),
        },
        include: taskDetailsInclude,
      });

      return {
        task: updatedTask,
        currentUserPoints: user.points,
      };
    });

    return res.json(result);
  } catch (error) {
    return sendTaskError(res, error);
  }
};

export const deleteTask = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const taskId = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await getUserContext(tx, userId);
      const task = await getTaskForPair(tx, taskId, user.pairId);

      ensureCreatorCanModify(task, userId);

      let currentUserPoints = user.points;
      if (task.type === TaskType.CHALLENGE) {
        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: {
            points: {
              increment: task.bank,
            },
          },
          select: {
            points: true,
          },
        });

        currentUserPoints = updatedUser.points;
      }

      await tx.task.delete({
        where: { id: task.id },
      });

      return {
        deletedId: task.id,
        currentUserPoints,
      };
    });

    return res.json(result);
  } catch (error) {
    return sendTaskError(res, error);
  }
};

export const requestCompletion = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const taskId = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await getUserContext(tx, userId);
      const task = await getTaskForPair(tx, taskId, user.pairId);

      ensureAssignedUserCanAct(task, userId);

      const updatedTask = await tx.task.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.WAITING_CONFIRMATION,
          completionRequestedById: userId,
        },
        include: taskDetailsInclude,
      });

      return {
        task: updatedTask,
        currentUserPoints: user.points,
      };
    });

    return res.json(result);
  } catch (error) {
    return sendTaskError(res, error);
  }
};

export const confirmCompletion = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const taskId = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await getUserContext(tx, userId);
      const task = await getTaskForPair(tx, taskId, user.pairId);

      ensureChallengeTask(task);

      if (task.status !== TaskStatus.WAITING_CONFIRMATION) {
        throw new Error("WAITING_CONFIRMATION_REQUIRED");
      }

      if (!task.completionRequestedById) {
        throw new Error("COMPLETION_REQUEST_REQUIRED");
      }

      if (task.completionRequestedById === userId || task.assignedToId === userId) {
        throw new Error("FORBIDDEN_CONFIRMATION");
      }

      await tx.user.update({
        where: { id: task.completionRequestedById },
        data: {
          points: {
            increment: task.bank,
          },
          winStreak: {
            increment: 1,
          },
        },
      });

      const updatedCurrentUser = await tx.user.update({
        where: { id: userId },
        data: {
          winStreak: 0,
        },
        select: {
          points: true,
        },
      });

      const updatedTask = await tx.task.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.COMPLETED,
          completionRequestedById: null,
        },
        include: taskDetailsInclude,
      });

      return {
        task: updatedTask,
        currentUserPoints: updatedCurrentUser.points,
      };
    });

    return res.json(result);
  } catch (error) {
    return sendTaskError(res, error);
  }
};

export const rejectCompletion = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const taskId = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await getUserContext(tx, userId);
      const task = await getTaskForPair(tx, taskId, user.pairId);

      ensureChallengeTask(task);

      if (task.status !== TaskStatus.WAITING_CONFIRMATION) {
        throw new Error("WAITING_CONFIRMATION_REQUIRED");
      }

      if (!task.completionRequestedById) {
        throw new Error("COMPLETION_REQUEST_REQUIRED");
      }

      if (task.completionRequestedById === userId || task.assignedToId === userId) {
        throw new Error("FORBIDDEN_CONFIRMATION");
      }

      const updatedTask = await tx.task.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.ACTIVE,
          completionRequestedById: null,
        },
        include: taskDetailsInclude,
      });

      return {
        task: updatedTask,
        currentUserPoints: user.points,
      };
    });

    return res.json(result);
  } catch (error) {
    return sendTaskError(res, error);
  }
};

export const returnTask = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const taskId = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await getUserContext(tx, userId);
      const pairUsers = await getPairUsers(tx, user.pairId);
      const task = await getTaskForPair(tx, taskId, user.pairId);

      ensureAssignedUserCanAct(task, userId);

      if (user.points < task.bank) {
        throw new Error("INSUFFICIENT_POINTS");
      }

      const partner = getPartner(pairUsers, userId);
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          points: {
            decrement: task.bank,
          },
        },
        select: {
          points: true,
        },
      });

      const updatedTask = await tx.task.update({
        where: { id: task.id },
        data: {
          bank: {
            increment: task.bank,
          },
          assignedToId: partner.id,
          completionRequestedById: null,
        },
        include: taskDetailsInclude,
      });

      return {
        task: updatedTask,
        currentUserPoints: updatedUser.points,
      };
    });

    return res.json(result);
  } catch (error) {
    return sendTaskError(res, error);
  }
};

export const failTask = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const taskId = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await getUserContext(tx, userId);
      const pairUsers = await getPairUsers(tx, user.pairId);
      const task = await getTaskForPair(tx, taskId, user.pairId);

      ensureAssignedUserCanAct(task, userId);

      if (user.points < task.bank) {
        throw new Error("INSUFFICIENT_POINTS");
      }

      const partner = getPartner(pairUsers, userId);
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          points: {
            decrement: task.bank,
          },
          winStreak: 0,
        },
        select: {
          points: true,
        },
      });

      await tx.user.update({
        where: { id: partner.id },
        data: {
          points: {
            increment: task.bank,
          },
          winStreak: {
            increment: 1,
          },
        },
      });

      const updatedTask = await tx.task.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.FAILED,
          completionRequestedById: null,
        },
        include: taskDetailsInclude,
      });

      return {
        task: updatedTask,
        currentUserPoints: updatedUser.points,
      };
    });

    return res.json(result);
  } catch (error) {
    return sendTaskError(res, error);
  }
};

export const proposeSharedSplit = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const taskId = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const split = parseSharedSplitInput(req.body as Record<string, unknown>);

    const result = await prisma.$transaction(async (tx) => {
      const user = await getUserContext(tx, userId);
      const pairUsers = await getPairUsers(tx, user.pairId);
      const task = await getTaskForPair(tx, taskId, user.pairId);

      ensureSharedTask(task);

      if (task.status !== TaskStatus.ACTIVE && task.status !== TaskStatus.WAITING_CONFIRMATION) {
        throw new Error("TASK_NOT_ACTIVE");
      }

      if (task.status === TaskStatus.WAITING_CONFIRMATION && task.proposedById === userId) {
        throw new Error("FORBIDDEN_SHARED_SPLIT_ACTION");
      }

      ensureSharedSplitMatchesBank(task, split.myPoints, split.partnerPoints);
      const storedSplit = toStoredSharedSplit(pairUsers, userId, split.myPoints, split.partnerPoints);

      const updatedTask = await tx.task.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.WAITING_CONFIRMATION,
          sharedSplitStatus: SharedSplitStatus.PROPOSED,
          proposedById: userId,
          completionRequestedById: null,
          proposedUser1Points: storedSplit.proposedUser1Points,
          proposedUser2Points: storedSplit.proposedUser2Points,
        },
        include: taskDetailsInclude,
      });

      return {
        task: updatedTask,
        currentUserPoints: user.points,
      };
    });

    return res.json(result);
  } catch (error) {
    return sendTaskError(res, error);
  }
};

export const acceptSharedSplit = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const taskId = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await getUserContext(tx, userId);
      const pairUsers = await getPairUsers(tx, user.pairId);
      const task = await getTaskForPair(tx, taskId, user.pairId);

      ensureSharedTask(task);

      if (task.status !== TaskStatus.WAITING_CONFIRMATION || task.sharedSplitStatus !== SharedSplitStatus.PROPOSED) {
        throw new Error("WAITING_CONFIRMATION_REQUIRED");
      }

      if (!task.proposedById || task.proposedById === userId) {
        throw new Error("FORBIDDEN_SHARED_SPLIT_ACTION");
      }

      if (task.proposedUser1Points === null || task.proposedUser2Points === null) {
        throw new Error("INVALID_SHARED_SPLIT");
      }

      await tx.user.update({
        where: { id: pairUsers[0].id },
        data: {
          points: {
            increment: task.proposedUser1Points,
          },
        },
      });

      await tx.user.update({
        where: { id: pairUsers[1].id },
        data: {
          points: {
            increment: task.proposedUser2Points,
          },
        },
      });

      const updatedTask = await tx.task.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.COMPLETED,
          sharedSplitStatus: SharedSplitStatus.AGREED,
          proposedById: null,
          completionRequestedById: null,
        },
        include: taskDetailsInclude,
      });

      return {
        task: updatedTask,
        currentUserPoints: await getCurrentUserPoints(tx, userId, user.points),
      };
    });

    return res.json(result);
  } catch (error) {
    return sendTaskError(res, error);
  }
};

export const counterSharedSplit = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const taskId = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const split = parseSharedSplitInput(req.body as Record<string, unknown>);

    const result = await prisma.$transaction(async (tx) => {
      const user = await getUserContext(tx, userId);
      const pairUsers = await getPairUsers(tx, user.pairId);
      const task = await getTaskForPair(tx, taskId, user.pairId);

      ensureSharedTask(task);

      if (task.status !== TaskStatus.WAITING_CONFIRMATION || task.sharedSplitStatus !== SharedSplitStatus.PROPOSED) {
        throw new Error("WAITING_CONFIRMATION_REQUIRED");
      }

      if (!task.proposedById || task.proposedById === userId) {
        throw new Error("FORBIDDEN_SHARED_SPLIT_ACTION");
      }

      ensureSharedSplitMatchesBank(task, split.myPoints, split.partnerPoints);
      const storedSplit = toStoredSharedSplit(pairUsers, userId, split.myPoints, split.partnerPoints);

      const updatedTask = await tx.task.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.WAITING_CONFIRMATION,
          sharedSplitStatus: SharedSplitStatus.PROPOSED,
          proposedById: userId,
          completionRequestedById: null,
          proposedUser1Points: storedSplit.proposedUser1Points,
          proposedUser2Points: storedSplit.proposedUser2Points,
        },
        include: taskDetailsInclude,
      });

      return {
        task: updatedTask,
        currentUserPoints: user.points,
      };
    });

    return res.json(result);
  } catch (error) {
    return sendTaskError(res, error);
  }
};
