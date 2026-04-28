import { Prisma, TransactionCategory, TransactionScope, TransactionStatus, TransactionType, WishlistPriority } from "../../node_modules/.prisma/client";
import { Response } from "express";
import { prisma } from "../config/prisma";
import { AuthenticatedRequest } from "../types/auth-request";

const EXPENSE_TRANSACTION_CATEGORIES: TransactionCategory[] = [
  TransactionCategory.FOOD,
  TransactionCategory.UTILITIES,
  TransactionCategory.TRANSPORT,
  TransactionCategory.HOME,
  TransactionCategory.ENTERTAINMENT,
  TransactionCategory.HEALTH,
  TransactionCategory.SHOPPING,
  TransactionCategory.SUBSCRIPTIONS,
  TransactionCategory.OTHER,
];

const wishlistInclude = {
  createdBy: {
    select: {
      id: true,
      email: true,
    },
  },
} satisfies Prisma.WishlistItemInclude;

const wishlistOrderBy = {
  createdAt: "desc",
} satisfies Prisma.WishlistItemOrderByWithRelationInput;

const normalizeTitle = (value: string) => value.trim();
const normalizeUrl = (value: string) => value.trim();

const parseCategory = (value: unknown) => {
  const normalized = String(value ?? "").trim().toUpperCase();

  if (
    normalized === TransactionScope.SELF ||
    normalized === TransactionScope.PARTNER ||
    normalized === TransactionScope.SHARED
  ) {
    return normalized;
  }

  throw new Error("INVALID_WISHLIST_CATEGORY");
};

const parsePriority = (value: unknown) => {
  const normalized = String(value ?? "").trim().toUpperCase();

  if (
    normalized === WishlistPriority.LOW ||
    normalized === WishlistPriority.MEDIUM ||
    normalized === WishlistPriority.HIGH
  ) {
    return normalized;
  }

  throw new Error("INVALID_WISHLIST_PRIORITY");
};

const parseExpenseTransactionCategory = (value: unknown) => {
  const normalized = String(value ?? "").trim().toUpperCase();

  if (!normalized) {
    throw new Error("WISHLIST_TRANSACTION_CATEGORY_REQUIRED");
  }

  const category = normalized as TransactionCategory;

  if (EXPENSE_TRANSACTION_CATEGORIES.includes(category)) {
    return category;
  }

  throw new Error("INVALID_WISHLIST_TRANSACTION_CATEGORY");
};

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

  return {
    userId: user.id,
    pairId: user.pairId,
  };
};

const getWishlistItemForPair = async (itemId: string, pairId: string) => {
  const item = await prisma.wishlistItem.findUnique({
    where: { id: itemId },
    include: wishlistInclude,
  });

  if (!item || item.pairId !== pairId) {
    throw new Error("WISHLIST_ITEM_NOT_FOUND");
  }

  return item;
};

const parseWishlistPayload = (body: Record<string, unknown>) => {
  const title = normalizeTitle(String(body.title ?? ""));
  const rawPrice = body.price;
  const price = rawPrice === undefined || rawPrice === null || rawPrice === "" ? null : Number(rawPrice);
  const url = normalizeUrl(String(body.url ?? ""));
  const priority = parsePriority(body.priority);
  const category = parseCategory(body.category);

  if (!title) {
    throw new Error("TITLE_REQUIRED");
  }

  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    throw new Error("PRICE_INVALID");
  }

  return {
    title,
    url: url || null,
    price,
    priority,
    category,
  };
};

const sendWishlistError = (res: Response, error: unknown) => {
  if (error instanceof Error) {
    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({ message: "User not found" });
    }

    if (error.message === "PAIR_REQUIRED") {
      return res.status(400).json({ message: "You need to be connected to a pair first" });
    }

    if (error.message === "INVALID_WISHLIST_PRIORITY") {
      return res.status(400).json({ message: "Invalid wishlist priority" });
    }

    if (error.message === "INVALID_WISHLIST_CATEGORY") {
      return res.status(400).json({ message: "Invalid wishlist category" });
    }

    if (error.message === "WISHLIST_TRANSACTION_CATEGORY_REQUIRED") {
      return res.status(400).json({ message: "Expense category is required when creating a transaction" });
    }

    if (error.message === "INVALID_WISHLIST_TRANSACTION_CATEGORY") {
      return res.status(400).json({ message: "Invalid expense category for wishlist purchase transaction" });
    }

    if (error.message === "WISHLIST_ITEM_NOT_FOUND") {
      return res.status(404).json({ message: "Wishlist item not found" });
    }

    if (error.message === "ALREADY_PURCHASED") {
      return res.status(400).json({ message: "Wishlist item has already been purchased" });
    }

    if (error.message === "WISHLIST_CREATOR_ONLY") {
      return res.status(403).json({ message: "Only the item creator can edit or delete it" });
    }
  }

  console.error("Wishlist controller error:", error);
  return res.status(500).json({ message: "Internal server error" });
};

export const createWishlistItem = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const payload = parseWishlistPayload(req.body as Record<string, unknown>);
    const pairContext = await getPairContext(userId);

    const item = await prisma.wishlistItem.create({
      data: {
        ...payload,
        createdById: userId,
        pairId: pairContext.pairId,
      },
      include: wishlistInclude,
    });

    return res.status(201).json({ item });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "TITLE_REQUIRED") {
        return res.status(400).json({ message: "Wishlist title is required" });
      }

      if (error.message === "PRICE_INVALID") {
        return res.status(400).json({ message: "Price must be 0 or greater" });
      }
    }

    return sendWishlistError(res, error);
  }
};

export const updateWishlistItem = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const itemId = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const pairContext = await getPairContext(userId);
    const existingItem = await getWishlistItemForPair(itemId, pairContext.pairId);

    if (existingItem.createdById !== userId) {
      throw new Error("WISHLIST_CREATOR_ONLY");
    }

    if (existingItem.isPurchased) {
      throw new Error("ALREADY_PURCHASED");
    }

    const payload = parseWishlistPayload(req.body as Record<string, unknown>);

    const item = await prisma.wishlistItem.update({
      where: { id: existingItem.id },
      data: payload,
      include: wishlistInclude,
    });

    return res.json({ item });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "TITLE_REQUIRED") {
        return res.status(400).json({ message: "Wishlist title is required" });
      }

      if (error.message === "PRICE_INVALID") {
        return res.status(400).json({ message: "Price must be 0 or greater" });
      }
    }

    return sendWishlistError(res, error);
  }
};

export const getWishlistItems = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const pairContext = await getPairContext(userId);

    const items = await prisma.wishlistItem.findMany({
      where: { pairId: pairContext.pairId },
      include: wishlistInclude,
      orderBy: wishlistOrderBy,
    });

    return res.json({
      currentUserId: userId,
      items,
    });
  } catch (error) {
    return sendWishlistError(res, error);
  }
};

export const purchaseWishlistItem = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const itemId = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const pairContext = await getPairContext(userId);
    const existingItem = await getWishlistItemForPair(itemId, pairContext.pairId);

    if (existingItem.isPurchased) {
      throw new Error("ALREADY_PURCHASED");
    }

    const createTransaction = Boolean(req.body.createTransaction);
    const transactionCategory =
      createTransaction && existingItem.price !== null
        ? parseExpenseTransactionCategory(req.body.transactionCategory)
        : null;

    const result = await prisma.$transaction(async (tx) => {
      const purchasedItem = await tx.wishlistItem.update({
        where: { id: existingItem.id },
        data: {
          isPurchased: true,
        },
        include: wishlistInclude,
      });

      const transaction =
        createTransaction && existingItem.price !== null
          ? await tx.transaction.create({
              data: {
                title: existingItem.title,
                amount: existingItem.price,
                type: TransactionType.EXPENSE,
                category: existingItem.category,
                transactionCategory: transactionCategory!,
                status: existingItem.category === TransactionScope.SELF ? TransactionStatus.CONFIRMED : TransactionStatus.PENDING_CONFIRMATION,
                createdById: userId,
                confirmedById: existingItem.category === TransactionScope.SELF ? userId : null,
                rejectedById: null,
                pairId: existingItem.pairId,
              },
            })
          : null;

      return {
        item: purchasedItem,
        transaction,
      };
    });

    return res.json(result);
  } catch (error) {
    return sendWishlistError(res, error);
  }
};

export const deleteWishlistItem = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const itemId = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const pairContext = await getPairContext(userId);
    const existingItem = await getWishlistItemForPair(itemId, pairContext.pairId);

    if (existingItem.createdById !== userId) {
      throw new Error("WISHLIST_CREATOR_ONLY");
    }

    await prisma.wishlistItem.delete({
      where: { id: existingItem.id },
    });

    return res.json({ deletedId: existingItem.id });
  } catch (error) {
    return sendWishlistError(res, error);
  }
};
