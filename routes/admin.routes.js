import { Router } from "express";
import {
  createCloudinarySignature,
  createAdminContent,
  deleteAdminContent,
  deleteOffice,
  listAdminContent,
  listOffices,
  saveOffice,
} from "../controllers/admin.controller.js";
import { createUser } from "../controllers/auth.controller.js";
import { authenticateToken, requireRoles } from "../middleware/auth.js";
import { validateAccount } from "../validators/auth.validator.js";

const router = Router();

router.use(authenticateToken, requireRoles("admin"));
router.post("/cloudinary-signature", createCloudinarySignature);
router.get("/content", listAdminContent);
router.post("/content", createAdminContent);
router.delete("/content/:id", deleteAdminContent);
router.get("/offices", listOffices);
router.post("/offices", saveOffice);
router.delete("/offices/:id", deleteOffice);
router.post("/users", validateAccount, createUser);

export default router;
