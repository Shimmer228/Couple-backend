import { NextFunction, Response } from "express";
import { AuthenticatedRequest } from "../types/auth-request";
import { verifyToken } from "../utils/jwt";
import { grantWeeklyPointsIfNeeded } from "../utils/weekly-points";

export const authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authorization token is missing" });
  }

  const token = authorization.replace("Bearer ", "").trim();

  try {
    const payload = verifyToken(token);
    req.userId = payload.userId;
    try {
      await grantWeeklyPointsIfNeeded(payload.userId);
    } catch (error) {
      console.error("Weekly points grant error:", error);
    }
    return next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
