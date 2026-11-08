import { Router } from "express";
import { dashboard, dashboardSection } from "../controllers/dashboard.controller.js";
import { authenticateToken } from "../middleware/auth.js";

const router = Router();

router.get("/", authenticateToken, dashboard);
router.get("/sections/:section", authenticateToken, dashboardSection);

export default router;