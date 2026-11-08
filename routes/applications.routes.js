import { Router } from "express";
import {
  createApplication,
  resendApplicationVerification,
  verifyApplicationEmail,
} from "../controllers/applications.controller.js";

const router = Router();

router.post("/", createApplication);
router.post("/resend", resendApplicationVerification);
router.get("/verify", verifyApplicationEmail);

export default router;
