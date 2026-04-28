import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
} from "../controllers/notification.controller";

const router = Router();

router.use(authenticate);

router.get("/", getNotifications);
router.get("/unread-count", getUnreadNotificationCount);
router.post("/:id/read", markNotificationRead);

export default router;
