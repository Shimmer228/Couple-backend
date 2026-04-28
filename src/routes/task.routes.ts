import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import {
  acceptSharedSplit,
  counterSharedSplit,
  confirmCompletion,
  createTask,
  deleteTask,
  failTask,
  getTasks,
  proposeSharedSplit,
  rejectCompletion,
  requestCompletion,
  returnTask,
  updateTask,
} from "../controllers/task.controller";

const router = Router();

router.use(authenticate);

router.get("/", getTasks);
router.post("/create", createTask);
router.put("/:id", updateTask);
router.delete("/:id", deleteTask);
router.post("/request-completion/:id", requestCompletion);
router.post("/confirm-completion/:id", confirmCompletion);
router.post("/reject-completion/:id", rejectCompletion);
router.post("/shared/:id/propose-split", proposeSharedSplit);
router.post("/shared/:id/accept-split", acceptSharedSplit);
router.post("/shared/:id/counter-split", counterSharedSplit);
router.post("/return/:id", returnTask);
router.post("/fail/:id", failTask);

export default router;
