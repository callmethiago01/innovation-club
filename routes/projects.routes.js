import { Router } from "express";
import {
  addProjectComment,
  addProjectTeamMember,
  createProjectMilestone,
  createProjectProposal,
  createProjectTask,
  downloadProposalFile,
  downloadProjectFile,
  getProjectDetails,
  joinProject,
  listProjectTeamCandidates,
  listProjectWorkspace,
  removeProjectTeamMember,
  reviewProjectProposal,
  updateProjectProgress,
  updateProjectMilestone,
  updateProjectTask,
  uploadProjectFile,
} from "../controllers/projects.controller.js";
import { authenticateToken } from "../middleware/auth.js";

const router = Router();

router.use(authenticateToken);
router.get("/workspace", listProjectWorkspace);
router.post("/proposals", createProjectProposal);
router.get("/proposals/:id/file", downloadProposalFile);
router.patch("/proposals/:id/review", reviewProjectProposal);
router.get("/:projectId/team/candidates", listProjectTeamCandidates);
router.post("/:projectId/team", addProjectTeamMember);
router.delete("/:projectId/team/:memberId", removeProjectTeamMember);
router.patch("/:projectId/progress", updateProjectProgress);
router.get("/:projectId", getProjectDetails);
router.post("/:projectId/join", joinProject);
router.post("/:projectId/tasks", createProjectTask);
router.patch("/:projectId/tasks/:taskId", updateProjectTask);
router.post("/:projectId/comments", addProjectComment);
router.post("/:projectId/milestones", createProjectMilestone);
router.patch("/:projectId/milestones/:milestoneId", updateProjectMilestone);
router.post("/:projectId/files", uploadProjectFile);
router.get("/:projectId/files/:fileId", downloadProjectFile);

export default router;
