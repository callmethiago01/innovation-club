import { Router } from "express";
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
} from "../controllers/content.controller.js";
import { authenticateToken, requireRoles } from "../middleware/auth.js";

const router = Router();

router.get("/", authenticateToken, listAnnouncements);
router.post("/", authenticateToken, requireRoles("admin"), createAnnouncement);
router.delete("/:id", authenticateToken, requireRoles("admin"), deleteAnnouncement);

export default router;
