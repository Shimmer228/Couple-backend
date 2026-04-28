import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { avatarUploadSingle } from "../middleware/avatar-upload.middleware";
import { getMyProfile, getPartnerProfile, updateMyProfile, uploadMyAvatar } from "../controllers/profile.controller";

const router = Router();

router.use(authenticate);

router.get("/me", getMyProfile);
router.put("/me", updateMyProfile);
router.post("/avatar", avatarUploadSingle, uploadMyAvatar);
router.get("/partner", getPartnerProfile);

export default router;
