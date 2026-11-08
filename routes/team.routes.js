import { Router } from "express";
import { listOffices } from "../controllers/admin.controller.js";

const router = Router();

router.get("/", listOffices);

export default router;
