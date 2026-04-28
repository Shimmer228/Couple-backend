import { Router } from "express";
import { createPair, joinPair, leavePair } from "../controllers/pair.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.post("/create", authenticate, createPair);
router.post("/join", authenticate, joinPair);
router.post("/leave", authenticate, leavePair);

export default router;
