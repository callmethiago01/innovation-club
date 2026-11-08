import { Router } from "express";
import { createResource, listResources } from "../controllers/resources.controller.js";
import { authenticateToken, requireRoles } from "../middleware/auth.js";

const router = Router();
const libraryRoles = ["admin", "secretary", "coordinator", "member"];
const contentManagerRoles = ["admin", "secretary", "coordinator"];

router.use(authenticateToken, requireRoles(...libraryRoles));
router.get("/", listResources);
router.post("/", requireRoles(...contentManagerRoles), createResource);

export default router;
