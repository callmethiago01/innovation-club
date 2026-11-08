import { Router } from "express";
import {
  listApplications,
  reviewApplication,
} from "../controllers/applications.controller.js";
import { authenticateToken, requireRoles } from "../middleware/auth.js";

const router = Router();

router.use(authenticateToken, requireRoles("admin"));
router.get("/", listApplications);
router.patch("/:id", reviewApplication);

export default router;
