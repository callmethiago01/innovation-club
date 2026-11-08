import { Router } from "express";
import {
	currentUser,
	login,
	logout,
	updateCurrentUser,
	updatePassword,
} from "../controllers/auth.controller.js";
import { authenticateToken } from "../middleware/auth.js";
import {
	validateLogin,
	validatePasswordChange,
	validateProfile,
} from "../validators/auth.validator.js";

const router = Router();

router.post("/login", validateLogin, login);
router.get("/me", authenticateToken, currentUser);
router.put("/me", authenticateToken, validateProfile, updateCurrentUser);
router.put("/password", authenticateToken, validatePasswordChange, updatePassword);
router.post("/logout", logout);

export default router;
