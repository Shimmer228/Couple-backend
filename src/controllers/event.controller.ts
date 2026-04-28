import { Response } from "express";
import { Prisma, TaskRecurrenceType } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AuthenticatedRequest } from "../types/auth-request";
import { getDayRange, parseRequiredDate } from "../utils/date";

export const eventInclude = {
  createdBy: {
    select: {
      id: true,
      email: true,
    },
  },
} satisfies Prisma.EventInclude;

const eventOrderBy = {
  date: "asc",
} satisfies Prisma.EventOrderByWithRelationInput;

const normalizeTitle = (value: string) => value.trim();
const normalizeDescription = (value: unknown) => {
  const normalized = String(value ?? "").trim();
  return normalized || null;
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

export const getCurrentUserContext = async (userId: string) => {
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

type EventCreationInput = {
  userId: string;
  title: string;
  description?: string | null;
  date: Date;
  recurrenceType: TaskRecurrenceType;
  recurrenceInterval: number | null;
};

const createEventInstance = async (
  tx: Prisma.TransactionClient,
  input: {
    title: string;
    description: string | null;
    date: Date;
    pairId: string;
    createdById: string;
    recurrenceType: TaskRecurrenceType;
    recurrenceInterval: number | null;
    recurrenceParentId: string | null;
  }
) => {
  return tx.event.create({
    data: {
      title: input.title,
      description: input.description,
      date: input.date,
      pairId: input.pairId,
      createdById: input.createdById,
      recurrenceType: input.recurrenceType,
      recurrenceInterval: input.recurrenceInterval,
      recurrenceParentId: input.recurrenceParentId,
    },
    include: eventInclude,
  });
};

const generateFutureRecurringEvents = async (
  tx: Prisma.TransactionClient,
  options: {
    rootEventId: string;
    title: string;
    description: string | null;
    pairId: string;
    createdById: string;
    date: Date;
    recurrenceType: TaskRecurrenceType;
    recurrenceInterval: number | null;
  }
) => {
  if (options.recurrenceType === TaskRecurrenceType.NONE) {
    return;
  }

  const horizon = getGenerationHorizon();
  const relatedEvents = await tx.event.findMany({
    where: {
      OR: [
        { id: options.rootEventId },
        { recurrenceParentId: options.rootEventId },
      ],
    },
    select: {
      date: true,
    },
    orderBy: {
      date: "asc",
    },
  });

  const datedEvents = relatedEvents
    .map((event) => event.date)
    .filter((date): date is Date => date instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime());

  let lastDate = datedEvents.length > 0 ? datedEvents[datedEvents.length - 1] : options.date;

  while (true) {
    const nextDate = addRecurrence(lastDate, options.recurrenceType, options.recurrenceInterval);
    if (nextDate.getTime() > horizon.getTime()) {
      break;
    }

    await createEventInstance(tx, {
      title: options.title,
      description: options.description,
      date: nextDate,
      pairId: options.pairId,
      createdById: options.createdById,
      recurrenceType: options.recurrenceType,
      recurrenceInterval: options.recurrenceInterval,
      recurrenceParentId: options.rootEventId,
    });

    lastDate = nextDate;
  }
};

const ensureRecurringEventsForPair = async (tx: Prisma.TransactionClient, pairId: string) => {
  const recurringRoots = await tx.event.findMany({
    where: {
      pairId,
      recurrenceType: {
        not: TaskRecurrenceType.NONE,
      },
      recurrenceParentId: null,
    },
    select: {
      id: true,
      title: true,
      description: true,
      pairId: true,
      createdById: true,
      date: true,
      recurrenceType: true,
      recurrenceInterval: true,
    },
  });

  for (const event of recurringRoots) {
    await generateFutureRecurringEvents(tx, {
      rootEventId: event.id,
      title: event.title,
      description: event.description,
      pairId: event.pairId,
      createdById: event.createdById,
      date: event.date,
      recurrenceType: event.recurrenceType,
      recurrenceInterval: event.recurrenceInterval,
    });
  }
};

export const createEventForUser = async (tx: Prisma.TransactionClient, input: EventCreationInput) => {
  const user = await tx.user.findUnique({
    where: { id: input.userId },
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

  const event = await createEventInstance(tx, {
    title: input.title,
    description: input.description ?? null,
    date: input.date,
    pairId: user.pairId,
    createdById: input.userId,
    recurrenceType: input.recurrenceType,
    recurrenceInterval: input.recurrenceInterval,
    recurrenceParentId: null,
  });

  if (input.recurrenceType !== TaskRecurrenceType.NONE) {
    await generateFutureRecurringEvents(tx, {
      rootEventId: event.id,
      title: input.title,
      description: input.description ?? null,
      pairId: user.pairId,
      createdById: input.userId,
      date: input.date,
      recurrenceType: input.recurrenceType,
      recurrenceInterval: input.recurrenceInterval,
    });
  }

  return { event };
};

const getEventForPair = async (eventId: string, pairId: string) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
  });

  if (!event || event.pairId !== pairId) {
    throw new Error("EVENT_NOT_FOUND");
  }

  return event;
};

const sendEventError = (res: Response, error: unknown) => {
  if (error instanceof Error) {
    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({ message: "User not found" });
    }

    if (error.message === "PAIR_REQUIRED") {
      return res.status(400).json({ message: "You need to be connected to a pair first" });
    }

    if (error.message === "DATE_REQUIRED") {
      return res.status(400).json({ message: "Event date is required" });
    }

    if (error.message === "INVALID_DATE" || error.message === "INVALID_DATE_QUERY") {
      return res.status(400).json({ message: "Invalid date format" });
    }

    if (error.message === "EVENT_NOT_FOUND") {
      return res.status(404).json({ message: "Event not found" });
    }

    if (error.message === "FORBIDDEN_EVENT_ACTION") {
      return res.status(403).json({ message: "Only the event creator can edit or delete this event" });
    }

    if (error.message === "EVENT_UPDATE_REQUIRED") {
      return res.status(400).json({ message: "Provide a title, description, or date to update" });
    }

    if (error.message === "INVALID_RECURRENCE_TYPE") {
      return res.status(400).json({ message: "Invalid recurrence type" });
    }

    if (error.message === "INVALID_RECURRENCE_INTERVAL") {
      return res.status(400).json({ message: "Every X days recurrence needs a positive interval" });
    }
  }

  console.error("Event controller error:", error);
  return res.status(500).json({ message: "Internal server error" });
};

export const createEvent = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const title = normalizeTitle(String(req.body.title ?? ""));
    const description = normalizeDescription(req.body.description);
    const recurrenceType = parseRecurrenceType(req.body.recurrenceType);
    const recurrenceInterval = parseRecurrenceInterval(recurrenceType, req.body.recurrenceInterval);

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!title) {
      return res.status(400).json({ message: "Event title is required" });
    }

    const date = parseRequiredDate(req.body.date);

    const result = await prisma.$transaction((tx) =>
      createEventForUser(tx, {
        userId,
        title,
        description,
        date,
        recurrenceType,
        recurrenceInterval,
      })
    );

    return res.status(201).json(result);
  } catch (error) {
    return sendEventError(res, error);
  }
};

export const updateEvent = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const eventId = String(req.params.id ?? "");
    const hasTitle = Object.prototype.hasOwnProperty.call(req.body, "title");
    const hasDescription = Object.prototype.hasOwnProperty.call(req.body, "description");
    const hasDate = Object.prototype.hasOwnProperty.call(req.body, "date");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!hasTitle && !hasDescription && !hasDate) {
      throw new Error("EVENT_UPDATE_REQUIRED");
    }

    const user = await getCurrentUserContext(userId);
    const event = await getEventForPair(eventId, user.pairId!);

    if (event.createdById !== userId) {
      throw new Error("FORBIDDEN_EVENT_ACTION");
    }

    const title = hasTitle ? normalizeTitle(String(req.body.title ?? "")) : undefined;
    const description = hasDescription ? normalizeDescription(req.body.description) : undefined;
    const date = hasDate ? parseRequiredDate(req.body.date) : undefined;

    if (hasTitle && !title) {
      return res.status(400).json({ message: "Event title is required" });
    }

    const updatedEvent = await prisma.event.update({
      where: { id: event.id },
      data: {
        ...(hasTitle ? { title } : {}),
        ...(hasDescription ? { description } : {}),
        ...(hasDate ? { date } : {}),
      },
      include: eventInclude,
    });

    return res.json({ event: updatedEvent });
  } catch (error) {
    return sendEventError(res, error);
  }
};

export const deleteEvent = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const eventId = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await getCurrentUserContext(userId);
    const event = await getEventForPair(eventId, user.pairId!);

    if (event.createdById !== userId) {
      throw new Error("FORBIDDEN_EVENT_ACTION");
    }

    await prisma.event.delete({
      where: { id: event.id },
    });

    return res.json({ deletedId: event.id });
  } catch (error) {
    return sendEventError(res, error);
  }
};

export const getEventsForDate = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const date = String(req.query.date ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await getCurrentUserContext(userId);
    const { start, end } = getDayRange(date);

    await prisma.$transaction(async (tx) => {
      await ensureRecurringEventsForPair(tx, user.pairId!);
    });

    const events = await prisma.event.findMany({
      where: {
        pairId: user.pairId!,
        date: {
          gte: start,
          lte: end,
        },
      },
      include: eventInclude,
      orderBy: eventOrderBy,
    });

    return res.json({ events });
  } catch (error) {
    return sendEventError(res, error);
  }
};

export const getAllEvents = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await getCurrentUserContext(userId);

    await prisma.$transaction(async (tx) => {
      await ensureRecurringEventsForPair(tx, user.pairId!);
    });

    const events = await prisma.event.findMany({
      where: { pairId: user.pairId! },
      include: eventInclude,
      orderBy: eventOrderBy,
    });

    return res.json({ events });
  } catch (error) {
    return sendEventError(res, error);
  }
};
