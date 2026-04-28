import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import {
  confirmTransaction,
  createTransaction,
  deleteTransaction,
  getTransactionBalance,
  getTransactionSummary,
  getTransactions,
  rejectTransaction,
  updateTransaction,
} from "../controllers/transaction.controller";

const router = Router();

router.use(authenticate);

router.post("/create", createTransaction);
router.post("/confirm/:id", confirmTransaction);
router.post("/reject/:id", rejectTransaction);
router.put("/:id", updateTransaction);
router.delete("/:id", deleteTransaction);
router.get("/", getTransactions);
router.get("/balance", getTransactionBalance);
router.get("/summary", getTransactionSummary);

export default router;
