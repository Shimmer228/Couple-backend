import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { buyReward, getRewardPurchases, getRewards } from "../controllers/reward.controller";

const router = Router();

router.use(authenticate);

router.get("/", getRewards);
router.post("/buy/:id", buyReward);
router.get("/purchases", getRewardPurchases);

export default router;
