import { Prisma, TransactionCategory, TransactionScope, TransactionStatus, TransactionType } from "../../node_modules/.prisma/client";
import { Response } from "express";
import { prisma } from "../config/prisma";
import { AuthenticatedRequest } from "../types/auth-request";

const EXPENSE_CATEGORIES: TransactionCategory[] = [
  TransactionCategory.FOOD,
  TransactionCategory.UTILITIES,
  TransactionCategory.TRANSPORT,
  TransactionCategory.HOME,
  TransactionCategory.ENTERTAINMENT,
  TransactionCategory.HEALTH,
  TransactionCategory.SHOPPING,
  TransactionCategory.SUBSCRIPTIONS,
  TransactionCategory.OTHER,
] ;

const INCOME_CATEGORIES: TransactionCategory[] = [
  TransactionCategory.SALARY,
  TransactionCategory.BONUS,
  TransactionCategory.GIFT,
  TransactionCategory.REFUND,
  TransactionCategory.SIDE_JOB,
  TransactionCategory.OTHER,
] ;

const transactionInclude = {
  createdBy: {
    select: {
      id: true,
      email: true,
    },
  },
  confirmedBy: {
    select: {
      id: true,
      email: true,
    },
  },
  rejectedBy: {
    select: {
      id: true,
      email: true,
    },
  },
} satisfies Prisma.TransactionInclude;

const transactionOrderBy = {
  createdAt: "desc",
} satisfies Prisma.TransactionOrderByWithRelationInput;

type PairContext = {
  userId: string;
  pairId: string;
};

const normalizeTitle = (value: string) => value.trim();

const parseTransactionType = (value: unknown) => {
  const normalized = String(value ?? "").trim().toUpperCase();

  if (normalized === TransactionType.EXPENSE || normalized === TransactionType.INCOME) {
    return normalized;
  }

  throw new Error("INVALID_TRANSACTION_TYPE");
};

const parseTransactionScope = (value: unknown) => {
  const normalized = String(value ?? "").trim().toUpperCase();

  if (
    normalized === TransactionScope.SELF ||
    normalized === TransactionScope.PARTNER ||
    normalized === TransactionScope.SHARED
  ) {
    return normalized;
  }

  throw new Error("INVALID_TRANSACTION_SCOPE");
};

const parseTransactionCategory = (value: unknown) => {
  const normalized = String(value ?? "").trim().toUpperCase();

  if (!normalized) {
    return TransactionCategory.OTHER;
  }

  if (
    normalized === TransactionCategory.FOOD ||
    normalized === TransactionCategory.UTILITIES ||
    normalized === TransactionCategory.TRANSPORT ||
    normalized === TransactionCategory.HOME ||
    normalized === TransactionCategory.ENTERTAINMENT ||
    normalized === TransactionCategory.HEALTH ||
    normalized === TransactionCategory.SHOPPING ||
    normalized === TransactionCategory.SUBSCRIPTIONS ||
    normalized === TransactionCategory.SALARY ||
    normalized === TransactionCategory.BONUS ||
    normalized === TransactionCategory.GIFT ||
    normalized === TransactionCategory.REFUND ||
    normalized === TransactionCategory.SIDE_JOB ||
    normalized === TransactionCategory.OTHER
  ) {
    return normalized;
  }

  throw new Error("INVALID_TRANSACTION_CATEGORY");
};

const isCategoryAllowedForType = (type: TransactionType, category: TransactionCategory) => {
  if (type === TransactionType.EXPENSE) {
    return EXPENSE_CATEGORIES.includes(category);
  }

  return INCOME_CATEGORIES.includes(category);
};

const assertCategoryMatchesType = (type: TransactionType, category: TransactionCategory) => {
  if (!isCategoryAllowedForType(type, category)) {
    throw new Error("CATEGORY_TYPE_MISMATCH");
  }
};

const getInitialTransactionStatus = (scope: TransactionScope) => {
  return scope === TransactionScope.SELF
    ? TransactionStatus.CONFIRMED
    : TransactionStatus.PENDING_CONFIRMATION;
};

const isConfirmedTransaction = (status: TransactionStatus) => status === TransactionStatus.CONFIRMED;

const getPairContext = async (userId: string): Promise<PairContext> => {
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

  return {
    userId: user.id,
    pairId: user.pairId,
  };
};

const getBalanceContribution = (
  transaction: {
    amount: number;
    type: TransactionType;
    category: TransactionScope;
    createdById: string;
    status: TransactionStatus;
  },
  currentUserId: string
) => {
  if (!isConfirmedTransaction(transaction.status)) {
    return 0;
  }

  const isCreator = transaction.createdById === currentUserId;

  if (transaction.category === TransactionScope.SELF) {
    return 0;
  }

  if (transaction.type === TransactionType.EXPENSE && transaction.category === TransactionScope.PARTNER) {
    return isCreator ? transaction.amount : -transaction.amount;
  }

  if (transaction.type === TransactionType.EXPENSE && transaction.category === TransactionScope.SHARED) {
    return isCreator ? transaction.amount / 2 : -(transaction.amount / 2);
  }

  if (transaction.type === TransactionType.INCOME && transaction.category === TransactionScope.PARTNER) {
    return isCreator ? -transaction.amount : transaction.amount;
  }

  if (transaction.type === TransactionType.INCOME && transaction.category === TransactionScope.SHARED) {
    return isCreator ? -(transaction.amount / 2) : transaction.amount / 2;
  }

  return 0;
};

const buildCategorySummary = (
  transactions: Array<{
    amount: number;
    type: TransactionType;
    transactionCategory: TransactionCategory;
    status: TransactionStatus;
  }>,
  type: TransactionType
) => {
  const matching = transactions.filter((transaction) => transaction.type === type && isConfirmedTransaction(transaction.status));
  const total = matching.reduce((sum, transaction) => sum + transaction.amount, 0);
  const grouped = new Map<TransactionCategory, number>();

  matching.forEach((transaction) => {
    grouped.set(
      transaction.transactionCategory,
      (grouped.get(transaction.transactionCategory) ?? 0) + transaction.amount
    );
  });

  return Array.from(grouped.entries())
    .map(([category, categoryTotal]) => ({
      category,
      total: Number(categoryTotal.toFixed(2)),
      percentage: total > 0 ? Number(((categoryTotal / total) * 100).toFixed(2)) : 0,
    }))
    .sort((left, right) => right.total - left.total);
};

const buildBalancePayload = (rawBalance: number) => {
  if (Math.abs(rawBalance) < 0.005) {
    return {
      amount: 0,
      direction: "SETTLED" as const,
    };
  }

  return {
    amount: Number(Math.abs(rawBalance).toFixed(2)),
    direction: rawBalance < 0 ? ("YOU_OWE" as const) : ("PARTNER_OWES" as const),
  };
};

const getTransactionForPair = async (transactionId: string, pairId: string) => {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: transactionInclude,
  });

  if (!transaction || transaction.pairId !== pairId) {
    throw new Error("TRANSACTION_NOT_FOUND");
  }

  return transaction;
};

const sendTransactionError = (res: Response, error: unknown) => {
  if (error instanceof Error) {
    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({ message: "User not found" });
    }

    if (error.message === "PAIR_REQUIRED") {
      return res.status(400).json({ message: "You need to be connected to a pair first" });
    }

    if (error.message === "INVALID_TRANSACTION_TYPE") {
      return res.status(400).json({ message: "Invalid transaction type" });
    }

    if (error.message === "INVALID_TRANSACTION_SCOPE") {
      return res.status(400).json({ message: "Invalid transaction scope" });
    }

    if (error.message === "INVALID_TRANSACTION_CATEGORY") {
      return res.status(400).json({ message: "Invalid transaction category" });
    }

    if (error.message === "CATEGORY_TYPE_MISMATCH") {
      return res.status(400).json({ message: "Selected category does not match transaction type" });
    }

    if (error.message === "TRANSACTION_NOT_FOUND") {
      return res.status(404).json({ message: "Transaction not found" });
    }

    if (error.message === "TRANSACTION_CREATOR_ONLY") {
      return res.status(403).json({ message: "Only the transaction creator can edit or delete it" });
    }

    if (error.message === "TRANSACTION_CONFIRMATION_FORBIDDEN") {
      return res.status(403).json({ message: "Only the partner can confirm or reject this transaction" });
    }

    if (error.message === "TRANSACTION_NOT_PENDING") {
      return res.status(400).json({ message: "Transaction is not waiting for confirmation" });
    }
  }

  console.error("Transaction controller error:", error);
  return res.status(500).json({ message: "Internal server error" });
};

const parseTransactionPayload = (body: Record<string, unknown>) => {
  const title = normalizeTitle(String(body.title ?? ""));
  const amount = Number(body.amount);
  const type = parseTransactionType(body.type);
  const category = parseTransactionScope(body.scope ?? body.category);
  const transactionCategory = parseTransactionCategory(body.transactionCategory);

  if (!title) {
    throw new Error("TITLE_REQUIRED");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("AMOUNT_INVALID");
  }

  assertCategoryMatchesType(type, transactionCategory);

  return {
    title,
    amount,
    type,
    category,
    transactionCategory,
  };
};

export const createTransaction = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const payload = parseTransactionPayload(req.body as Record<string, unknown>);
    const pairContext = await getPairContext(userId);

    const transaction = await prisma.transaction.create({
      data: {
        ...payload,
        status: getInitialTransactionStatus(payload.category),
        createdById: userId,
        confirmedById: payload.category === TransactionScope.SELF ? userId : null,
        rejectedById: null,
        pairId: pairContext.pairId,
      },
      include: transactionInclude,
    });

    return res.status(201).json({ transaction });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "TITLE_REQUIRED") {
        return res.status(400).json({ message: "Transaction title is required" });
      }

      if (error.message === "AMOUNT_INVALID") {
        return res.status(400).json({ message: "Amount must be greater than 0" });
      }
    }

    return sendTransactionError(res, error);
  }
};

export const updateTransaction = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const transactionId = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const pairContext = await getPairContext(userId);
    const existingTransaction = await getTransactionForPair(transactionId, pairContext.pairId);

    if (existingTransaction.createdById !== userId) {
      throw new Error("TRANSACTION_CREATOR_ONLY");
    }

    const payload = parseTransactionPayload(req.body as Record<string, unknown>);

    const transaction = await prisma.transaction.update({
      where: { id: existingTransaction.id },
      data: {
        ...payload,
        status: getInitialTransactionStatus(payload.category),
        confirmedById: payload.category === TransactionScope.SELF ? userId : null,
        rejectedById: null,
      },
      include: transactionInclude,
    });

    return res.json({ transaction });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "TITLE_REQUIRED") {
        return res.status(400).json({ message: "Transaction title is required" });
      }

      if (error.message === "AMOUNT_INVALID") {
        return res.status(400).json({ message: "Amount must be greater than 0" });
      }
    }

    return sendTransactionError(res, error);
  }
};

export const deleteTransaction = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const transactionId = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const pairContext = await getPairContext(userId);
    const existingTransaction = await getTransactionForPair(transactionId, pairContext.pairId);

    if (existingTransaction.createdById !== userId) {
      throw new Error("TRANSACTION_CREATOR_ONLY");
    }

    await prisma.transaction.delete({
      where: { id: existingTransaction.id },
    });

    return res.json({ deletedId: existingTransaction.id });
  } catch (error) {
    return sendTransactionError(res, error);
  }
};

export const getTransactions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const pairContext = await getPairContext(userId);

    const transactions = await prisma.transaction.findMany({
      where: { pairId: pairContext.pairId },
      include: transactionInclude,
      orderBy: transactionOrderBy,
    });

    return res.json({
      currentUserId: userId,
      transactions,
    });
  } catch (error) {
    return sendTransactionError(res, error);
  }
};

export const getTransactionBalance = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const pairContext = await getPairContext(userId);

    const transactions = await prisma.transaction.findMany({
      where: { pairId: pairContext.pairId },
      select: {
        amount: true,
        type: true,
        category: true,
        createdById: true,
        status: true,
      },
    });

    const rawBalance = transactions.reduce((sum, transaction) => {
      return sum + getBalanceContribution(transaction, userId);
    }, 0);

    return res.json(buildBalancePayload(rawBalance));
  } catch (error) {
    return sendTransactionError(res, error);
  }
};

export const getTransactionSummary = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const pairContext = await getPairContext(userId);
    const transactions = await prisma.transaction.findMany({
      where: { pairId: pairContext.pairId },
      select: {
        amount: true,
        type: true,
        category: true,
        transactionCategory: true,
        createdById: true,
        status: true,
      },
    });

    const totalIncome = transactions
      .filter((transaction) => transaction.type === TransactionType.INCOME && isConfirmedTransaction(transaction.status))
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const totalExpense = transactions
      .filter((transaction) => transaction.type === TransactionType.EXPENSE && isConfirmedTransaction(transaction.status))
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const rawBalance = transactions.reduce((sum, transaction) => {
      return sum + getBalanceContribution(transaction, userId);
    }, 0);

    return res.json({
      totalBudget: Number((totalIncome - totalExpense).toFixed(2)),
      balance: buildBalancePayload(rawBalance),
      expenseByCategory: buildCategorySummary(transactions, TransactionType.EXPENSE),
      incomeByCategory: buildCategorySummary(transactions, TransactionType.INCOME),
    });
  } catch (error) {
    return sendTransactionError(res, error);
  }
};

export const confirmTransaction = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const transactionId = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const pairContext = await getPairContext(userId);
    const existingTransaction = await getTransactionForPair(transactionId, pairContext.pairId);

    if (existingTransaction.createdById === userId) {
      throw new Error("TRANSACTION_CONFIRMATION_FORBIDDEN");
    }

    if (existingTransaction.status !== TransactionStatus.PENDING_CONFIRMATION) {
      throw new Error("TRANSACTION_NOT_PENDING");
    }

    const transaction = await prisma.transaction.update({
      where: { id: existingTransaction.id },
      data: {
        status: TransactionStatus.CONFIRMED,
        confirmedById: userId,
        rejectedById: null,
      },
      include: transactionInclude,
    });

    return res.json({ transaction });
  } catch (error) {
    return sendTransactionError(res, error);
  }
};

export const rejectTransaction = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const transactionId = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const pairContext = await getPairContext(userId);
    const existingTransaction = await getTransactionForPair(transactionId, pairContext.pairId);

    if (existingTransaction.createdById === userId) {
      throw new Error("TRANSACTION_CONFIRMATION_FORBIDDEN");
    }

    if (existingTransaction.status !== TransactionStatus.PENDING_CONFIRMATION) {
      throw new Error("TRANSACTION_NOT_PENDING");
    }

    const transaction = await prisma.transaction.update({
      where: { id: existingTransaction.id },
      data: {
        status: TransactionStatus.REJECTED,
        confirmedById: null,
        rejectedById: userId,
      },
      include: transactionInclude,
    });

    return res.json({ transaction });
  } catch (error) {
    return sendTransactionError(res, error);
  }
};
