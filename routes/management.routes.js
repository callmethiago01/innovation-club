import { Router } from "express";
import {
  createManagementApproval,
  createManagementAttendance,
  createManagementEvent,
  createManagementFinance,
  createManagementProject,
  deleteManagementFinance,
  listManagementApprovals,
  listManagementAttendance,
  listManagementEvents,
  listManagementFinance,
  listManagementProjects,
  managementReports,
  updateManagementApproval,
  updateManagementAttendance,
  updateManagementEvent,
  updateManagementFinance,
  updateManagementProject,
} from "../controllers/management.controller.js";
import { authenticateToken, requireRoles } from "../middleware/auth.js";

const router = Router();

router.use(authenticateToken);

router.get("/projects", requireRoles("admin", "secretary", "coordinator"), listManagementProjects);
router.post("/projects", requireRoles("admin", "coordinator"), createManagementProject);
router.patch("/projects/:id", requireRoles("admin", "coordinator"), updateManagementProject);

router.get("/attendance", requireRoles("admin", "secretary"), listManagementAttendance);
router.post("/attendance", requireRoles("admin", "secretary"), createManagementAttendance);
router.patch("/attendance/:id", requireRoles("admin", "secretary"), updateManagementAttendance);

router.get("/finance", requireRoles("admin", "treasurer"), listManagementFinance);
router.post("/finance", requireRoles("admin", "treasurer"), createManagementFinance);
router.patch("/finance/:id", requireRoles("admin", "treasurer"), updateManagementFinance);
router.delete("/finance/:id", requireRoles("admin", "treasurer"), deleteManagementFinance);

router.get("/events", requireRoles("admin", "secretary", "coordinator", "member", "treasurer"), listManagementEvents);
router.post("/events", requireRoles("admin", "secretary", "coordinator"), createManagementEvent);
router.patch("/events/:id", requireRoles("admin", "secretary", "coordinator"), updateManagementEvent);

router.get("/approvals", requireRoles("admin", "treasurer", "secretary", "coordinator", "member"), listManagementApprovals);
router.post("/approvals", createManagementApproval);
router.patch("/approvals/:id", requireRoles("admin"), updateManagementApproval);

router.get("/reports", requireRoles("admin"), managementReports);

export default router;
