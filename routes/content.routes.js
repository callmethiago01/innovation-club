import { Router } from "express";
import {
  createAnnouncement,
  createGalleryItem,
  createLeader,
  createNews,
  listPublicContentItems,
  getPublicContent,
  listAnnouncements,
} from "../controllers/content.controller.js";
import { authenticateToken, requireRoles } from "../middleware/auth.js";

const router = Router();

router.get("/", listPublicContentItems);
router.get("/public", getPublicContent);
router.get("/announcements", authenticateToken, requireRoles("admin"), listAnnouncements);
router.post("/announcements", authenticateToken, requireRoles("admin"), createAnnouncement);
router.post("/news", authenticateToken, requireRoles("admin"), createNews);
router.post("/gallery", authenticateToken, requireRoles("admin"), createGalleryItem);
router.post("/leadership", authenticateToken, requireRoles("admin"), createLeader);

export default router;
