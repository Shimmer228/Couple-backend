import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { createEvent, deleteEvent, getAllEvents, getEventsForDate, updateEvent } from "../controllers/event.controller";

const router = Router();

router.use(authenticate);

router.post("/create", createEvent);
router.put("/:id", updateEvent);
router.delete("/:id", deleteEvent);
router.get("/all", getAllEvents);
router.get("/", getEventsForDate);

export default router;
