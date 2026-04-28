import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import {
  createBlueprint,
  deleteBlueprint,
  getBlueprints,
  useBlueprint,
} from "../controllers/blueprint.controller";

const router = Router();

router.use(authenticate);

router.get("/", getBlueprints);
router.post("/create", createBlueprint);
router.delete("/:id", deleteBlueprint);
router.post("/:id/use", useBlueprint);

export default router;
