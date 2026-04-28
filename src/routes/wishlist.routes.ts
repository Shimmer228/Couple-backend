import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import {
  createWishlistItem,
  deleteWishlistItem,
  getWishlistItems,
  purchaseWishlistItem,
  updateWishlistItem,
} from "../controllers/wishlist.controller";

const router = Router();

router.use(authenticate);

router.post("/create", createWishlistItem);
router.get("/", getWishlistItems);
router.post("/purchase/:id", purchaseWishlistItem);
router.put("/:id", updateWishlistItem);
router.delete("/:id", deleteWishlistItem);

export default router;
