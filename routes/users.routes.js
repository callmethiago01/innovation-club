
import { Router } from "express";
import { query } from "../db.js";
import { authenticateToken, requireRoles } from "../middleware/auth.js";

const router = Router();

router.get("/", authenticateToken, requireRoles("admin"), async (_request, response, next) => {
  try {
    const result = await query(
      `SELECT id, full_name, email, role, department, is_active, created_at
       FROM users
       ORDER BY id
       LIMIT 100`
    );

    response.json({
      success: true,
      count: result.rows.length,
      users: result.rows,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
